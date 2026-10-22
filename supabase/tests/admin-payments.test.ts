// @vitest-environment node
import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createEmailDb, capability } from "./email-fixture";
import { hash } from "../functions/_shared/mp-orders/core";
let f: Awaited<ReturnType<typeof createEmailDb>>;
const admin = "10000000-0000-0000-0000-000000000009";
async function role(user = admin, aal = "aal2", name = "authenticated") {
  await f.db.exec(
    `reset role;select set_config('request.jwt.claim.sub','${user}',false);select set_config('request.jwt.claim.aal','${aal}',false);set role ${name}`,
  );
}
async function action(
  id: string,
  value = "confirm",
  key = randomUUID(),
  expected = "pending",
) {
  await role();
  return (await f.scalar(
    "select public.admin_demo_order_action($1,$2,$3,$4) v",
    [id, value, key, expected],
  )) as Record<string, unknown>;
}
async function order(method = "transfer", payment = true) {
  const receipt = await f.order(method);
  let pid: string | null = null;
  if (method === "transfer" && payment) {
    await f.rpc("demo_transfer_payment", {
      p_reference: receipt.reference,
      p_owner: await hash(capability),
    });
  }
  pid = (await f.scalar(
    "select id v from public.orders where public_reference=$1",
    [receipt.reference],
  )) as string;
  return { id: pid, receipt };
}
beforeAll(async () => {
  f = await createEmailDb();
  await f.db.exec(
    `create or replace function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('request.jwt.claim.aal',true))$$;insert into auth.users(id) values('${admin}');insert into public.admin_profiles(user_id,display_name,active) values('${admin}','Fixture Admin',true);`,
  );
  await f.db.exec(
    readFileSync("supabase/migrations/202610230004_admin_payments.sql", "utf8"),
  );
});
beforeEach(async () => {
  await f.db.exec(
    "reset role;delete from public.demo_admin_order_actions;update public.admin_profiles set active=true",
  );
  await f.reset();
});
afterAll(async () => {
  await f.db.close();
});
it("authorized transfer approval atomically consumes once, records audit and repeats the same immutable result", async () => {
  const o = await order();
  const key = randomUUID();
  const first = await action(o.id, "confirm", key);
  expect(first).toMatchObject({
    order_status: "confirmed",
    payment_status: "approved",
  });
  expect(await action(o.id, "confirm", key)).toEqual(first);
  await f.db.exec("reset role");
  expect(
    await f.scalar(
      "select count(*)::int v from public.demo_admin_order_actions",
    ),
  ).toBe(1);
  expect(
    (await f.db.query("select on_hand,reserved from public.inventory")).rows,
  ).toEqual([{ on_hand: 6, reserved: 0 }]);
  expect(
    await f.scalar(
      "select count(*)::int v from public.demo_email_outbox where event='payment_approved'",
    ),
  ).toBe(0);
});
it("an existing key cannot authorize a different action, administrator or expected state", async () => {
  const o = await order();
  const key = randomUUID();
  await action(o.id, "confirm", key);
  await expect(action(o.id, "cancel", key)).rejects.toThrow(
    /IDEMPOTENCY_CONFLICT/,
  );
  await expect(action(o.id, "confirm", key, "confirmed")).rejects.toThrow(
    /IDEMPOTENCY_CONFLICT/,
  );
  await expect(action(o.id, "confirm", randomUUID())).rejects.toThrow(
    /EDIT_CONFLICT/,
  );
});
it("legacy transition cannot manually approve MP, or bypass the audit on transfers", async () => {
  const o = await order("mercado_pago");
  await f.prepare(o.receipt.reference);
  await expect(action(o.id)).rejects.toThrow(/PROVIDER_CONFIRMATION_REQUIRED/);
  await role();
  await expect(
    f.scalar("select public.demo_admin_transition($1,'confirmed') v", [o.id]),
  ).rejects.toThrow(/PROVIDER_CONFIRMATION_REQUIRED/);
  await f.db.exec("reset role");
  expect(
    await f.scalar(
      "select count(*)::int v from public.demo_admin_order_actions",
    ),
  ).toBe(0);
  const transfer = await order();
  await role();
  expect(
    await f.scalar("select public.demo_admin_transition($1,'confirmed') v", [
      transfer.id,
    ]),
  ).toBe(true);
});
it("expired transfer approval cannot consume released stock; cron updates payment and email event once", async () => {
  const o = await order();
  await f.db.exec(
    "update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes'",
  );
  expect(await action(o.id)).toMatchObject({
    order_status: "expired",
    payment_status: "expired",
  });
  await f.db.exec("reset role");
  expect(
    (await f.db.query("select on_hand,reserved from public.inventory")).rows,
  ).toEqual([{ on_hand: 8, reserved: 0 }]);
  expect(
    await f.scalar(
      "select count(*)::int v from public.demo_email_outbox where event='reservation_expired'",
    ),
  ).toBe(1);
});
it("cron alone synchronizes unpaid transfer status, without browser recovery", async () => {
  await order();
  await f.db.exec(
    "update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes';select public.demo_expire_orders();select public.demo_expire_orders();",
  );
  expect(await f.scalar("select status v from public.payments")).toBe(
    "expired",
  );
  expect(
    await f.scalar(
      "select count(*)::int v from public.inventory_movements where kind='expire'",
    ),
  ).toBe(1);
});
it("cancel, prepare and deliver have server controlled states and no extra stock movements", async () => {
  const o = await order();
  await action(o.id);
  await action(o.id, "prepare", randomUUID(), "confirmed");
  await action(o.id, "deliver", randomUUID(), "preparing");
  await expect(
    action(o.id, "cancel", randomUUID(), "delivered"),
  ).rejects.toThrow(/INVALID_TRANSITION/);
  await f.db.exec("reset role");
  expect(
    await f.scalar(
      "select count(*)::int v from public.inventory_movements where kind='consume'",
    ),
  ).toBe(1);
  const other = await order();
  expect(await action(other.id, "cancel")).toMatchObject({
    order_status: "cancelled",
    payment_status: "cancelled",
  });
});
it("missing or mismatched transfer payment cannot be confirmed; no fabricated historical payment", async () => {
  const o = await order("transfer", false);
  await expect(action(o.id)).rejects.toThrow(/PAYMENT_CONFLICT/);
  await f.db.exec("reset role");
  expect(await f.scalar("select count(*)::int v from public.payments")).toBe(0);
});
it("safe metadata separates states and omits contact, capabilities, frozen requests and provider keys", async () => {
  const o = await order();
  await role();
  const data = (await f.scalar(
    "select public.admin_demo_order_payments($1::uuid[]) v",
    [[o.id]],
  )) as Record<string, unknown>[];
  expect(data).toHaveLength(1);
  expect(data[0]).toMatchObject({
    order_id: o.id,
    payments: [{ status: "pending", method: "bank_transfer" }],
  });
  expect(JSON.stringify(data)).not.toMatch(
    /recipient|ciphertext|capability|owner_hash|idempotency_key|mp_request|checkout_url|cancel_key/,
  );
  await expect(
    f.scalar("select public.admin_demo_order_payments($1::uuid[]) v", [
      Array(21).fill(o.id),
    ]),
  ).rejects.toThrow(/INVALID_REQUEST/);
});
it("nonmembers, inactive admins, AAL1 in legacy mode and backend service cannot mutate or read administrative metadata", async () => {
  const o = await order();
  for (const [user, aal, name] of [
    [admin, "aal1", "authenticated"],
    [randomUUID(), "aal2", "authenticated"],
    [admin, "aal2", "anon"],
    [admin, "aal2", "service_role"],
  ]) {
    await role(user, aal, name);
    await expect(
      f.scalar("select public.admin_demo_order_payments($1::uuid[]) v", [
        [o.id],
      ]),
    ).rejects.toThrow(/FORBIDDEN|permission denied/);
    await expect(
      f.scalar("select public.admin_demo_order_action($1,$2,$3,$4) v", [
        o.id,
        "confirm",
        randomUUID(),
        "pending",
      ]),
    ).rejects.toThrow(/FORBIDDEN|permission denied/);
  }
  await f.db.exec("reset role;update public.admin_profiles set active=false");
  await role();
  await expect(
    f.scalar("select public.admin_demo_order_payments($1::uuid[]) v", [[o.id]]),
  ).rejects.toThrow(/FORBIDDEN/);
});
it("RLS and column grants block direct writes and private payment fields even for active administrators", async () => {
  await order();
  await role();
  expect(
    (await f.db.query("select id,status from public.payments")).rows,
  ).toHaveLength(1);
  await expect(
    f.db.query("select mp_request,idempotency_key from public.payments"),
  ).rejects.toThrow(/permission denied/);
  await expect(
    f.db.exec("update public.payments set status='approved'"),
  ).rejects.toThrow(/permission denied/);
  await expect(
    f.db.exec("delete from public.demo_admin_order_actions"),
  ).rejects.toThrow(/permission denied/);
});
it("revoked admin cannot replay a previously successful action", async () => {
  const o = await order();
  const key = randomUUID();
  await action(o.id, "confirm", key);
  await f.db.exec("reset role;update public.admin_profiles set active=false");
  await expect(action(o.id, "confirm", key)).rejects.toThrow(/FORBIDDEN/);
});
it("rollback refuses audited activity and otherwise preserves all previous stages", async () => {
  await f.db.exec(
    readFileSync("supabase/operations/stage-8-admin-rollback.sql", "utf8"),
  );
  expect(
    await f.scalar(
      "select to_regprocedure('public.mp_test_apply(uuid,text,text,jsonb)') is not null v",
    ),
  ).toBe(true);
  await f.db.exec(
    readFileSync("supabase/migrations/202610230004_admin_payments.sql", "utf8"),
  );
  const o = await order();
  await action(o.id);
  await f.db.exec("reset role");
  await expect(
    f.db.exec(
      readFileSync("supabase/operations/stage-8-admin-rollback.sql", "utf8"),
    ),
  ).rejects.toThrow(/preserve audit evidence/);
  await f.db.exec("rollback");
});

