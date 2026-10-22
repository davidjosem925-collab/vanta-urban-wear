// @vitest-environment node
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { createDemoDb } from "./demo-fixture";
let db: Awaited<ReturnType<typeof createDemoDb>>;
const variant = "10000000-0000-0000-0000-000000000001",
  owner = "a".repeat(64),
  resource = "ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP9";
const migration = readFileSync(
  "supabase/migrations/202610230001_mp_test_backend.sql",
  "utf8",
);
const payload = {
  items: [{ variant_id: variant, quantity: 2, expected_price_cents: 2500050 }],
  delivery: "pickup",
  payment: "mercado_pago",
};
async function scalar(sql: string, args: unknown[] = []) {
  return (await db.query<{ v: unknown }>(sql, args)).rows[0]?.v;
}
async function order(method = "mercado_pago") {
  return (await scalar("select public.demo_create_order($1,$2,$3::jsonb) v", [
    randomUUID(),
    owner,
    JSON.stringify({ ...payload, payment: method }),
  ])) as { reference: string };
}
async function prepare(reference: string, who = owner, create = true) {
  return (await scalar("select public.mp_test_prepare($1,$2,$3,$4) v", [
    reference,
    who,
    create,
    "https://shop.example",
  ])) as Record<string, unknown>;
}
const snap = (reference: string, extra: Record<string, unknown> = {}) => ({
  reference,
  seller_id: "123",
  application_id: "456",
  currency: "ARS",
  amount_cents: 5000100,
  paid_cents: 5000100,
  updated_at: new Date().toISOString(),
  state: "approved",
  detail: "accredited",
  ...extra,
});
async function apply(
  p: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  id = resource,
) {
  return (await scalar("select public.mp_test_apply($1,$2,$3,$4) v", [
    p.payment_id,
    id,
    `https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=${id}`,
    JSON.stringify(snap(String(p.reference), extra)),
  ])) as Record<string, unknown>;
}
async function inventory() {
  return (await db.query("select on_hand,reserved from public.inventory"))
    .rows[0];
}
beforeAll(async () => {
  db = await createDemoDb();
  await db.exec(
    "create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('request.jwt.claim.aal',true))$$;",
  );
  for (const file of [
    "202610200001_demo_orders.sql",
    "202610200002_admin_panel.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.exec(migration);
  await db.exec(`insert into auth.users(id) values('${variant}');insert into public.admin_profiles(user_id,display_name) values('${variant}','Local admin');
 insert into public.categories(id,name,slug,active) values('${variant}','Remeras','remeras',true);
 insert into public.products(id,category_id,name,description,slug,price_cents,active) values('${variant}','${variant}','Essential','Original','essential',2500050,true);
 insert into public.product_variants(id,product_id,sku,size,color,active) values('${variant}','${variant}','A','S','Negro',true);
 insert into public.inventory(variant_id,on_hand) values('${variant}',8);`);
}, 30000);
afterAll(async () => db.close());
afterEach(async () => {
  await db.exec("rollback;reset role;");
});
beforeEach(async () => {
  await db.exec(`reset role;delete from public.payment_events;delete from public.payments;delete from public.inventory_movements;delete from public.stock_reservations;delete from public.order_items;delete from public.orders;
 update public.mp_test_config set enabled=true,seller_id='123',application_id='456';update public.inventory set on_hand=8,reserved=0;`);
});
it("ships disabled and retains all historical payment statuses and exact grants for rollback", async () => {
  const fresh = await createDemoDb();
  try {
    await fresh.exec(
      readFileSync("supabase/migrations/202610200001_demo_orders.sql", "utf8"),
    );
    await fresh.exec(
      "create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;",
    );
    await fresh.exec(
      readFileSync("supabase/migrations/202610200002_admin_panel.sql", "utf8"),
    );
    await fresh.exec(migration);
    expect(
      await fresh.query(
        "select enabled,seller_id,application_id from public.mp_test_config",
      ),
    ).toMatchObject({
      rows: [{ enabled: false, seller_id: null, application_id: null }],
    });
  } finally {
    await fresh.close();
  }
});
it("prepares one payment from server snapshots with fractional cents and no new reservation; immutable request survives retry/catalog changes", async () => {
  const o = await order();
  const p = await prepare(o.reference);
  expect(p.amount_cents).toBe(5000100);
  expect(p.request).toMatchObject({
    type: "online",
    processing_mode: "manual",
    total_amount: "50001.00",
    items: [{ quantity: 2, unit_price: "25000.50" }],
  });
  await db.exec("update public.products set price_cents=1");
  expect(await prepare(o.reference)).toEqual(p);
  expect(await scalar("select count(*)::int v from public.payments")).toBe(1);
  expect(await inventory()).toEqual({ on_hand: 8, reserved: 2 });
  await db.exec("update public.products set price_cents=2500050");
});
it("wrong capability, non-MP method, expired order and disabled creation never prepare payments", async () => {
  const o = await order();
  await expect(prepare(o.reference, "b".repeat(64))).rejects.toThrow(
    /ORDER_UNAVAILABLE/,
  );
  const legacy = await order("cash");
  await expect(prepare(legacy.reference)).rejects.toThrow(/ORDER_UNAVAILABLE/);
  await db.exec("update public.mp_test_config set enabled=false");
  await expect(prepare(o.reference)).rejects.toThrow(/PAYMENTS_DISABLED/);
  expect(await scalar("select count(*)::int v from public.payments")).toBe(0);
});
it("recovery without a payment never creates one; creation claims serialize outbound writes", async () => {
  const o = await order();
  expect(await prepare(o.reference, owner, false)).toBeNull();
  const p = await prepare(o.reference);
  expect(
    await scalar("select public.mp_test_claim_create($1) v", [p.payment_id]),
  ).toBe(true);
  expect(
    await scalar("select public.mp_test_claim_create($1) v", [p.payment_id]),
  ).toBe(false);
  expect(await prepare(o.reference, owner, false)).toMatchObject({
    payment_id: p.payment_id,
  });
});
it("approved snapshots consume once; duplicate delivery and old events cannot undo the settlement", async () => {
  const p = await prepare((await order()).reference);
  expect(await apply(p)).toMatchObject({
    status: "approved",
    reconciliation: "settled",
    order_status: "confirmed",
  });
  await apply(p);
  await apply(p, {
    state: "pending",
    detail: "pending",
    paid_cents: 0,
    updated_at: "2020-01-01T00:00:00Z",
  });
  expect(await inventory()).toEqual({ on_hand: 6, reserved: 0 });
  expect(
    await scalar(
      "select count(*)::int v from public.inventory_movements where kind='consume'",
    ),
  ).toBe(1);
  expect(await scalar("select status v from public.payments")).toBe("approved");
});
it.each([
  "currency",
  "seller_id",
  "application_id",
  "amount_cents",
  "reference",
  "paid_cents",
])("rejects forged %s without consuming or linking", async (field) => {
  const p = await prepare((await order()).reference);
  await expect(
    apply(p, {
      [field]: field === "amount_cents" || field === "paid_cents" ? 1 : "wrong",
    }),
  ).rejects.toThrow(/INVALID_PAYMENT/);
  expect(await inventory()).toEqual({ on_hand: 8, reserved: 2 });
  expect(await scalar("select mp_order_id v from public.payments")).toBeNull();
});
it("rejected attempt stays retryable and a subsequent approval consumes once", async () => {
  const p = await prepare((await order()).reference);
  expect(
    await apply(p, { state: "rejected", detail: "rejected", paid_cents: 0 }),
  ).toMatchObject({ status: "rejected", order_status: "pending" });
  expect(await inventory()).toEqual({ on_hand: 8, reserved: 2 });
  expect(await apply(p)).toMatchObject({
    status: "approved",
    order_status: "confirmed",
  });
});
it("cancelled provider result releases once; later approval is recorded for review without reopening stock", async () => {
  const p = await prepare((await order()).reference);
  expect(
    await apply(p, { state: "cancelled", detail: "cancelled", paid_cents: 0 }),
  ).toMatchObject({ status: "cancelled", order_status: "cancelled" });
  expect(await apply(p)).toMatchObject({
    status: "approved",
    reconciliation: "review",
    order_status: "cancelled",
  });
  expect(await inventory()).toEqual({ on_hand: 8, reserved: 0 });
});
it("expiry at 60 minutes is unchanged; late paid result never reopens or consumes released inventory", async () => {
  const p = await prepare((await order()).reference);
  await db.exec(
    "update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes';select public.demo_expire_orders();",
  );
  expect(await apply(p)).toMatchObject({
    status: "approved",
    reconciliation: "review",
    order_status: "expired",
  });
  await apply(p);
  await db.exec("select public.demo_expire_orders();");
  expect(await inventory()).toEqual({ on_hand: 8, reserved: 0 });
  expect(
    await scalar(
      "select count(*)::int v from public.inventory_movements where kind='consume'",
    ),
  ).toBe(0);
});
it("refund/partial status never restores inventory or marks an unverified payment settled", async () => {
  const p = await prepare((await order()).reference);
  expect(
    await apply(p, { state: "review", detail: "partial", paid_cents: 1 }),
  ).toMatchObject({
    status: "pending",
    reconciliation: "review",
    order_status: "pending",
  });
  await apply(p);
  expect(
    await apply(p, { state: "refunded", detail: "refunded", paid_cents: 0 }),
  ).toMatchObject({ status: "refunded", reconciliation: "review" });
  await apply(p);
  expect(await scalar("select status v from public.payments")).toBe("refunded");
  expect(await inventory()).toEqual({ on_hand: 6, reserved: 0 });
});
it("legacy admin confirmation is denied for an unverified MP payment; ordinary demo orders remain operable", async () => {
  const p = await prepare((await order()).reference);
  const legacy = await order("cash");
  await db.exec(
    `select set_config('request.jwt.claim.sub','${variant}',false);select set_config('request.jwt.claim.aal','aal2',false);set role authenticated;`,
  );
  const id = await scalar(
    "select id v from public.orders where public_reference=$1",
    [p.reference],
  );
  await expect(
    scalar("select public.demo_admin_transition($1,'confirmed') v", [id]),
  ).rejects.toThrow(/PAYMENT_NOT_VERIFIED/);
  const old = await scalar(
    "select id v from public.orders where public_reference=$1",
    [legacy.reference],
  );
  expect(
    await scalar("select public.demo_admin_transition($1,'confirmed') v", [
      old,
    ]),
  ).toBe(true);
});
it.each(["anon", "authenticated", "service_role"])(
  "denies direct DML, and %s cannot use internal functions",
  async (role) => {
    const p = await prepare((await order()).reference);
    await db.exec(`set role ${role}`);
    await expect(
      db.exec("update public.payments set status='approved'"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      scalar("select public.mp_test_context($1) v", [p.payment_id]),
    ).rejects.toThrow(/permission denied/);
    if (role !== "service_role")
      await expect(
        scalar("select public.mp_test_prepare($1,$2,true,$3) v", [
          p.reference,
          owner,
          "https://shop.example",
        ]),
      ).rejects.toThrow(/permission denied/);
  },
);
it("deduplicates signed inbox events and leases; work is recoverable and records no raw body", async () => {
  const event = `mp:${"b".repeat(64)}`;
  const id = await scalar("select public.mp_test_accept_event($1,$2) v", [
    event,
    resource,
  ]);
  expect(
    await scalar("select public.mp_test_accept_event($1,$2) v", [
      event,
      resource,
    ]),
  ).toBe(id);
  expect(await scalar("select public.mp_test_claim_event($1) v", [id])).toBe(
    true,
  );
  expect(await scalar("select public.mp_test_claim_event($1) v", [id])).toBe(
    false,
  );
  await scalar("select public.mp_test_finish_event($1,'retry') v", [id]);
  await db.exec(
    "update public.payment_events set mp_next_check=clock_timestamp()-interval '1 second'",
  );
  const work = (await scalar("select public.mp_test_claim_work() v")) as {
    events: unknown[];
  };
  expect(work.events).toHaveLength(1);
  expect(
    (
      (await scalar("select public.mp_test_claim_work() v")) as {
        events: unknown[];
      }
    ).events,
  ).toHaveLength(0);
  await scalar("select public.mp_test_finish_event($1,'ok') v", [id]);
  expect(await scalar("select public.mp_test_claim_event($1) v", [id])).toBe(
    false,
  );
});

it("operational disable preserves existing settlement/expiry; full rollback refuses activity", async () => {
  const p = await prepare((await order()).reference);
  await db.exec(
    readFileSync("supabase/operations/stage-8-disable.sql", "utf8"),
  );
  expect(await apply(p)).toMatchObject({ order_status: "confirmed" });
  await expect(
    db.exec(readFileSync("supabase/operations/stage-8-rollback.sql", "utf8")),
  ).rejects.toThrow(/activity exists/);
  await db.exec("rollback");
  expect(await inventory()).toEqual({ on_hand: 6, reserved: 0 });
});
it("full rollback before use restores exact privileges, removes only stage-8 schema and preserves a historical order", async () => {
  const legacy = await order("cash");
  const acl = (await scalar(
    "select previous_grants v from public.mp_test_config",
  )) as unknown[];
  await db.exec(
    readFileSync("supabase/operations/stage-8-rollback.sql", "utf8"),
  );
  expect(
    await scalar(
      "select count(*)::int v from public.orders where public_reference=$1",
      [legacy.reference],
    ),
  ).toBe(1);
  expect(
    await scalar(
      "select to_regprocedure('public.demo_expire_orders()')::text v",
    ),
  ).toBe("demo_expire_orders()");
  const after = await scalar(
    "select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'privilege',a.privilege_type,'grantable',a.is_grantable)),'[]'::jsonb) v from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where n.nspname='public' and c.relname in ('payments','payment_events') and a.grantee=(select oid from pg_roles where rolname='service_role')",
  );
  expect(after).toEqual(acl);
  await db.exec(migration);
});
it("operator read-only verification queries execute against the migration; activation template cannot silently enable missing IDs", async () => {
  await db.exec(
    readFileSync("supabase/operations/stage-8-preflight.sql", "utf8"),
  );
  await db.exec(readFileSync("supabase/operations/stage-8-verify.sql", "utf8"));
  await db.exec("update public.mp_test_config set enabled=false");
  await expect(
    db.exec(
      readFileSync("supabase/operations/stage-8-activate.example.sql", "utf8"),
    ),
  ).rejects.toThrow(/Configure verified test IDs/);
  await db.exec("rollback");
  expect(await scalar("select enabled v from public.mp_test_config")).toBe(
    false,
  );
});
it("SQL independently rejects a checkout URL that only ends with the resource ID", async () => {
  const p = await prepare((await order()).reference);
  await expect(
    scalar("select public.mp_test_apply($1,$2,$3,$4) v", [
      p.payment_id,
      resource,
      `https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=ORDTSTAAAAAAAAAA${resource}`,
      JSON.stringify(snap(String(p.reference))),
    ]),
  ).rejects.toThrow(/INVALID_PAYMENT/);
  expect(await inventory()).toEqual({ on_hand: 8, reserved: 2 });
});
