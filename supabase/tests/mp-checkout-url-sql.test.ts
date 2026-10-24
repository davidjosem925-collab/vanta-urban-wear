// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { createEmailDb } from "./email-fixture";
import { resource } from "./mp-fixture";
import { validUrls, invalidUrls, prefix } from "./mp-url-fixture";
let f: Awaited<ReturnType<typeof createEmailDb>>;
const migration = readFileSync(
  "supabase/migrations/202610240003_mp_checkout_pref_id.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/operations/mp-checkout-pref-id-rollback.sql",
  "utf8",
);
let definition: unknown, acl: unknown;
beforeAll(async () => {
  f = await createEmailDb();
  for (const name of [
    "202610230004_admin_payments.sql",
    "202610240001_mp_payment_evidence.sql",
    "202610240002_mp_created_without_detail.sql",
  ])
    await f.db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
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
  expect(await f.scalar("select to_jsonb(p) v from public.payments p")).toEqual(
    before,
  );
  expect(
    await f.scalar("select to_jsonb(c) v from public.mp_test_config c"),
  ).toEqual(flags);
  expect(p.payment_id).toBeTruthy();
}, 30000);
beforeEach(() => f.reset());
afterEach(() => f.db.exec("rollback;reset role"));
afterAll(() => f.db.close());
async function apply(url: string, p?: Record<string, unknown>) {
  p ??= await f.prepare((await f.order("mercado_pago", false)).reference);
  return f.rpc("mp_test_apply", {
    p_id: p.payment_id,
    p_resource: resource,
    p_url: url,
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
    },
  });
}
it.each(validUrls)(
  "SQL stores the original URL exactly with no fabricated financial evidence: %s",
  async (url) => {
    const p = await f.prepare((await f.order("mercado_pago", false)).reference);
    for (let i = 0; i < 2; i++)
      expect(await apply(url, p)).toMatchObject({
        checkout_url: url,
        provider_order_id: resource,
        status: "pending",
      });
    expect(
      await f.scalar("select mp_checkout_url v from public.payments"),
    ).toBe(url);
    expect(
      await f.scalar("select mp_paid_amount_cents v from public.payments"),
    ).toBeNull();
    expect(
      await f.scalar("select count(*)::int v from public.stock_reservations"),
    ).toBe(1);
    expect(await f.scalar("select reserved v from public.inventory")).toBe(2);
  },
);
it.each([
  ...invalidUrls,
  `${prefix}order_id=ORDTSTAAAAAAAAAAAA&pref_id=${resource}`,
])("SQL rejects the same malicious/mismatched URL: %s", async (url) => {
  await expect(apply(url)).rejects.toThrow("INVALID_PAYMENT");
  expect(
    await f.scalar("select mp_order_id v from public.payments"),
  ).toBeNull();
});
it("RPC remains private with unchanged owner, search_path and ACL", async () => {
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
  expect(
    await f.scalar(
      "select prosecdef and proconfig=array['search_path=\"\"']::text[] v from pg_proc where oid='public.mp_test_apply(uuid,text,text,jsonb)'::regprocedure",
    ),
  ).toBe(true);
});
it("rollback refuses URLs requiring pref_id instead of removing provider routing data", async () => {
  await apply(validUrls[1]);
  await expect(f.db.exec(rollback)).rejects.toThrow("PREF_ID_URL_PRESENT");
});
it("unused rollback restores exactly 002 and migration refuses reapplication or unexpected versions", async () => {
  await expect(f.db.exec(migration)).rejects.toThrow(
    "CREATED_DETAIL_RPC_REQUIRED",
  );
  await f.db.exec("rollback");
  await f.db.exec(rollback);
  expect(
    await f.scalar(
      "select pg_get_functiondef('public.mp_test_apply(uuid,text,text,jsonb)'::regprocedure) v",
    ),
  ).toEqual(definition);
  await f.db.exec(migration);
});
