// @vitest-environment node
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { createDemoDb } from "./demo-fixture";
import { makeHandler, sha } from "../functions/demo-orders/handler";
let db: Awaited<ReturnType<typeof createDemoDb>>;
const variant = "10000000-0000-0000-0000-000000000001",
  capability = "b".repeat(64);
const payload = {
  items: [{ variant_id: variant, quantity: 2, expected_price_cents: 2500050 }],
  delivery: "pickup",
  payment: "transfer",
};
const phase3 = readFileSync(
  "supabase/migrations/202610230002_checkout_payments.sql",
  "utf8",
);
async function scalar(sql: string, params: unknown[] = []) {
  return (await db.query<{ v: unknown }>(sql, params)).rows[0]?.v;
}
async function create(payment = "transfer") {
  return (await scalar("select public.demo_create_order($1,$2,$3::jsonb) v", [
    randomUUID(),
    await sha(capability),
    JSON.stringify({ ...payload, payment }),
  ])) as { reference: string };
}
async function transfer(reference: string, owner?: string) {
  return (await scalar("select public.demo_transfer_payment($1,$2) v", [
    reference,
    owner ?? (await sha(capability)),
  ])) as Record<string, unknown>;
}
beforeAll(async () => {
  db = await createDemoDb();
  await db.exec(
    "create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;",
  );
  for (const file of [
    "202610200001_demo_orders.sql",
    "202610200002_admin_panel.sql",
    "202610230001_mp_test_backend.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.exec(phase3);
  await db.exec(`insert into public.categories(id,name,slug,active) values('${variant}','Remeras','remeras',true);
    insert into public.products(id,category_id,name,description,slug,price_cents,active) values('${variant}','${variant}','Essential','Original','essential',2500050,true);
    insert into public.product_variants(id,product_id,sku,size,color,active) values('${variant}','${variant}','A','S','Negro',true);
    insert into public.inventory(variant_id,on_hand) values('${variant}',8);`);
}, 30000);
afterAll(async () => db.close());
afterEach(async () => db.exec("reset role;rollback;"));
beforeEach(async () =>
  db.exec(`reset role;delete from public.payment_events;delete from public.payments;delete from public.inventory_movements;
  delete from public.stock_reservations;delete from public.order_items;delete from public.orders;delete from public.demo_request_limits;
  update public.inventory set reserved=0,on_hand=8;update public.mp_test_config set enabled=true,seller_id='123',application_id='456';`),
);
it("prepares one pending transfer with exact server total on replay, never consumes or duplicates reserves", async () => {
  const o = await create();
  await db.exec("set role service_role");
  const first = await transfer(o.reference),
    second = await transfer(o.reference);
  expect(first).toEqual(second);
  expect(first).toMatchObject({
    reference: o.reference,
    amount_cents: 5000100,
    payment_status: "pending",
    order_status: "pending",
    checkout_url: null,
  });
  await db.exec("reset role");
  expect(await scalar("select count(*)::int v from public.payments")).toBe(1);
  expect(await scalar("select count(*)::int v from public.orders")).toBe(1);
  expect(
    (await db.query("select on_hand,reserved from public.inventory")).rows[0],
  ).toEqual({ on_hand: 8, reserved: 2 });
});
it("wrong capability, wrong method and unauthorized SQL roles cannot prepare/read payment", async () => {
  const o = await create();
  await expect(transfer(o.reference, "a".repeat(64))).rejects.toThrow(
    "ORDER_UNAVAILABLE",
  );
  const mp = await create("mercado_pago");
  await expect(transfer(mp.reference)).rejects.toThrow("ORDER_UNAVAILABLE");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await expect(transfer(o.reference)).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  }
  expect(await scalar("select count(*)::int v from public.payments")).toBe(0);
});
it("expiry releases stock exactly once and exposes separate expired payment/order states", async () => {
  const o = await create();
  await transfer(o.reference);
  await db.exec(
    "update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes'",
  );
  expect(await transfer(o.reference)).toMatchObject({
    order_status: "expired",
    payment_status: "expired",
  });
  await transfer(o.reference);
  expect(
    (await db.query("select on_hand,reserved from public.inventory")).rows[0],
  ).toEqual({ on_hand: 8, reserved: 0 });
});
it("cancellation releases stock once and never becomes browser-approved", async () => {
  const o = await create();
  await transfer(o.reference);
  await scalar("select public.demo_cancel_order($1,$2) v", [
    o.reference,
    await sha(capability),
  ]);
  expect(await transfer(o.reference)).toMatchObject({
    order_status: "cancelled",
    payment_status: "cancelled",
  });
  expect(
    (await db.query("select on_hand,reserved from public.inventory")).rows[0],
  ).toEqual({ on_hand: 8, reserved: 0 });
});
it("phase-3 returns all lead to server consultation; old frozen provider requests remain untouched", async () => {
  const o = await create("mercado_pago");
  const p = (await scalar(
    "select public.mp_test_prepare($1,$2,true,'https://store.example') v",
    [o.reference, await sha(capability)],
  )) as { request: { config: unknown } };
  expect(p.request.config).toEqual({
    online: {
      success_url: "https://store.example/#/checkout/pago",
      failure_url: "https://store.example/#/checkout/pago",
      pending_url: "https://store.example/#/checkout/pago",
    },
  });
  await db.exec(
    readFileSync("supabase/operations/stage-8-checkout-rollback.sql", "utf8"),
  );
  const same = await scalar(
    "select public.mp_test_prepare($1,$2,false,'https://store.example') v",
    [o.reference, await sha(capability)],
  );
  expect(same).toMatchObject({ request: p.request });
  expect(await scalar("select count(*)::int v from public.payments")).toBe(1);
  await db.exec(phase3);
});
it("new Edge action uses existing limiter/origin/capability; forged money/status rejected before SQL", async () => {
  const o = await create();
  const handler = makeHandler(
    {
      origin: "http://localhost:5173",
      challengeHostname: "localhost",
      challengeSecret: "fixture",
      actorSecret: "a".repeat(32),
    },
    async (name, args) => {
      const keys = Object.keys(args);
      try {
        await db.exec("set role service_role");
        return {
          data: await scalar(
            `select public.${name}(${keys.map((k, i) => `${k}=>$${i + 1}`).join(",")}) v`,
            Object.values(args),
          ),
          error: null,
        };
      } catch {
        return { data: null, error: { message: "UNAVAILABLE" } };
      } finally {
        await db.exec("reset role");
      }
    },
  );
  const request = (body: object, origin = "http://localhost:5173") =>
    new Request(origin, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    });
  const body = { action: "transfer", reference: o.reference, capability };
  expect(
    (
      await handler(
        request({ ...body, amount_cents: 1, payment_status: "approved" }),
      )
    ).status,
  ).toBe(400);
  expect((await handler(request(body, "https://evil.example"))).status).toBe(
    403,
  );
  expect(
    (await handler(request({ ...body, capability: "a".repeat(64) }))).status,
  ).toBe(503);
  expect(await (await handler(request(body))).json()).toMatchObject({
    payment_status: "pending",
    amount_cents: 5000100,
  });
  expect(await scalar("select count(*)::int v from public.payments")).toBe(1);
  // Even a valid authorized request cannot confirm through a browser-supplied status.
  expect((await handler(request({ ...body, status: "approved" }))).status).toBe(
    400,
  );
});
