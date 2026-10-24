// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { createEmailDb } from "./email-fixture";
import { resource } from "./mp-fixture";
let f: Awaited<ReturnType<typeof createEmailDb>>;
const migration = readFileSync(
  "supabase/migrations/202610240001_mp_payment_evidence.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/operations/mp-payment-evidence-rollback.sql",
  "utf8",
);
let originalDefinition: unknown, originalAcl: unknown;
beforeAll(async () => {
  f = await createEmailDb();
  await f.db.exec(
    readFileSync("supabase/migrations/202610230004_admin_payments.sql", "utf8"),
  );
  originalDefinition = await f.scalar(
    "select pg_get_functiondef('public.mp_test_apply(uuid,text,text,jsonb)'::regprocedure) v",
  );
  originalAcl = await f.scalar(
    "select proacl::text v from pg_proc where oid='public.mp_test_apply(uuid,text,text,jsonb)'::regprocedure",
  );
  await f.db.exec(migration);
}, 30000);
beforeEach(() => f.reset());
afterEach(() => f.db.exec("rollback;reset role"));
afterAll(() => f.db.close());
async function prepare(notified = false) {
  return f.prepare((await f.order("mercado_pago", notified)).reference);
}
async function apply(
  p: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return f.rpc("mp_test_apply", {
    p_id: p.payment_id,
    p_resource: resource,
    p_url: `https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=${resource}`,
    p_snapshot: {
      reference: p.reference,
      seller_id: "123",
      application_id: "456",
      currency: "ARS",
      amount_cents: 5000100,
      paid_cents: null,
      paid_evidence: "unreported",
      provider_state: "created",
      provider_detail: "created",
      state: "pending",
      detail: "pending",
      updated_at: new Date().toISOString(),
      ...extra,
    },
  });
}
async function inventory() {
  return (await f.db.query("select on_hand,reserved from public.inventory"))
    .rows[0];
}
it("preserves RPC ACL/definer and does not grant new financial evidence columns to browser roles", async () => {
  expect(
    await f.scalar(
      "select proacl::text v from pg_proc where oid='public.mp_test_apply(uuid,text,text,jsonb)'::regprocedure",
    ),
  ).toEqual(originalAcl);
  expect(
    await f.scalar(
      "select prosecdef and proconfig=array['search_path=\"\"'] v from pg_proc where oid='public.mp_test_apply(uuid,text,text,jsonb)'::regprocedure",
    ),
  ).toBe(true);
  for (const role of ["anon", "authenticated"]) {
    expect(
      await f.scalar(
        "select has_function_privilege($1,'public.mp_test_apply(uuid,text,text,jsonb)','EXECUTE') v",
        [role],
      ),
    ).toBe(false);
    expect(
      await f.scalar(
        "select has_column_privilege($1,'public.payments','mp_paid_amount_cents','SELECT') v",
        [role],
      ),
    ).toBe(false);
  }
});
it("links unknown pending evidence without persisting zero, approving or changing stock; replay is idempotent", async () => {
  const p = await prepare(true);
  const result = (await apply(p)) as Record<string, unknown>;
  expect(result).toMatchObject({
    provider_order_id: resource,
    status: "pending",
    reconciliation: "awaiting",
    order_status: "pending",
  });
  expect(await apply(p)).toMatchObject({
    provider_order_id: resource,
    status: "pending",
  });
  expect(
    (
      await f.db.query(
        "select mp_paid_amount_cents,mp_paid_evidence from public.payments",
      )
    ).rows,
  ).toEqual([{ mp_paid_amount_cents: null, mp_paid_evidence: "unreported" }]);
  expect(await inventory()).toEqual({ on_hand: 8, reserved: 2 });
  expect(
    await f.scalar(
      "select count(*)::int v from public.demo_email_outbox where event='payment_approved'",
    ),
  ).toBe(0);
  expect(
    await f.scalar("select count(*)::int v from public.stock_reservations"),
  ).toBe(1);
});
it.each([
  { paid_evidence: undefined },
  { paid_cents: undefined },
  { paid_cents: "null" },
  { paid_cents: 0 },
  { paid_evidence: "reported" },
  { provider_state: "processed", provider_detail: "accredited" },
  { state: "approved", detail: "accredited" },
  { provider_detail: "accredited" },
  { provider_state: "pending", provider_detail: "pending" },
])(
  "SQL rejects malformed/credit-bearing unknown evidence %j",
  async (extra) => {
    const p = await prepare();
    await expect(apply(p, extra)).rejects.toThrow(/INVALID_PAYMENT/);
    expect(await inventory()).toEqual({ on_hand: 8, reserved: 2 });
    expect(
      await f.scalar("select mp_order_id v from public.payments"),
    ).toBeNull();
  },
);
it("an exact reported accreditation consumes once and cannot be downgraded to unknown", async () => {
  const p = await prepare(true);
  await apply(p);
  const approved = {
    state: "approved",
    detail: "accredited",
    paid_cents: 5000100,
    paid_evidence: "reported",
  };
  expect(await apply(p, approved)).toMatchObject({
    order_status: "confirmed",
    status: "approved",
    reconciliation: "settled",
  });
  await apply(p, approved);
  await expect(apply(p)).rejects.toThrow(/INVALID_PAYMENT/);
  expect(await inventory()).toEqual({ on_hand: 6, reserved: 0 });
  expect(
    await f.scalar("select mp_paid_amount_cents::int v from public.payments"),
  ).toBe(5000100);
  expect(
    await f.scalar(
      "select count(*)::int v from public.inventory_movements where kind='consume'",
    ),
  ).toBe(1);
  expect(
    await f.scalar(
      "select count(*)::int v from public.demo_email_outbox where event='payment_approved'",
    ),
  ).toBe(1);
});
it("partial reported money is never erased by a later unknown snapshot", async () => {
  const p = await prepare();
  await apply(p, { paid_cents: 1, paid_evidence: "reported" });
  await expect(apply(p)).rejects.toThrow(/INVALID_PAYMENT/);
  expect(
    await f.scalar("select mp_paid_amount_cents::int v from public.payments"),
  ).toBe(1);
});
it.each([null, 0, 5000099, 5000101])(
  "SQL cannot settle an incorrect paid amount %j",
  async (paid_cents) => {
    const p = await prepare();
    await expect(
      apply(p, {
        paid_cents,
        paid_evidence: "reported",
        state: "approved",
        detail: "accredited",
      }),
    ).rejects.toThrow(/INVALID_PAYMENT/);
    expect(await inventory()).toEqual({ on_hand: 8, reserved: 2 });
  },
);
it("unknown canceled/expired releases once; explicit late approval only requests review", async () => {
  const p = await prepare();
  const cancelled = {
    state: "cancelled",
    detail: "cancelled",
    provider_state: "canceled",
    provider_detail: "expired",
  };
  expect(await apply(p, cancelled)).toMatchObject({
    order_status: "cancelled",
    status: "cancelled",
    reconciliation: "closed",
  });
  await apply(p, cancelled);
  expect(await inventory()).toEqual({ on_hand: 8, reserved: 0 });
  expect(
    await f.scalar(
      "select count(*)::int v from public.inventory_movements where kind='release'",
    ),
  ).toBe(1);
  expect(
    await apply(p, {
      state: "approved",
      detail: "accredited",
      paid_cents: 5000100,
      paid_evidence: "reported",
    }),
  ).toMatchObject({ order_status: "cancelled", reconciliation: "review" });
  expect(await inventory()).toEqual({ on_hand: 8, reserved: 0 });
});
it("TTL expiry and terminal reconciliation cannot release twice or reopen an expired order", async () => {
  const p = await prepare();
  await apply(p);
  await f.db.exec(
    "update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes';select public.demo_expire_orders()",
  );
  expect(
    await apply(p, {
      state: "cancelled",
      detail: "cancelled",
      provider_state: "canceled",
      provider_detail: "expired",
    }),
  ).toMatchObject({
    order_status: "expired",
    status: "expired",
    reconciliation: "closed",
  });
  expect(await inventory()).toEqual({ on_hand: 8, reserved: 0 });
  expect(
    await f.scalar(
      "select count(*)::int v from public.inventory_movements where kind in ('expire','release')",
    ),
  ).toBe(1);
});
it("legacy explicit numeric snapshots remain compatible; evidence constraint rejects ambiguous combinations", async () => {
  const p = await prepare();
  await apply(p, { paid_cents: 0, paid_evidence: undefined });
  expect(await f.scalar("select mp_paid_evidence v from public.payments")).toBe(
    "reported",
  );
  await expect(
    f.db.exec(
      "update public.payments set mp_paid_evidence=null,mp_paid_amount_cents=1",
    ),
  ).rejects.toThrow(/mp_paid_evidence_check/);
  await expect(
    f.db.exec(
      "update public.payments set mp_paid_evidence='unreported',mp_paid_amount_cents=0",
    ),
  ).rejects.toThrow(/mp_paid_evidence_check/);
});
it("rollback refuses recorded evidence; unused rollback restores exact previous RPC without deleting historical orders", async () => {
  const p = await prepare();
  await apply(p);
  await expect(f.db.exec(rollback)).rejects.toThrow(
    /PAYMENT_EVIDENCE_ACTIVITY_PRESENT/,
  );
  await f.db.exec("rollback");
  await f.reset();
  const o = await f.order("cash", false);
  await f.db.exec(rollback);
  expect(
    await f.scalar(
      "select pg_get_functiondef('public.mp_test_apply(uuid,text,text,jsonb)'::regprocedure) v",
    ),
  ).toEqual(originalDefinition);
  expect(
    await f.scalar(
      "select count(*)::int v from public.orders where public_reference=$1",
      [o.reference],
    ),
  ).toBe(1);
  await f.db.exec(migration);
  expect(
    await f.scalar(
      "select count(*)::int v from public.payments where mp_paid_evidence is not null",
    ),
  ).toBe(0);
});

