// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import {
  createEmailDb,
  capability,
  recipient,
  emailSettings,
  payload,
} from "./email-fixture";
import { hash } from "../functions/_shared/mp-orders/core";
import { enrollEmail } from "../functions/_shared/demo-email/privacy";
let f: Awaited<ReturnType<typeof createEmailDb>>;
const provider = randomUUID();
const cipher = "v1." + "a".repeat(24) + "." + "b".repeat(48);
const money = () =>
  f.db
    .query("select on_hand,reserved from public.inventory")
    .then((r) => r.rows[0]);
async function claim() {
  const work = (await f.rpc("demo_email_claim", {})) as {
    sends: Record<string, unknown>[];
    polls: Record<string, unknown>[];
  };
  return work;
}
async function freeze(j: Record<string, unknown>) {
  return await f.rpc("demo_email_freeze", {
    p_id: j.id,
    p_lease: j.lease,
    p_ciphertext: cipher,
    p_hash: "d".repeat(64),
  });
}
async function begin(j: Record<string, unknown>) {
  return await f.rpc("demo_email_begin", { p_id: j.id, p_lease: j.lease });
}
async function result(j: Record<string, unknown>, state = "accepted") {
  return await f.rpc("demo_email_result", {
    p_id: j.id,
    p_lease: j.lease,
    p_outcome: state,
    p_provider: state === "accepted" ? provider : null,
    p_delay: 60,
  });
}
beforeAll(async () => {
  f = await createEmailDb();
}, 30000);
afterAll(async () => f.db.close());
beforeEach(async () => f.reset());
it("migration ships disabled, old orders remain anonymous and cannot be enrolled retroactively", async () => {
  await f.db.exec("update public.demo_email_config set enabled=false");
  const old = await f.order("transfer", false);
  expect(old.email_requested).toBe(false);
  await expect(f.order()).rejects.toThrow("EMAIL_DISABLED");
  await f.db.exec("update public.demo_email_config set enabled=true");
  expect(
    await f.scalar("select count(*)::int v from public.demo_email_contacts"),
  ).toBe(0);
  await f.rpc("demo_transfer_payment", {
    p_reference: old.reference,
    p_owner: await hash(capability),
  });
  expect(
    await f.scalar("select count(*)::int v from public.demo_email_outbox"),
  ).toBe(0);
  const key = await f.scalar("select idempotency_key v from public.orders");
  const enrol = await enrollEmail(recipient, String(key), {
    enabled: true,
    allowed: emailSettings.allowed,
    encryption: emailSettings.encryption,
  });
  expect(
    await f.rpc("demo_email_create_order", {
      p_key: key,
      p_owner: await hash(capability),
      p_payload: { ...payload, payment: "transfer" },
      p_recipient_hash: enrol.recipient_hash,
      p_ciphertext: enrol.ciphertext,
    }),
  ).toMatchObject({ email_requested: false });
});
it("atomic notified creation and same-key retries queue exactly once and never duplicate inventory reservations", async () => {
  const key = randomUUID(),
    a = await f.order("mercado_pago", true, key),
    b = await f.order("mercado_pago", true, key);
  expect(a).toEqual(b);
  expect(a.email_requested).toBe(true);
  expect(
    await f.scalar("select count(*)::int v from public.demo_email_outbox"),
  ).toBe(1);
  expect(await f.scalar("select count(*)::int v from public.orders")).toBe(1);
  const c = (await f.db.query("select * from public.demo_email_contacts"))
    .rows[0];
  expect(JSON.stringify(c)).not.toContain(recipient);
  expect(await f.scalar("select email v from public.orders")).toBe(
    "demo@example.invalid",
  );
  expect(await money()).toEqual({ on_hand: 8, reserved: 2 });
});
it("invalid ciphertext or price rollback does not leave an order, queue row, contact or partial reservation", async () => {
  await expect(
    f.rpc("demo_email_create_order", {
      p_key: randomUUID(),
      p_owner: await hash(capability),
      p_payload: payload,
      p_recipient_hash: "d".repeat(64),
      p_ciphertext: recipient,
    }),
  ).rejects.toThrow("INVALID_EMAIL");
  const key = randomUUID(),
    enrol = await enrollEmail(recipient, key, {
      enabled: true,
      allowed: emailSettings.allowed,
      encryption: emailSettings.encryption,
    });
  await expect(
    f.rpc("demo_email_create_order", {
      p_key: key,
      p_owner: await hash(capability),
      p_payload: {
        ...payload,
        items: [{ ...payload.items[0], expected_price_cents: 1 }],
      },
      p_recipient_hash: enrol.recipient_hash,
      p_ciphertext: enrol.ciphertext,
    }),
  ).rejects.toThrow("PRICE_CHANGED");
  expect(await f.scalar("select count(*)::int v from public.orders")).toBe(0);
  expect(
    await f.scalar("select count(*)::int v from public.demo_email_outbox"),
  ).toBe(0);
  expect(await money()).toEqual({ on_hand: 8, reserved: 0 });
});
it("anon, authenticated/admin role and service direct DML cannot read recipient ciphertext or alter outbox", async () => {
  await f.order();
  for (const role of ["anon", "authenticated", "service_role"]) {
    await f.db.exec(`set role ${role}`);
    for (const table of [
      "demo_email_contacts",
      "demo_email_outbox",
      "demo_email_config",
      "demo_email_suppressions",
      "demo_email_budget",
    ])
      await expect(
        f.scalar(`select count(*) v from public.${table}`),
      ).rejects.toThrow(/permission denied/);
    await expect(
      f.db.exec("delete from public.demo_email_outbox"),
    ).rejects.toThrow(/permission denied/);
    if (role !== "service_role")
      await expect(
        f.scalar("select public.demo_email_claim() v"),
      ).rejects.toThrow(/permission denied/);
    await expect(
      f.scalar("select public.demo_email_enqueue(null,'payment_approved') v"),
    ).rejects.toThrow(/permission denied/);
    await f.db.exec("reset role");
  }
});
it("only verified pending payment creates a pending email; approved order alone is insufficient", async () => {
  const o = await f.order(),
    p = await f.prepare(o.reference);
  expect(
    await f.scalar(
      "select count(*)::int v from public.demo_email_outbox where event='payment_pending'",
    ),
  ).toBe(0);
  await f.apply(p);
  await f.apply(p);
  expect(
    await f.scalar(
      "select count(*)::int v from public.demo_email_outbox where event='payment_pending'",
    ),
  ).toBe(1);
  expect(
    await f.scalar(
      "select public.demo_email_eligible($1,'payment_approved') v",
      [(await f.db.query("select id from public.orders")).rows[0].id],
    ),
  ).toBe(false);
  await f.apply(p, "approved", "accredited");
  expect(
    await f.scalar(
      "select count(*)::int v from public.demo_email_outbox where event='payment_approved'",
    ),
  ).toBe(1);
  expect(
    await f.scalar(
      "select state v from public.demo_email_outbox where event='payment_pending'",
    ),
  ).toBe("suppressed");
  expect(await money()).toEqual({ on_hand: 6, reserved: 0 });
});
it("transfer prepares a pending notice without any payment approval, regardless of admin order status", async () => {
  const o = await f.order("transfer");
  for (let i = 0; i < 2; i++)
    await f.rpc("demo_transfer_payment", {
      p_reference: o.reference,
      p_owner: await hash(capability),
    });
  expect(
    await f.scalar(
      "select count(*)::int v from public.demo_email_outbox where event='payment_pending'",
    ),
  ).toBe(1);
  expect(
    await f.scalar(
      "select count(*)::int v from public.demo_email_outbox where event='payment_approved'",
    ),
  ).toBe(0);
});
it("late approval after expiry enqueues review, never approval; email actions do not reopen or consume released stock", async () => {
  const o = await f.order(),
    p = await f.prepare(o.reference);
  await f.db.exec(
    "update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes'",
  );
  const state = await f.apply(p, "approved", "accredited");
  expect(state).toMatchObject({
    order_status: "expired",
    reconciliation: "review",
  });
  expect(
    await f.scalar(
      "select count(*)::int v from public.demo_email_outbox where event='payment_approved'",
    ),
  ).toBe(0);
  expect(
    (
      await f.db.query(
        "select event from public.demo_email_outbox order by created_at",
      )
    ).rows.map((r) => r.event),
  ).toEqual(["order_received", "reservation_expired", "payment_review"]);
  const j = (await claim()).sends[0];
  await freeze(j);
  await begin(j);
  await result(j, "NETWORK");
  expect(await money()).toEqual({ on_hand: 8, reserved: 0 });
  expect(await f.scalar("select status v from public.orders")).toBe("expired");
});
it("cancelled order queues a single cancellation without modifying its terminal stock movement", async () => {
  const o = await f.order();
  await f.rpc("demo_cancel_order", {
    p_reference: o.reference,
    p_owner: await hash(capability),
  });
  await f.rpc("demo_cancel_order", {
    p_reference: o.reference,
    p_owner: await hash(capability),
  });
  expect(
    await f.scalar(
      "select count(*)::int v from public.demo_email_outbox where event='order_cancelled'",
    ),
  ).toBe(1);
  expect(await money()).toEqual({ on_hand: 8, reserved: 0 });
});
it("leases and immutable frozen requests survive retries; stale workers cannot acknowledge a different lease", async () => {
  await f.order();
  const j = (await claim()).sends[0];
  expect((await claim()).sends).toHaveLength(0);
  const original = await freeze(j);
  expect(
    await f.rpc("demo_email_freeze", {
      p_id: j.id,
      p_lease: j.lease,
      p_ciphertext: cipher + "AA",
      p_hash: "e".repeat(64),
    }),
  ).toEqual(original);
  expect(await begin(j)).toBe(true);
  await f.db.exec(
    "update public.demo_email_outbox set lease_until=clock_timestamp()-interval '1 second'",
  );
  const next = (await claim()).sends[0];
  expect(next.lease).not.toBe(j.lease);
  expect(await result(j)).toBe(false);
  expect(
    await f.rpc("demo_email_freeze", {
      p_id: next.id,
      p_lease: next.lease,
      p_ciphertext: null,
      p_hash: null,
    }),
  ).toEqual(original);
  expect(await begin(next)).toBe(true);
  expect(await result(next)).toBe(true);
  expect(await result(next)).toBe(false);
  expect(
    await f.scalar("select send_attempts v from public.demo_email_outbox"),
  ).toBe(2);
  expect(await money()).toEqual({ on_hand: 8, reserved: 2 });
});
it("uncertain sends outside the 23h retry window are quarantined, never re-keyed or retried after provider idempotency expiry", async () => {
  await f.order();
  const j = (await claim()).sends[0];
  await freeze(j);
  await begin(j);
  await result(j, "NETWORK");
  await f.db.exec(
    "update public.demo_email_outbox set first_attempt_at=clock_timestamp()-interval '23 hours',next_attempt_at=clock_timestamp()-interval '1 second'",
  );
  expect((await claim()).sends).toHaveLength(0);
  expect(await f.scalar("select state v from public.demo_email_outbox")).toBe(
    "review",
  );
  expect(
    await f.scalar("select error_code v from public.demo_email_outbox"),
  ).toBe("IDEMPOTENCY_WINDOW");
});
it("daily attempt quota and retry exhaustion are bounded independently of order/stock operations", async () => {
  await f.db.exec("update public.demo_email_config set daily_attempt_limit=1");
  await f.order();
  await f.order();
  const jobs = (await claim()).sends;
  expect(jobs).toHaveLength(2);
  await freeze(jobs[0]);
  await freeze(jobs[1]);
  expect(await begin(jobs[0])).toBe(true);
  expect(await begin(jobs[1])).toBe(false);
  expect(
    await f.scalar("select attempts v from public.demo_email_budget"),
  ).toBe(1);
  expect(await money()).toEqual({ on_hand: 8, reserved: 4 });
});
it("delivery is verified separately from API acceptance and bounce suppression prevents future email enrollment", async () => {
  await f.order();
  const j = (await claim()).sends[0];
  await freeze(j);
  await begin(j);
  await result(j);
  expect(
    await f.scalar("select delivery v from public.demo_email_outbox"),
  ).toBe("unknown");
  await f.db.exec(
    "update public.demo_email_outbox set next_poll_at=clock_timestamp()-interval '1 second'",
  );
  const poll = (await claim()).polls[0];
  expect(
    await f.rpc("demo_email_delivery", {
      p_id: poll.id,
      p_lease: poll.lease,
      p_provider: provider,
      p_state: "bounced",
      p_delay: 300,
    }),
  ).toBe(true);
  expect(
    await f.scalar(
      "select count(*)::int v from public.demo_email_suppressions",
    ),
  ).toBe(1);
  await expect(f.order()).rejects.toThrow("EMAIL_RECIPIENT_UNAVAILABLE");
  expect(await f.scalar("select count(*)::int v from public.orders")).toBe(1);
  expect(await money()).toEqual({ on_hand: 8, reserved: 2 });
});
it("paused workers catch up only enrolled orders and prune ciphertext independently of the send switch", async () => {
  const o = await f.order("transfer");
  await f.db.exec("update public.demo_email_config set enabled=false");
  await f.rpc("demo_cancel_order", {
    p_reference: o.reference,
    p_owner: await hash(capability),
  });
  expect(
    await f.scalar(
      "select count(*)::int v from public.demo_email_outbox where event='order_cancelled'",
    ),
  ).toBe(0);
  await f.db.exec("update public.demo_email_config set enabled=true");
  await claim();
  expect(
    await f.scalar(
      "select count(*)::int v from public.demo_email_outbox where event='order_cancelled'",
    ),
  ).toBe(1);
  await f.db.exec(
    "update public.demo_email_config set enabled=false;update public.demo_email_contacts set expires_at=clock_timestamp()-interval '1 day';update public.demo_email_outbox set created_at=clock_timestamp()-interval '31 days'",
  );
  await f.rpc("demo_email_maintenance", {});
  expect(
    await f.scalar(
      "select recipient_ciphertext v from public.demo_email_contacts",
    ),
  ).toBeNull();
  expect(
    await f.scalar(
      "select count(*)::int v from public.demo_email_outbox where payload is not null",
    ),
  ).toBe(0);
  expect(await f.scalar("select count(*)::int v from public.orders")).toBe(1);
  expect(await money()).toEqual({ on_hand: 8, reserved: 0 });
});

it("full rollback refuses recorded email activity and restores only its own schema before activity", async () => {
  const rollback = readFileSync(
    "supabase/operations/stage-8-email-rollback.sql",
    "utf8",
  );
  await f.order();
  await expect(f.db.exec(rollback)).rejects.toThrow("Email activity exists");
  await f.db.exec("rollback");
  expect(await f.scalar("select count(*)::int v from public.orders")).toBe(1);
  await f.reset();
  await f.db.exec(rollback);
  expect(
    await f.scalar(
      "select to_regprocedure('public.mp_test_apply(uuid,text,text,jsonb)') is not null v",
    ),
  ).toBe(true);
  expect(
    await f.scalar(
      "select to_regprocedure('public.demo_email_claim()') is null v",
    ),
  ).toBe(true);
  expect(
    await f.scalar(
      "select provolatile::text v from pg_proc where oid='public.demo_receipt(public.orders)'::regprocedure",
    ),
  ).toBe("i");
  await f.db.exec(
    readFileSync(
      "supabase/migrations/202610230003_transactional_email.sql",
      "utf8",
    ),
  );
});
