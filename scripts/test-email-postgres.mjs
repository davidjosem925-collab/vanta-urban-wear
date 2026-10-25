// Isolated PostgreSQL concurrency tests for phase 4 email; no remote DSN or provider access.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const container = process.env.VANTA_TEST_PG_CONTAINER;
const database = `vanta_email_${randomUUID().replaceAll("-", "")}`;
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

const a = "10000000-0000-0000-0000-000000000001",
  owner = "a".repeat(64);
const cipher = "v1." + "a".repeat(24) + "." + "b".repeat(48); // Shape-only synthetic ciphertext; AES is tested in the runtime suite.
const payload = JSON.stringify({
  items: [{ variant_id: a, quantity: 2, expected_price_cents: 2500050 }],
  delivery: "pickup",
  payment: "mercado_pago",
});
const reset = () =>
  sql(
    "delete from public.demo_admin_order_actions;delete from public.demo_email_outbox;delete from public.demo_email_contacts;delete from public.demo_email_budget;delete from public.demo_email_suppressions;delete from public.payment_events;delete from public.payments;delete from public.inventory_movements;delete from public.stock_reservations;delete from public.order_items;delete from public.orders;update public.inventory set on_hand=8,reserved=0;update public.demo_email_config set enabled=true,daily_attempt_limit=50;",
  );
async function order(key = randomUUID()) {
  return JSON.parse(
    await sql(
      `set role service_role;select public.demo_email_create_order('${key}','${owner}','${payload}','${"d".repeat(64)}','${cipher}');`,
    ),
  );
}
const freeze = (j) =>
  sql(
    `set role service_role;select public.demo_email_freeze('${j.id}','${j.lease}','${cipher}','${"e".repeat(64)}');`,
  );
const begin = (j) =>
  sql(
    `set role service_role;select public.demo_email_begin('${j.id}','${j.lease}');`,
  );
const result = (j) =>
  sql(
    `set role service_role;select public.demo_email_result('${j.id}','${j.lease}','accepted','20000000-0000-0000-0000-000000000001',60);`,
  );
