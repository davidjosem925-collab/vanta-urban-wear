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
      "vanta_stage5_test",
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
    `create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to anon,authenticated;`,
  );
  await sql(
    readFileSync("supabase/migrations/202610180002_storage.sql", "utf8"),
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

  // Only this disposable database is time-shifted; no remote DSN is accepted.
  await reset();
  await sql(`update public.inventory set on_hand=2 where variant_id='${a}';`);
  const expiryKey = randomUUID();
  const expiring = JSON.parse(await create(expiryKey));
  const stillPending = JSON.parse(await create());
  assert.equal(
    await sql(
      "select bool_and(reservation_expires_at-created_at=interval '60 minutes') from public.orders",
    ),
    "t",
  );
  assert.equal(
    await sql("select public.demo_expire_orders();"),
    "0",
    "no early expiry",
  );
  assert.equal(
    await sql(
      `select on_hand||':'||reserved||':'||(on_hand-reserved) from public.inventory where variant_id='${a}'`,
    ),
    "2:2:0",
  );
  await sql(`
    update public.orders set created_at=created_at-interval '61 minutes',
      reservation_expires_at=reservation_expires_at-interval '61 minutes'
      where public_reference='${expiring.reference}';
    update public.stock_reservations r set created_at=o.created_at,expires_at=o.reservation_expires_at
      from public.orders o where o.id=r.order_id and o.public_reference='${expiring.reference}';
  `);
  const expiryRuns = await Promise.all([
    sql("select public.demo_expire_orders();"),
    sql("select public.demo_expire_orders();"),
  ]);
  assert.equal(
    expiryRuns.reduce((sum, n) => sum + Number(n), 0),
    1,
  );
  assert.equal(
    await sql(
      `select status||':'||(reservation_resolved_at is not null) from public.orders where public_reference='${expiring.reference}'`,
    ),
    "expired:true",
  );
  assert.equal(
    await sql(
      `select status||':'||(reservation_resolved_at is null) from public.orders where public_reference='${stillPending.reference}'`,
    ),
    "pending:true",
  );
  assert.equal(
    await sql(
      `select on_hand||':'||reserved||':'||(on_hand-reserved) from public.inventory where variant_id='${a}'`,
    ),
    "2:1:1",
  );
  assert.equal(
    await sql(
      `select r.status from public.stock_reservations r join public.orders o on o.id=r.order_id where o.public_reference='${expiring.reference}'`,
    ),
    "expired",
  );
  assert.equal(
    await sql(
      `select r.status from public.stock_reservations r join public.orders o on o.id=r.order_id where o.public_reference='${stillPending.reference}'`,
    ),
    "active",
  );
  assert.equal(
    await sql(
      "select count(*)||':'||sum(quantity) from public.inventory_movements where kind='expire'",
    ),
    "1:1",
  );
  assert.equal(
    await sql(
      "select count(*) from public.inventory_movements where kind='consume'",
    ),
    "0",
  );
  assert.equal(await sql("select public.demo_expire_orders();"), "0");
  const expiredReplay = JSON.parse(await create(expiryKey));
  assert.equal(expiredReplay.reference, expiring.reference);
  assert.equal(expiredReplay.status, "expired");
  assert.equal(await sql("select count(*) from public.orders"), "2");
  assert.equal(
    await sql(`select reserved from public.inventory where variant_id='${a}'`),
    "1",
  );
  await create(randomUUID(), "b".repeat(64));
  assert.equal(
    await sql(
      `select on_hand||':'||reserved from public.inventory where variant_id='${a}'`,
    ),
    "2:2",
  );
  console.log(
    "PASS isolated cron expiry: exact 60m, no early expiry, pending -> expired, one release under concurrent jobs, live order preserved, expired replay and released unit reusable",
  );
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
  await reset();
  await sql(
    `insert into auth.users(id) values('${a}');insert into public.admin_profiles(user_id,display_name) values('${a}','Local admin');`,
  );
  const accepted = JSON.parse(await create());
  await sql(
    `set role authenticated;select set_config('request.jwt.claim.sub','${a}',false);select public.demo_admin_transition((select id from public.orders where public_reference='${accepted.reference}'),'confirmed');`,
  );
  assert.equal(await sql("select status from public.orders"), "confirmed");
  assert.equal(
    await sql(
      `select on_hand||':'||reserved from public.inventory where variant_id='${a}'`,
    ),
    "0:0",
  );
  await sql("select public.demo_expire_orders();");
  assert.equal(
    await sql(
      `select on_hand||':'||reserved from public.inventory where variant_id='${a}'`,
    ),
    "0:0",
  );
  console.log(
    "PASS authenticated admin consumes stock without direct DML grants; cron cannot release consumed stock",
  );
  await reset();
  const late = JSON.parse(await create());
  await sql(
    "with stamp as materialized(select clock_timestamp()-interval '59 minutes 55 seconds' t) update public.orders set created_at=stamp.t,reservation_expires_at=stamp.t+interval '60 minutes' from stamp;",
  );
  const stock = await hold(
    `select variant_id from public.inventory where variant_id='${a}' for update;`,
  );
  const pending = sql(
    `set application_name='vanta-confirm-wait';set role authenticated;select set_config('request.jwt.claim.sub','${a}',false);select public.demo_admin_transition((select id from public.orders where public_reference='${late.reference}'),'confirmed');`,
  );
  pending.catch(() => {});
  await until(
    `select exists(select 1 from pg_stat_activity where application_name='vanta-confirm-wait' and ${stock.pid}=any(pg_blocking_pids(pid)));`,
  );
  assert.equal(
    await sql(
      "select reservation_expires_at>clock_timestamp() from public.orders;",
    ),
    "t",
    "confirmation must already be waiting BEFORE expiry",
  );
  await until(
    "select reservation_expires_at<=clock_timestamp() from public.orders;",
  );
  await stock.finish();
  await pending;
  assert.equal(await sql("select status from public.orders"), "expired");
  assert.equal(
    await sql(
      `select on_hand||':'||reserved from public.inventory where variant_id='${a}'`,
    ),
    "1:0",
  );
  console.log(
    "PASS confirmation waiting on inventory cannot consume after the server deadline",
  );

  await reset();
  await sql(
    `insert into public.products(id,category_id,name,slug,price_cents,active) values('${b}','${a}','New parent','new-parent',2500050,true);`,
  );
  const inventoryLock = await hold(
    `select variant_id from public.inventory where variant_id='${a}' for update;`,
  );
  const variantLock = await hold(
    `update public.product_variants set product_id='${b}' where id='${a}';`,
  );
  const relocating = sql(
    `set application_name='vanta-reparent-wait';select public.demo_create_order('${randomUUID()}','${"b".repeat(64)}','${body()}'::jsonb);`,
  );
  relocating.catch(() => {});
  await until(
    `select exists(select 1 from pg_stat_activity where application_name='vanta-reparent-wait' and ${variantLock.pid}=any(pg_blocking_pids(pid)));`,
  );
  await variantLock.finish();
  await until(
    `select exists(select 1 from pg_stat_activity where application_name='vanta-reparent-wait' and ${inventoryLock.pid}=any(pg_blocking_pids(pid)));`,
  );
  await assert.rejects(
    sql(
      `set lock_timeout='200ms';update public.products set price_cents=1 where id='${b}';`,
    ),
    /lock timeout/,
  );
  await inventoryLock.finish();
  await relocating;
  assert.equal(
    await sql(
      "select subtotal_cents=(select sum(line_total_cents) from public.order_items) from public.orders",
    ),
    "t",
  );
  assert.equal(await sql(`select product_id from public.order_items`), b);
  console.log(
    "PASS concurrent variant reassignment locks the new product and preserves snapshots/totals",
  );

  await reset();
  const serviceReceipt = JSON.parse(
    (
      await sql(
        `set role service_role;select public.demo_create_order('${randomUUID()}','${"c".repeat(64)}','${body()}'::jsonb);`,
      )
    )
      .split("\n")
      .at(-1),
  );
  await sql(
    `set role service_role;select public.demo_cancel_order('${serviceReceipt.reference}','${"c".repeat(64)}');`,
  );
  assert.equal(await sql("select status from public.orders"), "cancelled");
  for (const privilege of [
    "INSERT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "REFERENCES",
    "TRIGGER",
  ])
    assert.equal(
      await sql(
        `select has_table_privilege('service_role','public.inventory','${privilege}');`,
      ),
      "f",
    );
  console.log(
    "PASS service_role RPC creation/cancellation with all direct write/trigger privileges revoked",
  );
  // Stage 6 compatibility: MFA hardens admin only, never guest/cron semantics.
  await sql(
    `create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('request.jwt.claim.aal',true))$$;`,
  );
  await sql(
    readFileSync("supabase/migrations/202610200002_admin_panel.sql", "utf8"),
  );
  await reset();
  await create();
  await sql(
    "update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes';",
  );
  const adjustmentKey = randomUUID();
  const adjustSql = `set role authenticated;select set_config('request.jwt.claim.sub','${a}',false);select set_config('request.jwt.claim.aal','aal2',false);select public.demo_admin_adjust_inventory('${a}',1,'Local recount','${adjustmentKey}');`;
  await Promise.all([
    sql(adjustSql),
    sql("select public.demo_expire_orders();"),
  ]);
  await sql(adjustSql);
  assert.equal(
    await sql(
      `select on_hand||':'||reserved from public.inventory where variant_id='${a}'`,
    ),
    "2:0",
  );
  assert.equal(await sql("select status from public.orders"), "expired");
  assert.equal(
    await sql(
      "select count(*) from public.inventory_movements where kind='adjust'",
    ),
    "1",
  );
  await assert.rejects(
    sql(
      `set role authenticated;select set_config('request.jwt.claim.sub','${a}',false);select set_config('request.jwt.claim.aal','aal1',false);select public.demo_admin_adjust_inventory('${a}',1,'No MFA','${randomUUID()}');`,
    ),
    /FORBIDDEN/,
  );
  const expected = await sql(
    `select updated_at from public.products where id='${a}'`,
  );
  const saveProduct = (name) =>
    sql(
      `set role authenticated;select set_config('request.jwt.claim.sub','${a}',false);select set_config('request.jwt.claim.aal','aal2',false);select public.admin_save_product('${a}','${expected}','${JSON.stringify({ category_id: a, name, slug: "local", description: "Local only", price_cents: 2500050, active: true })}'::jsonb);`,
    );
  const edits = await Promise.allSettled([
    saveProduct("Concurrent A"),
    saveProduct("Concurrent B"),
  ]);
  assert.equal(edits.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(
    edits.find((r) => r.status === "rejected").reason.message,
    /EDIT_CONFLICT/,
  );
  console.log(
    "PASS stage 6 MFA: guest/cron compatibility, concurrent adjustment vs expiry, adjustment retry once and optimistic catalog editing",
  );
} finally {
  for (const tx of held) await tx.abort();
  await sql("drop database if exists vanta_stage5_test;", "postgres");
}
