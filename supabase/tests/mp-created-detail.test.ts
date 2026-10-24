// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { createEmailDb } from "./email-fixture";
import { resource } from "./mp-fixture";
let f: Awaited<ReturnType<typeof createEmailDb>>;
const v2 = readFileSync(
  "supabase/migrations/202610240001_mp_payment_evidence.sql",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/202610240002_mp_created_without_detail.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/operations/mp-created-without-detail-rollback.sql",
  "utf8",
);
let definition: unknown, acl: unknown, unchanged: boolean;
beforeAll(async () => {
  f = await createEmailDb();
  await f.db.exec(
    readFileSync("supabase/migrations/202610230004_admin_payments.sql", "utf8"),
  );
  await f.db.exec(v2);
  definition = await f.scalar(
    "select pg_get_functiondef('public.mp_test_apply(uuid,text,text,jsonb)'::regprocedure) v",
  );
  acl = await f.scalar(
    "select proacl::text v from pg_proc where oid='public.mp_test_apply(uuid,text,text,jsonb)'::regprocedure",
  );
  const p = await f.prepare((await f.order("mercado_pago", false)).reference);
  const before = await f.scalar("select to_jsonb(p) v from public.payments p");
  const flags = await f.scalar(
    "select to_jsonb(c) v from public.mp_test_config c",
  );
  await f.db.exec(migration);
  unchanged =
    JSON.stringify(before) ===
      JSON.stringify(
        await f.scalar("select to_jsonb(p) v from public.payments p"),
      ) &&
    JSON.stringify(flags) ===
      JSON.stringify(
        await f.scalar("select to_jsonb(c) v from public.mp_test_config c"),
      );
  expect(p.payment_id).toBeTruthy();
}, 30000);
beforeEach(() => f.reset());
afterEach(() => f.db.exec("rollback;reset role"));
afterAll(() => f.db.close());
async function prepare() {
  return f.prepare((await f.order("mercado_pago", false)).reference);
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
      provider_detail: null,
      state: "pending",
      detail: "pending",
      updated_at: new Date().toISOString(),
      ...extra,
    },
  });
}
it("incremental migration leaves payment rows/flags/ACL unchanged and RPC remains private", async () => {
  expect(unchanged).toBe(true);
  expect(
    await f.scalar(
      "select proacl::text v from pg_proc where oid='public.mp_test_apply(uuid,text,text,jsonb)'::regprocedure",
    ),
  ).toEqual(acl);
  for (const role of ["anon", "authenticated"])
    expect(
      await f.scalar(
        "select has_function_privilege($1,'public.mp_test_apply(uuid,text,text,jsonb)','EXECUTE') v",
        [role],
      ),
    ).toBe(false);
});
it("explicitly unknown detail and money link as pending, never zero or paid, and replay keeps one reservation", async () => {
  const p = await prepare();
  expect(await apply(p)).toMatchObject({
    provider_order_id: resource,
    status: "pending",
    order_status: "pending",
  });
  await apply(p);
  expect(
    await f.scalar("select mp_paid_amount_cents v from public.payments"),
  ).toBeNull();
  expect(await f.scalar("select mp_paid_evidence v from public.payments")).toBe(
    "unreported",
  );
  expect(
    await f.scalar("select count(*)::int v from public.stock_reservations"),
  ).toBe(1);
  expect(await f.scalar("select reserved v from public.inventory")).toBe(2);
});
it.each([
  { provider_state: "processed" },
  { provider_state: "processing" },
  { provider_state: "canceled", state: "cancelled", detail: "cancelled" },
  { state: "approved", detail: "accredited" },
  { provider_detail: undefined },
  { paid_cents: 0 },
  { paid_evidence: "reported" },
  { provider_state: "accredited" },
  {
    state: "approved",
    detail: "accredited",
    paid_cents: 5000100,
    paid_evidence: "reported",
  },
])(
  "SQL null detail cannot supply credit or another lifecycle (%j)",
  async (extra) => {
    const p = await prepare();
    await expect(apply(p, extra)).rejects.toThrow(/INVALID_PAYMENT/);
    expect(
      await f.scalar("select mp_order_id v from public.payments"),
    ).toBeNull();
    expect(await f.scalar("select reserved v from public.inventory")).toBe(2);
  },
);
it("accreditation after missing detail still requires exact reported amount and cannot be downgraded", async () => {
  const p = await prepare();
  await apply(p);
  await expect(
    apply(p, {
      state: "approved",
      detail: "accredited",
      paid_cents: 1,
      paid_evidence: "reported",
      provider_state: undefined,
      provider_detail: undefined,
    }),
  ).rejects.toThrow(/INVALID_PAYMENT/);
  expect(
    await apply(p, {
      state: "approved",
      detail: "accredited",
      paid_cents: 5000100,
      paid_evidence: "reported",
      provider_state: undefined,
      provider_detail: undefined,
    }),
  ).toMatchObject({
    status: "approved",
    reconciliation: "settled",
    order_status: "confirmed",
  });
  await expect(apply(p)).rejects.toThrow(/INVALID_PAYMENT/);
  expect(
    await f.scalar(
      "select count(*)::int v from public.inventory_movements where kind='consume'",
    ),
  ).toBe(1);
});
it("rollback refuses unknown evidence; when unused it restores the exact v2 definition and same permissions", async () => {
  const p = await prepare();
  await apply(p);
  await expect(f.db.exec(rollback)).rejects.toThrow(
    /UNREPORTED_EVIDENCE_PRESENT/,
  );
  await f.db.exec("rollback");
  await f.reset();
  await f.db.exec(rollback);
  expect(
    await f.scalar(
      "select pg_get_functiondef('public.mp_test_apply(uuid,text,text,jsonb)'::regprocedure) v",
    ),
  ).toEqual(definition);
  expect(
    await f.scalar(
      "select proacl::text v from pg_proc where oid='public.mp_test_apply(uuid,text,text,jsonb)'::regprocedure",
    ),
  ).toEqual(acl);
  await f.db.exec(migration);
});
it("fingerprint accepts CRLF without bypassing the required v2 contract", async () => {
  await f.db.exec(rollback);
  await f.db.exec(String(definition).replace(/\r?\n/g, "\r\n"));
  await f.db.exec(migration);
  expect(await apply(await prepare())).toMatchObject({ status: "pending" });
});