it("upgrade preserves every legacy payment field and flags without inventing historical paid evidence", async () => {
  await f.db.exec(rollback);
  const p = await prepare();
  await f.apply(p);
  const before = await f.scalar("select to_jsonb(p) v from public.payments p");
  const flags = await f.scalar(
    "select to_jsonb(c) v from public.mp_test_config c",
  );
  await f.db.exec(migration);
  expect(
    await f.scalar(
      "select to_jsonb(p)-'mp_paid_evidence'-'mp_paid_amount_cents' v from public.payments p",
    ),
  ).toEqual(before);
  expect(
    await f.scalar("select to_jsonb(c) v from public.mp_test_config c"),
  ).toEqual(flags);
  expect(
    await f.scalar("select mp_paid_evidence v from public.payments"),
  ).toBeNull();
  expect(
    await f.scalar("select mp_paid_amount_cents v from public.payments"),
  ).toBeNull();
});
it("migration refuses an unexpectedly customized RPC atomically instead of overwriting it", async () => {
  await f.db.exec(rollback);
  await f.db.exec(
    "create or replace function public.mp_test_apply(p_id uuid,p_resource text,p_url text,p_snapshot jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin raise exception 'custom-rpc';end$$",
  );
  await expect(f.db.exec(migration)).rejects.toThrow(/UNEXPECTED_PAYMENT_RPC/);
  await f.db.exec("rollback");
  expect(
    await f.scalar(
      "select count(*)::int v from information_schema.columns where table_schema='public' and table_name='payments' and column_name='mp_paid_evidence'",
    ),
  ).toBe(0);
  await f.db.exec(String(originalDefinition));
  await f.db.exec(migration);
});

it("definition fingerprints accept equivalent CRLF SQL from Windows without bypassing the source guard", async () => {
  await f.db.exec(rollback);
  await f.db.exec(String(originalDefinition).replace(/\r?\n/g, "\r\n"));
  await f.db.exec(migration);
  expect(
    await f.scalar(
      "select count(*)::int v from information_schema.columns where table_schema='public' and table_name='payments' and column_name='mp_paid_evidence'",
    ),
  ).toBe(1);
});