it("cleanup preserves audited historical demo orders without payment rows", async () => {
  const o = await order("cash", false);
  await action(o.id);
  await action(o.id, "prepare", randomUUID(), "confirmed");
  await action(o.id, "deliver", randomUUID(), "preparing");
  await f.db.exec(
    "reset role;update public.orders set created_at=created_at-interval '31 days',reservation_expires_at=reservation_expires_at-interval '31 days';select public.demo_cleanup();",
  );
  expect(
    await f.scalar(
      "select count(*)::int v from public.demo_admin_order_actions",
    ),
  ).toBe(3);
  expect(await f.scalar("select count(*)::int v from public.orders")).toBe(1);
});

it("provider-verified MP approval permits fulfillment but never a second payment confirmation", async () => {
  const o = await order("mercado_pago");
  const p = await f.prepare(o.receipt.reference);
  await f.apply(p, "approved", "accredited");
  expect(
    await action(o.id, "prepare", randomUUID(), "confirmed"),
  ).toMatchObject({ order_status: "preparing" });
  expect(
    await action(o.id, "deliver", randomUUID(), "preparing"),
  ).toMatchObject({ order_status: "delivered" });
  await f.db.exec("reset role");
  expect(
    await f.scalar(
      "select count(*)::int v from public.inventory_movements where kind='consume'",
    ),
  ).toBe(1);
});
