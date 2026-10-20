// @vitest-environment node
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, expect, it } from "vitest";
import { createDemoDb } from "./demo-fixture";
let db: Awaited<ReturnType<typeof createDemoDb>>;
const a = "10000000-0000-0000-0000-000000000001",
  b = "10000000-0000-0000-0000-000000000002";
const owner = "a".repeat(64);
const payload = (
  items = [{ variant_id: a, quantity: 2, expected_price_cents: 2500050 }],
) => ({ items, delivery: "pickup", payment: "cash" });
async function create(p: unknown = payload(), key = randomUUID(), who = owner) {
  return (
    await db.query<{ r: Record<string, unknown> }>(
      "select public.demo_create_order($1,$2,$3::jsonb) r",
      [key, who, JSON.stringify(p)],
    )
  ).rows[0].r;
}
beforeAll(async () => {
  db = await createDemoDb();
  await db.exec(
    readFileSync("supabase/migrations/202610200001_demo_orders.sql", "utf8"),
  );
  await db.exec(`insert into public.categories(id,name,slug,active) values('${a}','Remeras','remeras',true);
 insert into public.products(id,category_id,name,description,slug,price_cents,active) values('${a}','${a}','Essential','Original','essential',2500050,true);
 insert into public.product_variants(id,product_id,sku,size,color,active) values('${a}','${a}','A','S','Negro',true),('${b}','${a}','B','M','Negro',true);
 insert into public.inventory(variant_id,on_hand) values('${a}',8),('${b}',1);insert into auth.users(id) values('${a}');insert into public.admin_profiles(user_id,display_name) values('${a}','Admin');`);
}, 30000);
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec(
    `delete from public.inventory_movements;delete from public.stock_reservations;delete from public.order_items;delete from public.orders;delete from public.demo_request_limits;select set_config('request.jwt.claim.sub','',false);update public.categories set active=true;update public.inventory set reserved=0,on_hand=case when variant_id='${a}' then 8 else 1 end;update public.products set active=true,price_cents=2500050;update public.product_variants set active=true;`,
  );
});
it("reuses existing tables; valid multi-variant server snapshots, cents and exact 60m", async () => {
  const r = await create(
    payload([
      { variant_id: a, quantity: 2, expected_price_cents: 2500050 },
      { variant_id: b, quantity: 1, expected_price_cents: 2500050 },
    ]),
  );
  expect(r.subtotal_cents).toBe(7500150);
  expect(r.status).toBe("pending");
  expect(r.demo).toBe(true);
  expect(
    new Date(String(r.expires_at)).getTime() -
      new Date(String(r.created_at)).getTime(),
  ).toBe(3600000);
  expect(
    (
      await db.query(
        "select reserved,on_hand from public.inventory order by variant_id",
      )
    ).rows,
  ).toEqual([
    { reserved: 2, on_hand: 8 },
    { reserved: 1, on_hand: 1 },
  ]);
  expect(
    (
      await db.query(
        "select product_description,unit_price_cents from public.order_items",
      )
    ).rows,
  ).toEqual([
    { product_description: "Original", unit_price_cents: 2500050 },
    { product_description: "Original", unit_price_cents: 2500050 },
  ]);
  expect(
    (await db.query("select email,first_name from public.orders")).rows,
  ).toEqual([{ email: "demo@example.invalid", first_name: "Visitante" }]);
  expect(Object.keys(r).sort()).toEqual([
    "created_at",
    "demo",
    "expires_at",
    "reference",
    "status",
    "subtotal_cents",
  ]);
});
it("rolls back whole operation on insufficient stock, unpublished, unknown or changed price", async () => {
  for (const p of [
    payload([
      { variant_id: a, quantity: 2, expected_price_cents: 2500050 },
      { variant_id: b, quantity: 2, expected_price_cents: 2500050 },
    ]),
    payload([
      { variant_id: randomUUID(), quantity: 1, expected_price_cents: 2500050 },
    ]),
    payload([{ variant_id: a, quantity: 1, expected_price_cents: 1 }]),
  ]) {
    await expect(create(p)).rejects.toThrow(
      /INSUFFICIENT_STOCK|PRODUCT_UNAVAILABLE|PRICE_CHANGED/,
    );
  }
  await db.exec("update public.products set active=false");
  await expect(create()).rejects.toThrow("PRODUCT_UNAVAILABLE");
  await db.exec(
    "update public.products set active=true;update public.product_variants set active=false",
  );
  await expect(create()).rejects.toThrow("PRODUCT_UNAVAILABLE");
  expect((await db.query("select * from public.orders")).rows).toHaveLength(0);
  expect(
    (await db.query("select * from public.inventory_movements")).rows,
  ).toHaveLength(0);
  expect(
    (await db.query("select reserved from public.inventory")).rows.every(
      (r) => r.reserved === 0,
    ),
  ).toBe(true);
});
it("validates quantities, duplicates, unknown fields and nulls in SQL, not just edge", async () => {
  const i = payload().items[0];
  for (const p of [
    null,
    {},
    { ...payload(), delivery: null },
    { ...payload(), payment: null },
    { ...payload(), email: "private@example.com" },
    payload([]),
    payload([i, i]),
    ...[-1, 0, 4, 1.2, "2", null].map((q) =>
      payload([{ ...i, quantity: q as number }]),
    ),
  ])
    await expect(create(p)).rejects.toThrow();
});
it("idempotent replay does not reserve twice and cannot leak to another owner/body", async () => {
  const k = randomUUID(),
    r = await create(payload(), k);
  expect(await create(payload(), k)).toEqual(r);
  await expect(create(payload(), k, "b".repeat(64))).rejects.toThrow(
    "IDEMPOTENCY_CONFLICT",
  );
  await expect(
    create(
      payload([{ variant_id: a, quantity: 1, expected_price_cents: 2500050 }]),
      k,
    ),
  ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  expect(
    (
      await db.query(
        "select reserved from public.inventory where variant_id=$1",
        [a],
      )
    ).rows[0].reserved,
  ).toBe(2);
});
it("cancel requires capability, releases once and cannot cancel by reference alone", async () => {
  const r = await create();
  await expect(
    db.query("select public.demo_cancel_order($1,$2)", [
      r.reference,
      "b".repeat(64),
    ]),
  ).rejects.toThrow("ORDER_UNAVAILABLE");
  await db.query("select public.demo_cancel_order($1,$2)", [
    r.reference,
    owner,
  ]);
  await db.query("select public.demo_cancel_order($1,$2)", [
    r.reference,
    owner,
  ]);
  expect(
    (
      await db.query(
        "select reserved,on_hand from public.inventory where variant_id=$1",
        [a],
      )
    ).rows[0],
  ).toEqual({ reserved: 0, on_hand: 8 });
  expect(
    (
      await db.query(
        "select * from public.inventory_movements where kind='release'",
      )
    ).rows,
  ).toHaveLength(1);
});
it("expiry releases once, even if cancellation follows; no early expiry", async () => {
  const r = await create();
  expect(
    (await db.query("select public.demo_expire_orders() n")).rows[0].n,
  ).toBe(0);
  await db.exec(
    "update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes'",
  );
  expect(
    (await db.query("select public.demo_expire_orders() n")).rows[0].n,
  ).toBe(1);
  expect(
    (await db.query("select public.demo_expire_orders() n")).rows[0].n,
  ).toBe(0);
  await db.query("select public.demo_cancel_order($1,$2)", [
    r.reference,
    owner,
  ]);
  expect(
    (await db.query("select status from public.orders")).rows[0].status,
  ).toBe("expired");
  expect(
    (
      await db.query(
        "select reserved from public.inventory where variant_id=$1",
        [a],
      )
    ).rows[0].reserved,
  ).toBe(0);
});
it("admin transitions consume once, disallow refund/indefinite pending reservation", async () => {
  const r = await create();
  const id = (
    await db.query("select id from public.orders where public_reference=$1", [
      r.reference,
    ])
  ).rows[0].id;
  await db.exec(
    `insert into auth.users(id) values('${a}') on conflict do nothing;insert into public.admin_profiles(user_id,display_name) values('${a}','Admin') on conflict do nothing;select set_config('request.jwt.claim.sub','${a}',false)`,
  );
  for (const target of ["confirmed", "confirmed", "preparing", "delivered"])
    await db.query("select public.demo_admin_transition($1,$2)", [id, target]);
  await expect(
    db.query("select public.demo_admin_transition($1,$2)", [id, "cancelled"]),
  ).rejects.toThrow("INVALID_TRANSITION");
  expect(
    (
      await db.query(
        "select reserved,on_hand from public.inventory where variant_id=$1",
        [a],
      )
    ).rows[0],
  ).toEqual({ reserved: 0, on_hand: 6 });
  expect(
    (
      await db.query(
        "select count(*) n from public.inventory_movements where kind='consume'",
      )
    ).rows[0].n,
  ).toBe(1);
  await db.exec("select set_config('request.jwt.claim.sub','',false)");
});
it("denies public reads, direct writes, RPC creation/cancellation and non-admin transitions", async () => {
  await create();
  for (const role of ["anon", "authenticated"]) {
    await db.exec(
      `set role ${role};select set_config('request.jwt.claim.sub','',false)`,
    );
    try {
      for (const table of [
        "orders",
        "order_items",
        "stock_reservations",
        "inventory",
        "inventory_movements",
        "demo_request_limits",
      ]) {
        if (role === "anon" || table === "demo_request_limits")
          await expect(
            db.query(`select * from public.${table}`),
          ).rejects.toThrow(/permission denied/);
        else
          expect(
            (await db.query(`select * from public.${table}`)).rows,
          ).toHaveLength(0);
      }
      await expect(create()).rejects.toThrow(/permission denied/);
      await expect(
        db.exec("update public.inventory set on_hand=999"),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query("select public.demo_cancel_order($1,$2)", [
          randomUUID(),
          owner,
        ]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query("select public.demo_admin_transition($1,$2)", [
          randomUUID(),
          "confirmed",
        ]),
      ).rejects.toThrow(/permission denied|FORBIDDEN/);
    } finally {
      await db.exec("reset role");
    }
  }
  await db.exec("set role service_role");
  try {
    await expect(
      db.exec("update public.orders set status='confirmed'"),
    ).rejects.toThrow(/permission denied/);
  } finally {
    await db.exec("reset role");
  }
});
it("rate limiting is server-side, durable and separate from failing creation", async () => {
  for (let n = 0; n < 7; n++)
    expect(
      (await db.query("select public.demo_rate_limit($1) ok", [owner])).rows[0]
        .ok,
    ).toBe(n < 6);
  await expect(create({})).rejects.toThrow();
  expect(
    (
      await db.query(
        "select attempts from public.demo_request_limits where bucket='actor:'||repeat('a',64)",
      )
    ).rows[0].attempts,
  ).toBe(7);
});
it("retention removes only terminal old demo orders and keeps inventory unchanged", async () => {
  const r = await create();
  await db.query("select public.demo_cancel_order($1,$2)", [
    r.reference,
    owner,
  ]);
  await db.exec(
    "update public.orders set created_at=created_at-interval '31 days',reservation_expires_at=reservation_expires_at-interval '31 days'",
  );
  expect((await db.query("select public.demo_cleanup() n")).rows[0].n).toBe(1);
  expect((await db.query("select * from public.orders")).rows).toHaveLength(0);
  expect(
    (
      await db.query(
        "select on_hand,reserved from public.inventory where variant_id=$1",
        [a],
      )
    ).rows[0],
  ).toEqual({ on_hand: 8, reserved: 0 });
});

it("cleanup keeps idempotency tombstone, and missing payload never authenticates replay", async () => {
  const key = randomUUID(),
    p = payload(),
    r = await create(p, key);
  await expect(
    db.query("select public.demo_order_replay($1,$2,null)", [key, owner]),
  ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  await db.query("select public.demo_cancel_order($1,$2)", [
    r.reference,
    owner,
  ]);
  await db.exec(
    "update public.orders set created_at=created_at-interval '31 days',reservation_expires_at=reservation_expires_at-interval '31 days'",
  );
  await db.exec("select public.demo_cleanup()");
  await expect(create(p, key)).rejects.toThrow("IDEMPOTENCY_EXPIRED");
  expect((await db.query("select * from public.orders")).rows).toHaveLength(0);
});
it("server caps active demo orders per capability even with new keys", async () => {
  await create();
  await create();
  await expect(create()).rejects.toThrow("DEMO_CAPACITY");
  expect(
    (
      await db.query(
        "select reserved from public.inventory where variant_id=$1",
        [a],
      )
    ).rows[0].reserved,
  ).toBe(4);
});
it("global limiter cannot be bypassed by rotating actor identifiers", async () => {
  for (let n = 0; n < 61; n++)
    expect(
      (await db.query("select public.demo_admit_creation() ok")).rows[0].ok,
    ).toBe(n < 60);
});
it("stale reservation cannot be consumed by an administrative confirmation", async () => {
  const r = await create();
  await db.exec(
    "update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes'",
  );
  const id = (
    await db.query("select id from public.orders where public_reference=$1", [
      r.reference,
    ])
  ).rows[0].id;
  await db.exec(`select set_config('request.jwt.claim.sub','${a}',false)`);
  try {
    await db.query("select public.demo_admin_transition($1,$2)", [
      id,
      "confirmed",
    ]);
  } finally {
    await db.exec("select set_config('request.jwt.claim.sub','',false)");
  }
  expect(
    (await db.query("select status from public.orders")).rows[0].status,
  ).toBe("expired");
  expect(
    (
      await db.query(
        "select reserved,on_hand from public.inventory where variant_id=$1",
        [a],
      )
    ).rows[0],
  ).toEqual({ reserved: 0, on_hand: 8 });
});
it("audited admin adjustments preserve reserved stock and are idempotent", async () => {
  await create();
  const key = randomUUID();
  await expect(
    db.query("select public.demo_admin_adjust_inventory($1,1,$2,$3)", [
      a,
      "Demo adjustment",
      key,
    ]),
  ).rejects.toThrow("FORBIDDEN");
  await db.exec(`select set_config('request.jwt.claim.sub','${a}',false)`);
  try {
    expect(
      (
        await db.query(
          "select public.demo_admin_adjust_inventory($1,1,$2,$3) ok",
          [a, "Demo adjustment", key],
        )
      ).rows[0].ok,
    ).toBe(true);
    expect(
      (
        await db.query(
          "select public.demo_admin_adjust_inventory($1,1,$2,$3) ok",
          [a, "Demo adjustment", key],
        )
      ).rows[0].ok,
    ).toBe(false);
    await expect(
      db.query("select public.demo_admin_adjust_inventory($1,-8,$2,$3)", [
        a,
        "Demo adjustment",
        randomUUID(),
      ]),
    ).rejects.toThrow("INVALID_STOCK_ADJUSTMENT");
    expect(
      (
        await db.query(
          "select quantity,actor_id from public.inventory_movements where kind='adjust'",
        )
      ).rows,
    ).toEqual([{ quantity: 1, actor_id: a }]);
  } finally {
    await db.exec("select set_config('request.jwt.claim.sub','',false)");
  }
});

it("service RPC works while direct tables remain unwritable, with no public EXECUTE", async () => {
  await db.exec("set role service_role");
  try {
    const r = await create();
    expect(r.status).toBe("pending");
  } finally {
    await db.exec("reset role");
  }
  await db.exec("update public.categories set active=false");
  await expect(create()).rejects.toThrow("PRODUCT_UNAVAILABLE");
  const funcs = (
    await db.query(
      "select proname,proconfig from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and proname like 'demo_%' and prosecdef",
    )
  ).rows;
  expect(funcs.length).toBeGreaterThan(5);
  expect(
    funcs.every((f) => (f.proconfig as string[]).includes('search_path=""')),
  ).toBe(true);
});
it("service-only lifecycle survives DML revocation; helpers/jobs cannot be invoked by API roles", async () => {
  let r: Record<string, unknown>;
  await db.exec("set role service_role");
  try {
    r = await create();
    const replay = await db.query(
      "select public.demo_order_replay($1,$2,$3::jsonb) r",
      [
        (await db.query("select idempotency_key from public.orders")).rows[0]
          .idempotency_key,
        owner,
        JSON.stringify(payload()),
      ],
    );
    expect(replay.rows[0].r).toEqual(r);
    await db.query("select public.demo_cancel_order($1,$2)", [
      r.reference,
      owner,
    ]);
    for (const fn of [
      "demo_expire_orders()",
      "demo_cleanup()",
      `demo_resolve_order('${a}','confirmed')`,
      `demo_admin_transition('${a}','confirmed')`,
    ])
      await expect(db.query("select public." + fn)).rejects.toThrow(
        /permission denied/,
      );
    for (const table of [
      "orders",
      "order_items",
      "inventory",
      "stock_reservations",
      "inventory_movements",
    ])
      for (const privilege of [
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
      ])
        expect(
          (
            await db.query(
              "select has_table_privilege(current_user,$1,$2) ok",
              ["public." + table, privilege],
            )
          ).rows[0].ok,
        ).toBe(false);
  } finally {
    await db.exec("reset role");
  }
  const order = (await db.query("select status from public.orders")).rows[0];
  expect(order.status).toBe("cancelled");
  expect(
    (
      await db.query(
        "select reserved from public.inventory where variant_id=$1",
        [a],
      )
    ).rows[0].reserved,
  ).toBe(0);
});
it("anonymous EXECUTE is absent on every demo function, including new defaults", async () => {
  const fns = (
    await db.query(
      "select p.oid,proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'demo_%'",
    )
  ).rows;
  for (const fn of fns) {
    expect(
      (
        await db.query(
          "select has_function_privilege('anon',$1::oid,'EXECUTE') ok",
          [fn.oid],
        )
      ).rows[0].ok,
    ).toBe(false);
  }
});

it("post-deployment read-only verification script is compatible with the migrated schema", async () => {
  await create();
  await db.exec(readFileSync("supabase/operations/stage-5-verify.sql", "utf8"));
});
it("migration fails atomically if PUBLIC/inheritance leaves unexpected write privileges", async () => {
  const isolated = await createDemoDb();
  try {
    await isolated.exec("grant trigger on public.inventory to public");
    await expect(
      isolated.exec(
        readFileSync(
          "supabase/migrations/202610200001_demo_orders.sql",
          "utf8",
        ),
      ),
    ).rejects.toThrow(/Unexpected effective TRIGGER privilege/);
    await isolated.exec("rollback");
    expect(
      (
        await isolated.query(
          "select column_name from information_schema.columns where table_schema='public' and table_name='orders' and column_name='is_demo'",
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await isolated.query(
          "select to_regprocedure('public.demo_create_order(uuid,text,jsonb)') fn",
        )
      ).rows[0].fn,
    ).toBeNull();
  } finally {
    await isolated.close();
  }
});
it("migration preserves legacy paid orders and existing inventory without converting or reserving data", async () => {
  const isolated = await createDemoDb();
  try {
    await isolated.exec(
      `insert into public.orders(idempotency_key,request_hash,status,first_name,last_name,email,phone,subtotal_cents) values(gen_random_uuid(),repeat('a',64),'paid','Old','Demo','old@example.invalid','00000000',500);insert into public.categories(id,name,slug,active) values('${a}','Local','local',true);insert into public.products(id,category_id,name,slug,price_cents,active) values('${a}','${a}','Local','local',500,true);insert into public.product_variants(id,product_id,sku,size,color,active) values('${a}','${a}','LOCAL','M','Negro',true);insert into public.inventory(variant_id,on_hand) values('${a}',6);`,
    );
    const inventory = (await isolated.query("select * from public.inventory"))
      .rows;
    await isolated.exec(
      readFileSync("supabase/operations/stage-5-preflight.sql", "utf8"),
    );
    await isolated.exec(
      readFileSync("supabase/migrations/202610200001_demo_orders.sql", "utf8"),
    );
    expect(
      (
        await isolated.query(
          "select status,is_demo,public_reference from public.orders",
        )
      ).rows,
    ).toEqual([{ status: "paid", is_demo: false, public_reference: null }]);
    expect(
      (await isolated.query("select * from public.inventory")).rows,
    ).toEqual(inventory);
  } finally {
    await isolated.close();
  }
});
