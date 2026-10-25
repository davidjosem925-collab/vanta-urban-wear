// @vitest-environment node
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createEmailDb, emailSettings, capability } from "./email-fixture";
import { makeEmailWorker } from "../functions/_shared/demo-email/worker";
import { hash } from "../functions/_shared/mp-orders/core";
let f: Awaited<ReturnType<typeof createEmailDb>>;
const migration = readFileSync(
  "supabase/migrations/202610250001_mp_approved_email_only.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/operations/mp-approved-email-only-rollback.sql",
  "utf8",
);
const cipher = "v1." + "a".repeat(24) + "." + "b".repeat(48);
const body = () =>
  new Request("https://edge.example/demo-email-worker", {
    method: "POST",
    headers: {
      authorization: `Bearer ${emailSettings.workerSecret}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
const run = (fetcher: typeof fetch) =>
  makeEmailWorker(
    emailSettings,
    f.rpc,
    fetcher,
    () => {},
    async () => {},
  )(body());
const jobs = () =>
  f.db
    .query(
      "select event,state,provider_id,delivery from public.demo_email_outbox order by created_at",
    )
    .then((r) => r.rows);
async function prepare() {
  return f.prepare((await f.order()).reference);
}
beforeAll(async () => {
  f = await createEmailDb();
  for (const name of [
    "202610230004_admin_payments.sql",
    "202610240001_mp_payment_evidence.sql",
    "202610240002_mp_created_without_detail.sql",
    "202610240003_mp_checkout_pref_id.sql",
  ])
    await f.db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  await f.db.exec(migration);
}, 30000);
beforeEach(() => f.reset());
afterAll(() => f.db.close());
it("MP creation, linkage, repeated pending snapshots and claims enqueue/send nothing", async () => {
  const p = await prepare();
  for (let i = 0; i < 3; i++) await f.apply(p);
  const fetcher = vi.fn();
  expect(await (await run(fetcher)).json()).toMatchObject({
    processed: 0,
    retry: 0,
  });
  expect(await jobs()).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await f.scalar("select reserved v from public.inventory")).toBe(2);
});
it.each(["cancelled", "expired"])(
  "an unapproved %s order never queues any MP notification",
  async (state) => {
    const p = await prepare();
    await f.apply(
      p,
      state === "cancelled" ? "cancelled" : "pending",
      state === "cancelled" ? "cancelled" : "pending",
    );
    if (state === "expired")
      await f.db.exec(
        "update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes';select public.demo_expire_orders()",
      );
    await f.rpc("demo_email_claim", {});
    expect(await jobs()).toEqual([]);
    expect(await f.scalar("select reserved v from public.inventory")).toBe(0);
  },
);
it("verified approval alone sends the complete existing template once; replay/retries retain the same body and key", async () => {
  const p = await prepare();
  for (let i = 0; i < 3; i++) await f.apply(p, "approved", "accredited");
  expect((await jobs()).map((j) => j.event)).toEqual(["payment_approved"]);
  const sent: { body: string; key: string | null }[] = [];
  const provider = randomUUID();
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, options?: RequestInit) => {
      sent.push({
        body: String(options?.body),
        key: new Headers(options?.headers).get("Idempotency-Key"),
      });
      if (sent.length === 1) throw Error("fixture-lost-response");
      return Response.json({ id: provider });
    },
  );
  await run(fetcher);
  await f.db.exec(
    "update public.demo_email_outbox set next_attempt_at=clock_timestamp()-interval '1 second',lease_until=null",
  );
  await run(fetcher);
  await f.apply(p, "approved", "accredited");
  await run(fetcher);
  expect(sent).toHaveLength(2);
  expect(sent[0]).toEqual(sent[1]);
  const email = JSON.parse(sent[1].body);
  expect(email.subject).toBe("VANTA Demo · Pago de prueba aprobado");
  for (const text of ["Essential", "Negro", "50.001", "25.000", "S"])
    expect(email.html).toContain(text);
  expect(email.text).toContain(String(p.reference));
  expect(await jobs()).toEqual([
    expect.objectContaining({
      event: "payment_approved",
      state: "accepted",
      provider_id: provider,
    }),
  ]);
  expect(
    await f.scalar(
      "select count(*)::int v from public.inventory_movements where kind='consume'",
    ),
  ).toBe(1);
});
it("late accreditation is review, not an approval notification", async () => {
  const p = await prepare();
  await f.db.exec(
    "update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes';select public.demo_expire_orders()",
  );
  await f.apply(p, "approved", "accredited");
  await f.rpc("demo_email_claim", {});
  expect(await jobs()).toEqual([]);
  expect(
    await f.scalar("select mp_reconciliation v from public.payments"),
  ).toBe("review");
  expect(await f.scalar("select reserved v from public.inventory")).toBe(0);
  expect(await f.scalar("select on_hand v from public.inventory")).toBe(8);
});
it.each(["transfer", "cash"])(
  "%s keeps order received and its original follow-up rules",
  async (method) => {
    const receipt = await f.order(method);
    expect((await jobs()).map((j) => j.event)).toEqual(["order_received"]);
    if (method === "transfer") {
      await f.rpc("demo_transfer_payment", {
        p_reference: receipt.reference,
        p_owner: await hash(capability),
      });
      expect((await jobs()).map((j) => j.event)).toEqual([
        "order_received",
        "payment_pending",
      ]);
    }
    await f.db.exec(
      "update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes';select public.demo_expire_orders()",
    );
    expect((await jobs()).some((j) => j.event === "reservation_expired")).toBe(
      true,
    );
  },
);
it("migration suppresses frozen legacy retries and clears leases, preserving accepted/delivered messages and financial rows", async () => {
  await f.db.exec(rollback);
  const p = await prepare();
  await f.apply(p);
  const accepted = randomUUID();
  await f.db
    .exec(`update public.demo_email_outbox set state='accepted',provider_id='${accepted}',delivery='delivered' where event='order_received';
    update public.demo_email_outbox set state='sending',lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',first_attempt_at=clock_timestamp(),request_ciphertext='${cipher}',request_hash=repeat('a',64) where event='payment_pending'`);
  const saved = await f.scalar(
    "select to_jsonb(e) v from public.demo_email_outbox e where event='order_received'",
  );
  const order = await f.scalar("select to_jsonb(o) v from public.orders o");
  const payment = await f.scalar("select to_jsonb(p) v from public.payments p");
  await f.db.exec(migration);
  expect(
    await f.scalar(
      "select to_jsonb(e) v from public.demo_email_outbox e where event='order_received'",
    ),
  ).toEqual(saved);
  expect(await f.scalar("select to_jsonb(o) v from public.orders o")).toEqual(
    order,
  );
  expect(await f.scalar("select to_jsonb(p) v from public.payments p")).toEqual(
    payment,
  );
  expect(
    await f.scalar(
      "select state v from public.demo_email_outbox where event='payment_pending'",
    ),
  ).toBe("suppressed");
  expect(
    await f.scalar(
      "select lease_id v from public.demo_email_outbox where event='payment_pending'",
    ),
  ).toBeNull();
  expect(
    await f.scalar(
      "select request_ciphertext v from public.demo_email_outbox where event='payment_pending'",
    ),
  ).toBe(cipher);
});
it.each([false, true])(
  "worker blocks legacy MP jobs before decrypting or posting, even under old SQL (frozen=%s)",
  async (frozen) => {
    await f.db.exec(rollback);
    await prepare();
    if (frozen)
      await f.db.exec(
        `update public.demo_email_outbox set first_attempt_at=clock_timestamp(),request_ciphertext='${cipher}',request_hash=repeat('a',64)`,
      );
    const provider = vi.fn();
    expect(await (await run(provider)).json()).toMatchObject({
      processed: 0,
      retry: 0,
    });
    expect(provider).not.toHaveBeenCalled();
    expect(
      await f.scalar(
        "select request_ciphertext v from public.demo_email_outbox",
      ),
    ).toBe(frozen ? cipher : null);
    await f.db.exec(migration);
  },
);
it("begin suppresses a frozen unwanted retry regardless of first_attempt_at", async () => {
  const receipt = await f.order();
  await f.db
    .exec(`insert into public.demo_email_outbox(order_id,event,payload,state,lease_id,lease_until,first_attempt_at,request_ciphertext,request_hash)
    select id,'order_received','{}','sending','10000000-0000-0000-0000-000000000001',clock_timestamp()+interval '2 minutes',clock_timestamp(),'${cipher}',repeat('a',64) from public.orders`);
  const id = await f.scalar("select id v from public.demo_email_outbox");
  expect(receipt.reference).toBeTruthy();
  expect(
    await f.rpc("demo_email_begin", {
      p_id: id,
      p_lease: "10000000-0000-0000-0000-000000000001",
    }),
  ).toBe(false);
  expect(await f.scalar("select state v from public.demo_email_outbox")).toBe(
    "suppressed",
  );
  expect(
    await f.scalar("select count(*)::int v from public.demo_email_budget"),
  ).toBe(0);
});
it("approval eligibility requires explicit exact paid evidence in addition to existing settled accreditation", async () => {
  const p = await prepare();
  await f.apply(p, "approved", "accredited");
  const order = await f.scalar("select id v from public.orders");
  expect(
    await f.scalar(
      "select public.demo_email_eligible($1,'payment_approved') v",
      [order],
    ),
  ).toBe(true);
  await f.db.exec(
    "update public.payments set mp_paid_amount_cents=null,mp_paid_evidence=null",
  );
  expect(
    await f.scalar(
      "select public.demo_email_eligible($1,'payment_approved') v",
      [order],
    ),
  ).toBe(false);
});
it("RPC grants remain private and migration version checks prevent accidental reapplication", async () => {
  for (const role of ["anon", "authenticated"])
    for (const fn of [
      "demo_email_eligible(uuid,text)",
      "demo_email_maintenance()",
      "demo_email_begin(uuid,uuid)",
    ])
      expect(
        await f.scalar("select has_function_privilege($1,$2,'EXECUTE') v", [
          role,
          "public." + fn,
        ]),
      ).toBe(false);
  await expect(f.db.exec(migration)).rejects.toThrow("UNEXPECTED_EMAIL_RPC");
  await f.db.exec("rollback");
});
