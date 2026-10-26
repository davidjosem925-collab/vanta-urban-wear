// Disposable LOCAL PostgreSQL only; no remote DSN, order API or payment provider.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const container = process.env.VANTA_TEST_PG_CONTAINER;
if (!container || !/^[a-zA-Z0-9_-]+$/.test(container))
  throw Error(
    "Set VANTA_TEST_PG_CONTAINER to a disposable LOCAL PostgreSQL container",
  );
const database = `vanta_rates_${randomUUID().replaceAll("-", "")}`;
const env = { ...process.env };
for (const key of [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
])
  delete env[key];
function sql(text, db = database) {
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
        "-q",
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
    p.on("close", (code) => (code ? reject(Error(err)) : resolve(out.trim())));
    p.stdin.end(text);
  });
}
const file = (path) => readFileSync(path, "utf8");
const migration = file(
  "supabase/migrations/202610260001_public_demo_rate_limits.sql",
);
const rollback = file("supabase/operations/public-demo-rate-rollback.sql");
const preflight = file("supabase/operations/public-demo-rate-preflight.sql");
const actor = "a".repeat(64);
const race = async (query) =>
  (await Promise.all(Array.from({ length: 20 }, () => sql(query)))).flatMap(
    (x) => x.split("\n"),
  );
try {
  await sql(`create database ${database}`, "postgres");
  await sql(
    `do $$begin if not exists(select 1 from pg_roles where rolname='anon')then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated')then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role')then create role service_role bypassrls;end if;end$$;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`,
  );
  await sql(file("supabase/migrations/202610180001_initial_schema.sql"));
  await sql(file("supabase/migrations/202610200001_demo_orders.sql"));
  const old = await sql(
    "select pg_get_functiondef('public.demo_rate_limit(text)'::regprocedure)",
  );
  await sql(preflight);
  await sql(migration);
  await sql(file("supabase/operations/public-demo-rate-verify.sql"));
  const result = await race(
    `set role service_role;select public.demo_rate_limit('${actor}') from generate_series(1,4)`,
  );
  assert.equal(result.filter((x) => x === "t").length, 60);
  assert.equal(result.filter((x) => x === "f").length, 20);
  assert.equal(
    await sql("select attempts from public.demo_request_limits"),
    "80",
  );
  console.log(
    "PASS concurrent actor requests: exactly 60 of 80 admitted, no lost increments",
  );
  await sql(
    "update public.demo_request_limits set window_start=clock_timestamp()-interval '61 minutes'",
  );
  const renew = await race(
    `set role service_role;select public.demo_rate_limit('${actor}')`,
  );
  assert.equal(renew.filter((x) => x === "t").length, 20);
  assert.equal(
    await sql("select attempts from public.demo_request_limits"),
    "20",
  );
  console.log(
    "PASS concurrent expired-window renewal: one reset, 20 durable increments",
  );
  const global = await race(
    "set role service_role;select public.demo_admit_creation() from generate_series(1,4)",
  );
  assert.equal(global.filter((x) => x === "t").length, 60);
  assert.equal(global.filter((x) => x === "f").length, 20);
  assert.equal(
    await sql(
      `set role service_role;select public.demo_rate_limit('${"b".repeat(64)}')`,
    ),
    "t",
  );
  console.log(
    "PASS concurrent global admission stays independent: exactly 60 of 80 admitted",
  );
  await sql(rollback);
  assert.equal(
    await sql(
      "select pg_get_functiondef('public.demo_rate_limit(text)'::regprocedure)",
    ),
    old,
  );
  await sql(
    file("supabase/tests/fixtures/demo-rate-limit-legacy.sql").replace(
      "create function",
      "create or replace function",
    ),
  );
  const legacy = await sql(
    "select pg_get_functiondef('public.demo_rate_limit(text)'::regprocedure)",
  );
  await sql(preflight);
  await sql(migration);
  await sql(file("supabase/operations/public-demo-rate-verify.sql"));
  await sql(rollback);
  assert.equal(
    await sql(
      "select pg_get_functiondef('public.demo_rate_limit(text)'::regprocedure)",
    ),
    legacy,
  );
  console.log(
    "PASS exact repository/legacy predecessor compatibility and rollback without counter resets",
  );
  await sql(old);
  await sql(migration);
  await assert.rejects(sql(migration), /UNEXPECTED_RATE_DEFINITION/);
  assert.equal(
    await sql(
      "select has_function_privilege('anon','public.demo_rate_limit(text)','EXECUTE')",
    ),
    "f",
  );
  assert.equal(
    await sql(
      "select has_function_privilege('authenticated','public.demo_rate_limit(text)','EXECUTE')",
    ),
    "f",
  );
  console.log("PASS drift/reapplication blocked and API roles remain denied");
  // Existing capacity/reservation primitives are untouched by the rate migration.
  const v = "10000000-0000-0000-0000-000000000001";
  await sql(
    `insert into public.categories(id,name,slug,active)values('${v}','Local','local',true);insert into public.products(id,category_id,name,slug,price_cents,active)values('${v}','${v}','Local','local',100,true);insert into public.product_variants(id,product_id,sku,size,color,active)values('${v}','${v}','A','S','Negro',true);insert into public.inventory(variant_id,on_hand)values('${v}',1000)`,
  );
  const payload = JSON.stringify({
    items: [{ variant_id: v, quantity: 1, expected_price_cents: 100 }],
    delivery: "pickup",
    payment: "cash",
  });
  const key = randomUUID();
  const create = (n, k = randomUUID()) =>
    sql(
      `set role service_role;select public.demo_create_order('${k}','${n.toString(16).padStart(64, "0")}','${payload}')`,
    );
  const dup = await Promise.all([create(1, key), create(1, key)]);
  assert.equal(dup[0], dup[1]);
  assert.equal(
    await sql("select count(*) from public.stock_reservations"),
    "1",
  );
  const rest = await Promise.allSettled(
    Array.from({ length: 25 }, (_, i) => create(i + 2)),
  );
  assert.equal(rest.filter((r) => r.status === "fulfilled").length, 19);
  assert.equal(
    await sql("select count(*) from public.orders where status='pending'"),
    "20",
  );
  assert.equal(await sql("select reserved from public.inventory"), "20");
  console.log(
    "PASS concurrent duplicate/order flood preserves idempotency and the 20-pending cap",
  );
  // Supply four variants to exercise the 80-unit cap with twelve-unit orders.
  await sql(
    "delete from public.inventory_movements;delete from public.stock_reservations;delete from public.order_items;delete from public.orders;update public.inventory set reserved=0",
  );
  const variants = [v];
  for (let i = 2; i <= 4; i++) {
    const id = `10000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
    variants.push(id);
    await sql(
      `insert into public.product_variants(id,product_id,sku,size,color,active)values('${id}','${v}','SKU${i}','${["M", "L", "XL"][i - 2]}','Negro',true);insert into public.inventory(variant_id,on_hand)values('${id}',1000)`,
    );
  }
  const large = JSON.stringify({
    items: variants.map((variant_id) => ({
      variant_id,
      quantity: 3,
      expected_price_cents: 100,
    })),
    delivery: "pickup",
    payment: "cash",
  });
  const bulk = await Promise.allSettled(
    Array.from({ length: 10 }, (_, i) =>
      sql(
        `set role service_role;select public.demo_create_order('${randomUUID()}','${(i + 100).toString(16).padStart(64, "0")}','${large}')`,
      ),
    ),
  );
  assert.equal(bulk.filter((r) => r.status === "fulfilled").length, 6);
  assert.equal(await sql("select sum(reserved) from public.inventory"), "72");
  await sql(
    "update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes'",
  );
  await Promise.all([
    sql("select public.demo_expire_orders()"),
    sql("select public.demo_expire_orders()"),
  ]);
  assert.equal(await sql("select sum(reserved) from public.inventory"), "0");
  assert.equal(
    await sql(
      "select count(*) from public.inventory_movements where kind='expire'",
    ),
    "24",
  );
  console.log(
    "PASS concurrent large orders respect 80 units; concurrent expiry releases each reservation once",
  );
} finally {
  await sql(`drop database if exists ${database} with(force)`, "postgres");
}