const resource = "ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP9";
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
    "202610230004_admin_payments.sql",
  ])
    await sql(readFileSync(`supabase/migrations/${name}`, "utf8"));
  await sql(`update public.mp_test_config set enabled=true,seller_id='123',application_id='456';
 insert into public.categories(id,name,slug,active) values('${a}','Remeras','remeras',true);
 insert into public.products(id,category_id,name,slug,price_cents,active) values('${a}','${a}','Essential','essential',2500050,true);
 insert into public.product_variants(id,product_id,sku,size,color,active) values('${a}','${a}','A','S','Negro',true);
 insert into public.inventory(variant_id,on_hand) values('${a}',8);`);

  const admin = "10000000-0000-0000-0000-000000000009";
  await sql(
    `insert into auth.users(id) values('${admin}');insert into public.admin_profiles(user_id,display_name,active) values('${admin}','Local admin',true);`,
  );
  const adminPrefix = `set role authenticated;select set_config('request.jwt.claim.sub','${admin}',false);select set_config('request.jwt.claim.aal','aal2',false);`;
  const action = (
    id,
    kind = "confirm",
    key = randomUUID(),
    expected = "pending",
  ) =>
    sql(
      `${adminPrefix}select public.admin_demo_order_action('${id}','${kind}','${key}','${expected}');`,
    ).then((s) => JSON.parse(s.split("\n").at(-1)));
  async function bank() {
    const receipt = JSON.parse(
      await sql(
        `set role service_role;select public.demo_create_order('${randomUUID()}','${owner}','${JSON.stringify({ ...JSON.parse(payload), payment: "transfer" })}');`,
      ),
    );
    await sql(
      `set role service_role;select public.demo_transfer_payment('${receipt.reference}','${owner}');`,
    );
    return await sql(
      `select id from public.orders where public_reference='${receipt.reference}'`,
    );
  }
  let bankId = await bank(),
    adminKey = randomUUID();
  const approved = await Promise.all([
    action(bankId, "confirm", adminKey),
    action(bankId, "confirm", adminKey),
  ]);
  assert.deepEqual(approved[0], approved[1]);
  assert.equal(approved[0].payment_status, "approved");
  assert.equal(
    await sql("select count(*) from public.demo_admin_order_actions"),
    "1",
  );
  assert.equal(
    await sql("select on_hand||':'||reserved from public.inventory"),
    "6:0",
  );
  await assert.rejects(
    action(bankId, "cancel", adminKey),
    /IDEMPOTENCY_CONFLICT/,
  );
  console.log(
    "PASS concurrent administrative transfer retries audit and consume once with immutable operation identity",
  );
  await reset();
  bankId = await bank();
  const competing = await Promise.allSettled([
    action(bankId),
    action(bankId, "cancel"),
  ]);
  assert.equal(competing.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    await sql("select count(*) from public.demo_admin_order_actions"),
    "1",
  );
  assert.ok(
    ["6:0", "8:0"].includes(
      await sql("select on_hand||':'||reserved from public.inventory"),
    ),
  );
  console.log(
    "PASS concurrent transfer confirmation vs cancellation resolves one audited terminal state",
  );
  await reset();
  bankId = await bank();
  await sql(
    "update public.orders set created_at=statement_timestamp()-interval '59 minutes 59 seconds',reservation_expires_at=statement_timestamp()+interval '1 second'",
  );
  const inventoryLock = await hold(
    "select 1 from public.inventory for update;",
  );
  const delayed = action(bankId);
  await new Promise((r) => setTimeout(r, 1300));
  await inventoryLock.finish();
  assert.equal((await delayed).order_status, "expired");
  assert.equal(await sql("select status from public.payments"), "expired");
  assert.equal(
    await sql("select on_hand||':'||reserved from public.inventory"),
    "8:0",
  );
  await sql("select public.demo_expire_orders()");
  assert.equal(
    await sql(
      "select count(*) from public.inventory_movements where kind='expire'",
    ),
    "1",
  );
  console.log(
    "PASS transfer confirmation waiting for inventory rechecks deadline and synchronizes expiry without consuming stock",
  );
  await reset();
  const mpReceipt = await order();
  const payment = JSON.parse(
    await sql(
      `set role service_role;select public.mp_test_prepare('${mpReceipt.reference}','${owner}',true,'https://store.example');`,
    ),
  );
  const mpId = await sql("select id from public.orders limit 1");
  await assert.rejects(action(mpId), /PROVIDER_CONFIRMATION_REQUIRED/);
  await Promise.allSettled([action(mpId, "cancel"), sql(apply(payment))]);
  const terminal = await sql("select status from public.orders limit 1");
  assert.ok(["confirmed", "cancelled"].includes(terminal));
  assert.equal(
    await sql(
      "select count(*) from public.inventory_movements where kind in ('consume','release')",
    ),
    "1",
  );
  console.log(
    "PASS administrative MP approval is denied; provider approval vs cancellation never double-consumes or reopens",
  );
  await reset();
  bankId = await bank();
  await action(bankId);
  await assert.rejects(
    sql(
      `${adminPrefix}select idempotency_key,mp_request from public.payments;`,
    ),
    /permission denied/,
  );
  await assert.rejects(
    sql(`${adminPrefix}update public.payments set status='approved';`),
    /permission denied/,
  );
  const summary = await sql(
    `${adminPrefix}select public.admin_demo_order_payments(array['${bankId}'::uuid]);`,
  );
  assert.ok(
    !/recipient|ciphertext|owner_hash|idempotency_key|mp_request|checkout_url/.test(
      summary,
    ),
  );
  await sql("update public.admin_profiles set active=false");
  await assert.rejects(
    action(bankId, "prepare", randomUUID(), "confirmed"),
    /FORBIDDEN/,
  );
  await sql("update public.admin_profiles set active=true");
  await assert.rejects(
    sql(readFileSync("supabase/operations/stage-8-admin-rollback.sql", "utf8")),
    /preserve audit evidence/,
  );
  console.log(
    "PASS native admin permissions, private columns, profile revocation and rollback preserve authorization and audit evidence",
  );
  await reset();

  await sql("update public.demo_email_config set enabled=true");
  let key = randomUUID();
  let results = await Promise.all([order(key), order(key)]);
  assert.equal(results[0].reference, results[1].reference);
  assert.equal(await sql("select count(*) from public.orders"), "1");
  assert.equal(
    await sql("select count(*) from public.demo_email_contacts"),
    "1",
  );
  assert.equal(await sql("select count(*) from public.demo_email_outbox"), "1");
  assert.equal(
    await sql("select on_hand||':'||reserved from public.inventory"),
    "8:2",
  );
  console.log(
    "PASS concurrent notified creation: one order, encrypted contact, event and stock reservation",
  );
  await reset();
  key = randomUUID();
  await Promise.all([
    order(key),
    sql(
      `set role service_role;select public.demo_create_order('${key}','${owner}','${payload}');`,
    ),
  ]);
  assert.equal(await sql("select count(*) from public.orders"), "1");
  assert.ok(
    ["0", "1"].includes(
      await sql("select count(*) from public.demo_email_contacts"),
    ),
  );
  assert.equal(
    await sql("select on_hand||':'||reserved from public.inventory"),
    "8:2",
  );
  console.log(
    "PASS notified vs legacy same-key creation shares admission lock without historical re-enrollment",
  );
  await reset();
  await order();
  const tx = await hold(
    "set local role service_role;select public.demo_email_claim();",
  );
  assert.equal(
    JSON.parse(
      await sql("set role service_role;select public.demo_email_claim();"),
    ).sends.length,
    0,
  );
  await tx.finish();
  let row = JSON.parse(
    await sql(
      "select json_build_object('id',id,'lease',lease_id) from public.demo_email_outbox",
    ),
  );
  await freeze(row);
  await begin(row);
  await sql(
    "update public.demo_email_outbox set lease_until=clock_timestamp()-interval '1 second'",
  );
  let next = JSON.parse(
    await sql("set role service_role;select public.demo_email_claim();"),
  ).sends[0];
  assert.notEqual(row.lease, next.lease);
  assert.equal(await result(row), "f");
  assert.equal(await begin(next), "t");
  assert.equal(await result(next), "t");
  assert.equal(await result(next), "f");
  assert.equal(
    await sql("select send_attempts from public.demo_email_outbox"),
    "2",
  );
  console.log(
    "PASS SKIP LOCKED concurrent claims and fenced acknowledgements retain a single provider identity",
  );
  await reset();
  await order();
  await order();
  const jobs = JSON.parse(
    await sql("set role service_role;select public.demo_email_claim();"),
  ).sends;
  await Promise.all(jobs.map(freeze));
  await sql("update public.demo_email_config set daily_attempt_limit=1");
  results = await Promise.all(jobs.map(begin));
  assert.deepEqual(results.sort(), ["f", "t"]);
  assert.equal(await sql("select attempts from public.demo_email_budget"), "1");
  console.log(
    "PASS parallel send starts cannot exceed daily provider attempt quota",
  );
  await reset();
  let o = await order();
  const p = JSON.parse(
    await sql(
      `set role service_role;select public.mp_test_prepare('${o.reference}','${owner}',true,'https://store.example');`,
    ),
  );
  await Promise.all([
    sql(apply(p)),
    sql(apply(p)),
    sql("set role service_role;select public.demo_email_claim();"),
  ]);
  assert.equal(
    await sql(
      "select count(*) from public.demo_email_outbox where event='payment_approved'",
    ),
    "1",
  );
  assert.equal(
    await sql("select on_hand||':'||reserved from public.inventory"),
    "6:0",
  );
  console.log(
    "PASS duplicate verified payment approvals vs email claim queue one approval and consume stock once",
  );
  await reset();
  o = await order();
  const late = JSON.parse(
    await sql(
      `set role service_role;select public.mp_test_prepare('${o.reference}','${owner}',true,'https://store.example');`,
    ),
  );
  await sql(
    "update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes'",
  );
  await Promise.all([
    sql(apply(late)),
    sql("select public.demo_expire_orders()"),
  ]);
  assert.equal(
    await sql(
      "select count(*) from public.demo_email_outbox where event='payment_approved'",
    ),
    "0",
  );
  assert.equal(
    await sql(
      "select count(*) from public.demo_email_outbox where event='payment_review'",
    ),
    "1",
  );
  assert.equal(
    await sql("select on_hand||':'||reserved from public.inventory"),
    "8:0",
  );
  console.log(
    "PASS expiry vs late approval queues review, never financial confirmation or extra inventory consumption",
  );
  await reset();
  await order();
  row = JSON.parse(
    await sql("set role service_role;select public.demo_email_claim();"),
  ).sends[0];
  await freeze(row);
  await begin(row);
  await sql(
    "update public.demo_email_outbox set lease_until=clock_timestamp()-interval '1 second',first_attempt_at=clock_timestamp()-interval '23 hours'",
  );
  assert.equal(
    JSON.parse(
      await sql("set role service_role;select public.demo_email_claim();"),
    ).sends.length,
    0,
  );
  assert.equal(
    await sql("select error_code from public.demo_email_outbox"),
    "IDEMPOTENCY_WINDOW",
  );
  assert.equal(
    await sql("select send_attempts from public.demo_email_outbox"),
    "1",
  );
  console.log(
    "PASS provider idempotency expiry quarantines uncertainty without generating a new send key",
  );
  assert.equal(
    await sql(
      "select has_table_privilege('service_role','public.demo_email_contacts','SELECT')",
    ),
    "f",
  );
  assert.equal(
    await sql(
      "select has_function_privilege('authenticated','public.demo_email_claim()','EXECUTE')",
    ),
    "f",
  );
  assert.equal(
    await sql(
      "select has_function_privilege('service_role','public.demo_email_enqueue(uuid,text)','EXECUTE')",
    ),
    "f",
  );
  await assert.rejects(
    sql(readFileSync("supabase/operations/stage-8-email-rollback.sql", "utf8")),
    /Email activity exists/,
  );
  assert.equal(await sql("select count(*) from public.orders"), "1");
  await reset();
  // Incremental policy: preserve the historical scenarios above, then test the
  // new contract over the complete payment-evidence migration chain.
  const legacyOrder = await order();
  const legacyJob = JSON.parse(
    await sql("set role service_role;select public.demo_email_claim();"),
  ).sends[0];
  await freeze(legacyJob);
  await begin(legacyJob);
  await result(legacyJob);
  const legacyAccepted = await sql(
    "select to_jsonb(e)::text from public.demo_email_outbox e where event='order_received'",
  );
  const legacyPayment = JSON.parse(
    await sql(
      `set role service_role;select public.mp_test_prepare('${legacyOrder.reference}','${owner}',true,'https://shop.example');`,
    ),
  );
  await sql(
    apply(legacyPayment, {
      state: "pending",
      detail: "pending",
      paid_cents: 0,
    }),
  );
  await sql(
    `update public.demo_email_outbox set first_attempt_at=clock_timestamp(),request_ciphertext='${cipher}',request_hash=repeat('a',64) where event='payment_pending'`,
  );
  for (const name of [
    "202610240001_mp_payment_evidence.sql",
    "202610240002_mp_created_without_detail.sql",
    "202610240003_mp_checkout_pref_id.sql",
    "202610250001_mp_approved_email_only.sql",
  ])
    await sql(readFileSync(`supabase/migrations/${name}`, "utf8"));
  assert.equal(
    await sql(
      "select to_jsonb(e)::text from public.demo_email_outbox e where event='order_received'",
    ),
    legacyAccepted,
  );
  assert.equal(
    await sql(
      "select state from public.demo_email_outbox where event='payment_pending'",
    ),
    "suppressed",
  );
  console.log(
    "PASS new email policy suppresses frozen legacy MP retries without touching accepted messages",
  );
  await reset();
  const newOrder = await order();
  const newPayment = JSON.parse(
    await sql(
      `set role service_role;select public.mp_test_prepare('${newOrder.reference}','${owner}',true,'https://shop.example');`,
    ),
  );
  assert.equal(await sql("select count(*) from public.demo_email_outbox"), "0");
  await Promise.all([sql(apply(newPayment)), sql(apply(newPayment))]);
  assert.equal(
    await sql("select string_agg(event,',') from public.demo_email_outbox"),
    "payment_approved",
  );
  assert.equal(
    await sql("select on_hand||':'||reserved from public.inventory"),
    "6:0",
  );
  console.log(
    "PASS new policy concurrent verified MP approvals enqueue one approval and consume inventory once",
  );
  const newClaims = await Promise.all([
    sql("set role service_role;select public.demo_email_claim();"),
    sql("set role service_role;select public.demo_email_claim();"),
  ]);
  const approvalJobs = newClaims.flatMap((x) => JSON.parse(x).sends);
  assert.equal(approvalJobs.length, 1);
  await freeze(approvalJobs[0]);
  assert.equal(await begin(approvalJobs[0]), "t");
  await result(approvalJobs[0]);
  assert.equal(
    JSON.parse(
      await sql("set role service_role;select public.demo_email_claim();"),
    ).sends.length,
    0,
  );
  console.log(
    "PASS new policy concurrent claims retain one approved email identity and no duplicate sends",
  );
  await reset();
  await sql(
    readFileSync(
      "supabase/operations/mp-approved-email-only-rollback.sql",
      "utf8",
    ),
  );
  for (const file of [
    "mp-checkout-pref-id-rollback.sql",
    "mp-created-without-detail-rollback.sql",
    "mp-payment-evidence-rollback.sql",
  ])
    await sql(readFileSync(`supabase/operations/${file}`, "utf8"));
  console.log(
    "PASS new policy reverses only function definitions and preserves the prior migration chain",
  );
  await reset();
  await sql(
    readFileSync("supabase/operations/stage-8-admin-rollback.sql", "utf8"),
  );
  await sql(
    readFileSync("supabase/operations/stage-8-email-rollback.sql", "utf8"),
  );
  assert.equal(
    await sql(
      "select to_regprocedure('public.demo_resolve_order(uuid,text)') is not null",
    ),
    "t",
  );
  assert.equal(
    await sql(
      "select to_regprocedure('public.mp_test_apply(uuid,text,text,jsonb)') is not null",
    ),
    "t",
  );
  console.log(
    "PASS native role denials and pre-activity rollback preserve payments, Auth and stock primitives",
  );
} finally {
  for (const tx of held) await tx.abort();
  await sql(`drop database if exists ${database} with(force);`, "postgres");
}
