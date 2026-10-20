import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const container = process.env.VANTA_TEST_PG_CONTAINER;
if (!container || !/^[a-zA-Z0-9_-]+$/.test(container))
  throw new Error(
    "Set VANTA_TEST_PG_CONTAINER to a disposable LOCAL PostgreSQL container. Never uses a remote DSN.",
  );
const env = { ...process.env };
for (const key of [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
])
  delete env[key];
function sql(text, db = "vanta_stage5_test") {
  return new Promise((resolve, reject) => {
    const p = spawn(
      "docker",
      [
        "--host=unix:///var/run/docker.sock",
        "exec",
        "-i",
        container,
        "psql",
        "-U",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-At",
        "-d",
        db,
      ],
      { env },
    );
    let out = "",
      err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code ? reject(new Error(err)) : resolve(out.trim()),
    );
    p.stdin.end(text);
  });
}
const a = "10000000-0000-0000-0000-000000000001",
  b = "10000000-0000-0000-0000-000000000002";
const body = (variant = a) =>
  JSON.stringify({
    items: [
      { variant_id: variant, quantity: 1, expected_price_cents: 2500050 },
    ],
    delivery: "pickup",
    payment: "cash",
  });
const create = (key = randomUUID(), owner = "a".repeat(64), p = body()) =>
  sql(`select public.demo_create_order('${key}','${owner}','${p}'::jsonb);`);
const reset = () =>
  sql(
    "delete from public.inventory_movements;delete from public.stock_reservations;delete from public.order_items;delete from public.orders;update public.inventory set on_hand=1,reserved=0;",
  );
try {
  await sql(
    "drop database if exists vanta_stage5_test;create database vanta_stage5_test;",
    "postgres",
  );
  await sql(
    `do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end$$;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`,
  );
  await sql(
    readFileSync("supabase/migrations/202610180001_initial_schema.sql", "utf8"),
  );
  await sql(
    readFileSync("supabase/migrations/202610200001_demo_orders.sql", "utf8"),
  );
  await sql(
    `insert into public.categories(id,name,slug,active) values('${a}','Local','local',true);insert into public.products(id,category_id,name,slug,price_cents,active) values('${a}','${a}','Local','local',2500050,true);insert into public.product_variants(id,product_id,sku,size,color,active) values('${a}','${a}','A','S','Negro',true),('${b}','${a}','B','M','Negro',true);insert into public.inventory(variant_id,on_hand) values('${a}',1),('${b}',1);`,
  );
  let results = await Promise.allSettled([
    create(),
    create(randomUUID(), "b".repeat(64)),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(
    results.find((r) => r.status === "rejected").reason.message,
    /INSUFFICIENT_STOCK/,
  );
  assert.equal(await sql("select count(*) from public.orders"), "1");
  assert.equal(
    await sql(`select reserved from public.inventory where variant_id='${a}'`),
    "1",
  );
  console.log("PASS two independent connections racing for the last unit");
  await reset();
  const key = randomUUID();
  results = await Promise.allSettled([create(key), create(key)]);
  assert.ok(results.every((r) => r.status === "fulfilled"));
  assert.equal(results[0].value, results[1].value);
  assert.equal(await sql("select count(*) from public.orders"), "1");
  console.log("PASS concurrent same-key retries reserve once");
  await reset();
  const receipt = JSON.parse(await create());
  await sql(
    "update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes';",
  );
  results = await Promise.allSettled([
    sql(
      `select public.demo_cancel_order('${receipt.reference}','${"a".repeat(64)}');`,
    ),
    sql("select public.demo_expire_orders();"),
  ]);
  assert.ok(results.every((r) => r.status === "fulfilled"));
  await sql(
    `select public.demo_cancel_order('${receipt.reference}','${"a".repeat(64)}');select public.demo_expire_orders();`,
  );
  assert.equal(await sql("select sum(reserved) from public.inventory"), "0");
  assert.equal(
    await sql(
      "select count(*) from public.inventory_movements where kind<>'reserve'",
    ),
    "1",
  );
  assert.equal(await sql("select status from public.orders"), "expired");
  console.log(
    "PASS cancellation vs expiry, repeated release, no negative stock",
  );
  await reset();
  await assert.rejects(
    create(
      randomUUID(),
      "a".repeat(64),
      JSON.stringify({
        items: [
          { variant_id: a, quantity: 1, expected_price_cents: 2500050 },
          { variant_id: a, quantity: 1, expected_price_cents: 2500050 },
        ],
        delivery: "pickup",
        payment: "cash",
      }),
    ),
    /INVALID_REQUEST/,
  );
  assert.equal(await sql("select count(*) from public.orders"), "0");
  console.log("PASS duplicate variants rejected without partial writes");
  await reset();
  const r = JSON.parse(await create());
  await assert.rejects(
    sql(
      `set role anon;select public.demo_cancel_order('${r.reference}','${"a".repeat(64)}');`,
    ),
    /permission denied/,
  );
  await assert.rejects(
    sql("set role anon;select * from public.orders;"),
    /permission denied/,
  );
  await assert.rejects(
    sql("set role service_role;update public.inventory set on_hand=99;"),
    /permission denied/,
  );
  console.log("PASS real PostgreSQL role privileges and private receipts");
} finally {
  await sql("drop database if exists vanta_stage5_test;", "postgres");
}
