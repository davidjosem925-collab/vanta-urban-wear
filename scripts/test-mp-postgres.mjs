// Isolated PostgreSQL concurrency tests for phase 2; no remote DSN or provider access.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const container = process.env.VANTA_TEST_PG_CONTAINER;
const database = `vanta_mp_${randomUUID().replaceAll("-", "")}`;
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
    p.on("close", (code) =>
      code ? reject(new Error(err)) : resolve(out.trim()),
    );
    p.stdin.end(text);
  });
}
// Keep transactions open with explicit readiness barriers, never timing guesses.
const held = new Set();
async function hold(text) {
  const p = spawn(
    "docker",
    [
      "--host=unix:///var/run/docker.sock",
      "exec",
      "-i",
      container,
      "psql",
      "-q",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "-d",
      database,
    ],
    { env },
  );
  let output = "",
    err = "";
  const done = new Promise((resolve, reject) => {
    p.on("error", reject);
    p.on("close", (code) => (code ? reject(new Error(err)) : resolve()));
  });
  done.catch(() => {});
  p.stderr.on("data", (d) => (err += d));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Local lock barrier timed out")),
      8000,
    );
    p.stdout.on("data", (d) => {
      output += d;
      if (output.includes("VANTA_LOCKED")) {
        clearTimeout(timer);
        resolve(Number(output.split("\n").find((l) => /^\d+$/.test(l))));
      }
    });
    done.catch((e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
  p.stdin.write(
    "begin;select pg_backend_pid();" + text + "\n\\echo VANTA_LOCKED\n",
  );
  const tx = {
    pid: await ready,
    async finish() {
      p.stdin.end("commit;\n");
      await done;
      held.delete(tx);
    },
    async abort() {
      p.stdin.end("rollback;\n");
      await done.catch(() => {});
    },
  };
  held.add(tx);
  return tx;
}
async function until(query) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if ((await sql(query)) === "t") return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Local PostgreSQL barrier condition not reached");
}
const a = "10000000-0000-0000-0000-000000000001",
  owner = "a".repeat(64);
const resource = "ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP9";
const payload = JSON.stringify({
  items: [{ variant_id: a, quantity: 2, expected_price_cents: 2500050 }],
  delivery: "pickup",
  payment: "mercado_pago",
});
const reset = () =>
  sql(
    "delete from public.payment_events;delete from public.payments;delete from public.inventory_movements;delete from public.stock_reservations;delete from public.order_items;delete from public.orders;update public.inventory set on_hand=8,reserved=0;",
  );
async function order(method = "mercado_pago") {
  return JSON.parse(
    await sql(
      `set role service_role;select public.demo_create_order('${randomUUID()}','${owner}','${JSON.stringify({ ...JSON.parse(payload), payment: method })}');`,
    ),
  );
}
const prepare = (o) =>
  sql(
    `set role service_role;select public.mp_test_prepare('${o.reference}','${owner}',true,'https://shop.example');`,
  );
const apply = (p, extra = {}) =>
  `set role service_role;select public.mp_test_apply('${p.payment_id}','${resource}','https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=${resource}','${JSON.stringify({ reference: p.reference, seller_id: "123", application_id: "456", currency: "ARS", amount_cents: 5000100, paid_cents: 5000100, updated_at: new Date().toISOString(), state: "approved", detail: "accredited", ...extra })}');`;
try {
  await sql(`create database ${database};`, "postgres");
  await sql(`do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end$$;
 create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('aal',current_setting('request.jwt.claim.aal',true))$$;`);
  await sql(
    readFileSync("supabase/migrations/202610180001_initial_schema.sql", "utf8"),
  );
  await sql(
    `create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to anon,authenticated;`,
  );
  for (const name of [
    "202610180002_storage.sql",
    "202610200001_demo_orders.sql",
    "202610200002_admin_panel.sql",
    "202610230001_mp_test_backend.sql",
    "202610230002_checkout_payments.sql",
    "202610230003_transactional_email.sql",
  ])
    await sql(readFileSync(`supabase/migrations/${name}`, "utf8"));
  await sql(`update public.mp_test_config set enabled=true,seller_id='123',application_id='456';
 insert into public.categories(id,name,slug,active) values('${a}','Remeras','remeras',true);
 insert into public.products(id,category_id,name,slug,price_cents,active) values('${a}','${a}','Essential','essential',2500050,true);
 insert into public.product_variants(id,product_id,sku,size,color,active) values('${a}','${a}','A','S','Negro',true);
 insert into public.inventory(variant_id,on_hand) values('${a}',8);`);
  let o = await order();
  let results = await Promise.all([prepare(o), prepare(o)]);
  assert.equal(
    JSON.parse(results[0]).payment_id,
    JSON.parse(results[1]).payment_id,
  );
  assert.equal(await sql("select count(*) from public.payments"), "1");
  assert.equal(await sql("select reserved from public.inventory"), "2");
  console.log(
    "PASS concurrent payment preparation: one row, one immutable key/request, one reservation",
  );
  let p = JSON.parse(results[0]);
  results = await Promise.all([
    sql(
      `set role service_role;select public.mp_test_claim_create('${p.payment_id}');`,
    ),
    sql(
      `set role service_role;select public.mp_test_claim_create('${p.payment_id}');`,
    ),
  ]);
  assert.deepEqual(results.sort(), ["f", "t"]);
  console.log("PASS concurrent create leases permit one outbound operation");
  await Promise.all([sql(apply(p)), sql(apply(p))]);
  assert.equal(
    await sql(
      "select count(*) from public.inventory_movements where kind='consume'",
    ),
    "1",
  );
  assert.equal(
    await sql("select on_hand||':'||reserved from public.inventory"),
    "6:0",
  );
  console.log("PASS two simultaneous approval deliveries consume exactly once");
  await reset();
  o = await order();
  p = JSON.parse(await prepare(o));
  await Promise.all([
    sql(apply(p)),
    sql(
      `set role service_role;select public.demo_cancel_order('${o.reference}','${owner}');`,
    ),
  ]);
  const cancelled = await sql("select status from public.orders");
  assert.ok(["confirmed", "cancelled"].includes(cancelled));
  assert.equal(
    await sql("select on_hand||':'||reserved from public.inventory"),
    cancelled === "confirmed" ? "6:0" : "8:0",
  );
  assert.equal(
    await sql(
      "select count(*) from public.inventory_movements where kind in ('consume','release','expire')",
    ),
    "1",
  );
  console.log(
    "PASS cancellation vs approval: one terminal movement, no reopening or negative inventory",
  );
  await reset();
  o = await order();
  p = JSON.parse(await prepare(o));
  await sql(
    "update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes';",
  );
  await Promise.all([
    sql(apply(p)),
    sql("select public.demo_expire_orders();"),
  ]);
  assert.equal(await sql("select status from public.orders"), "expired");
  assert.equal(
    await sql("select mp_reconciliation from public.payments"),
    "review",
  );
  assert.equal(
    await sql("select on_hand||':'||reserved from public.inventory"),
    "8:0",
  );
  console.log(
    "PASS expired reservation vs late approval: payment recorded for review, stock released once",
  );
  await reset();
  o = await order();
  p = JSON.parse(await prepare(o));
  await sql(
    "with stamp as materialized(select clock_timestamp()-interval '59 minutes 55 seconds' t) update public.orders set created_at=stamp.t,reservation_expires_at=stamp.t+interval '60 minutes' from stamp;",
  );
  const stock = await hold(
    `select variant_id from public.inventory where variant_id='${a}' for update;`,
  );
  const waiting = sql("set application_name='vanta-mp-wait';" + apply(p));
  await until(
    `select exists(select 1 from pg_stat_activity where application_name='vanta-mp-wait' and ${stock.pid}=any(pg_blocking_pids(pid)));`,
  );
  assert.equal(
    await sql(
      "select reservation_expires_at>clock_timestamp() from public.orders",
    ),
    "t",
  );
  await until(
    "select reservation_expires_at<=clock_timestamp() from public.orders;",
  );
  await stock.finish();
  await waiting;
  assert.equal(await sql("select status from public.orders"), "expired");
  assert.equal(
    await sql("select mp_reconciliation from public.payments"),
    "review",
  );
  assert.equal(
    await sql("select on_hand||':'||reserved from public.inventory"),
    "8:0",
  );
  console.log(
    "PASS approval waiting on inventory rechecks deadline after acquiring locks",
  );
  const event = "mp:" + "b".repeat(64);
  results = await Promise.all([
    sql(
      `set role service_role;select public.mp_test_accept_event('${event}','${resource}');`,
    ),
    sql(
      `set role service_role;select public.mp_test_accept_event('${event}','${resource}');`,
    ),
  ]);
  assert.equal(results[0], results[1]);
  const id = results[0];
  results = await Promise.all([
    sql(`set role service_role;select public.mp_test_claim_event('${id}');`),
    sql(`set role service_role;select public.mp_test_claim_event('${id}');`),
  ]);
  assert.deepEqual(results.sort(), ["f", "t"]);
  console.log(
    "PASS duplicate inbox receipt and worker leases serialize correctly",
  );
  await reset();
  o = await order("transfer");
  const transferCall = `set role service_role;select public.demo_transfer_payment('${o.reference}','${owner}');`;
  results = await Promise.all([sql(transferCall), sql(transferCall)]);
  assert.deepEqual(JSON.parse(results[0]), JSON.parse(results[1]));
  assert.equal(await sql("select count(*) from public.payments"), "1");
  assert.equal(
    await sql("select on_hand||':'||reserved from public.inventory"),
    "8:2",
  );
  console.log(
    "PASS simultaneous transfer preparation persists one pending payment and one reservation",
  );
  await sql(
    "update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes'",
  );
  await Promise.all([
    sql(transferCall),
    sql("select public.demo_expire_orders()"),
  ]);
  assert.equal(JSON.parse(await sql(transferCall)).payment_status, "expired");
  assert.equal(
    await sql("select on_hand||':'||reserved from public.inventory"),
    "8:0",
  );
  console.log(
    "PASS transfer recovery and cron expiry release stock once without confirmation",
  );
  assert.equal(
    await sql(
      "select has_table_privilege('service_role','public.payments','UPDATE')",
    ),
    "f",
  );
  assert.equal(
    await sql(
      "select has_function_privilege('authenticated','public.mp_test_apply(uuid,text,text,jsonb)','EXECUTE')",
    ),
    "f",
  );
  await reset();
  await sql(
    readFileSync("supabase/operations/stage-8-email-rollback.sql", "utf8"),
  );
  await sql(
    readFileSync("supabase/operations/stage-8-checkout-rollback.sql", "utf8"),
  );
  await sql(readFileSync("supabase/operations/stage-8-rollback.sql", "utf8"));
  assert.equal(
    await sql(
      "select to_regprocedure('public.demo_expire_orders()') is not null",
    ),
    "t",
  );
  console.log(
    "PASS native role privileges and schema rollback preserve the original expiry primitive",
  );
} finally {
  for (const tx of held) await tx.abort();
  await sql(`drop database if exists ${database} with(force);`, "postgres");
}
