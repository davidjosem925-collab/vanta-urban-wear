// Disposable local GoTrue + PostgreSQL + PostgREST. Never accepts remote URLs/DSNs.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID, createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
mkdirSync("work", { recursive: true });
const withEmail = process.argv.includes("--email");
const withPasskeys = process.argv.includes("--passkeys");
const passkeys = withPasskeys
  ? await import("./admin-passkeys-local.mjs")
  : null;
const gateway = await passkeys?.passkeyGateway();
const prefix = `vanta-admin-test-${randomUUID().slice(0, 8)}`,
  net = prefix;
const names = {
  pg: `${prefix}-pg`,
  auth: `${prefix}-auth`,
  rest: `${prefix}-rest`,
};
const env = { ...process.env };
for (const key of [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
])
  delete env[key];
function docker(...args) {
  const r = spawnSync(
    "docker",
    ["--host=unix:///var/run/docker.sock", ...args],
    { env, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (r.status !== 0)
    throw new Error(
      `Local Docker command failed (${args[0]}). ${r.stderr?.slice(0, 200)}`,
    );
  return r.stdout.trim();
}
function sql(text) {
  const r = spawnSync(
    "docker",
    [
      "--host=unix:///var/run/docker.sock",
      "exec",
      "-i",
      names.pg,
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { env, input: text, encoding: "utf8" },
  );
  if (r.status)
    throw new Error(
      "Isolated SQL setup/assertion failed: " + r.stderr?.slice(0, 200),
    );
  return r.stdout.trim();
}
const secret = "only-local-test-jwt-secret-not-a-production-credential-12345";
const b64 = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
function jwt(role) {
  const p =
    b64({ alg: "HS256", typ: "JWT" }) +
    "." +
    b64({ role, exp: Math.floor(Date.now() / 1000) + 3600 });
  return p + "." + createHmac("sha256", secret).update(p).digest("base64url");
}
function address(name, port) {
  const value = docker("port", name, `${port}/tcp`);
  assert.match(value, /^127\.0\.0\.1:\d+$/);
  return `http://${value}`;
}
async function until(fn) {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    try {
      const result = await fn();
      if (result) return result;
    } catch {
      /* local server warming */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Local service not ready within 45 seconds");
}
async function api(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
}
function totp(base32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of base32.toUpperCase().replace(/=+$/, ""))
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest(),
    offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}
try {
  docker("network", "create", net);
  docker(
    "run",
    "-d",
    "--network",
    net,
    "--name",
    names.pg,
    "--tmpfs",
    "/var/lib/postgresql/data",
    "-e",
    "POSTGRES_PASSWORD=local-test-only",
    "postgres:17-alpine",
  );
  await until(() => {
    try {
      // The image starts a temporary socket-only server during initdb, then restarts.
      // TCP readiness proves the final server is accepting connections.
      docker(
        "exec",
        names.pg,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "postgres",
      );
      return true;
    } catch {
      return false;
    }
  });
  sql("create schema auth; alter role postgres set search_path=auth,public;");
  docker(
    "run",
    "-d",
    "--network",
    net,
    "--name",
    names.auth,
    "-p",
    "127.0.0.1::9999",
    "-e",
    "GOTRUE_API_HOST=0.0.0.0",
    "-e",
    "GOTRUE_API_PORT=9999",
    "-e",
    "API_EXTERNAL_URL=http://localhost:9999",
    "-e",
    "GOTRUE_SITE_URL=http://localhost:9999",
    "-e",
    "GOTRUE_DB_DRIVER=postgres",
    "-e",
    "GOTRUE_DB_NAMESPACE=auth",
    "-e",
    `GOTRUE_DB_DATABASE_URL=postgres://postgres:local-test-only@${names.pg}:5432/postgres?sslmode=disable`,
    "-e",
    `GOTRUE_JWT_SECRET=${secret}`,
    "-e",
    "GOTRUE_JWT_EXP=3600",
    "-e",
    "GOTRUE_JWT_AUD=authenticated",
    "-e",
    "GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated",
    "-e",
    "GOTRUE_MAILER_AUTOCONFIRM=true",
    "-e",
    "GOTRUE_EXTERNAL_EMAIL_ENABLED=true",
    "-e",
    "GOTRUE_MFA_TOTP_ENROLL_ENABLED=true",
    "-e",
    "GOTRUE_MFA_TOTP_VERIFY_ENABLED=true",
    "-e",
    "GOTRUE_RATE_LIMIT_EMAIL_SENT=100",
    ...(withEmail ? ["-e", "GOTRUE_MAILER_OTP_EXP=2"] : []),
    ...(withPasskeys
      ? [
          "-e",
          "GOTRUE_PASSKEY_ENABLED=true",
          "-e",
          "GOTRUE_MFA_WEB_AUTHN_ENROLL_ENABLED=true",
          "-e",
          "GOTRUE_MFA_WEB_AUTHN_VERIFY_ENABLED=true",
          "-e",
          "GOTRUE_WEBAUTHN_RP_ID=localhost",
          "-e",
          "GOTRUE_WEBAUTHN_RP_DISPLAY_NAME=VANTA local test",
          "-e",
          `GOTRUE_WEBAUTHN_RP_ORIGINS=${gateway.origin}`,
        ]
      : []),
    withPasskeys || withEmail
      ? "supabase/gotrue:v2.197.0"
      : "supabase/gotrue:v2.177.0",
  );
  const auth = address(names.auth, 9999);
  await until(async () => (await api(auth + "/health")).ok);
  gateway?.connect(auth);
  sql(`create role anon;create role authenticated;create role service_role bypassrls;create role authenticator login noinherit password 'local-rest-only';grant anon,authenticated,service_role to authenticator;grant usage on schema public,auth to anon,authenticated,service_role;
 create or replace function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create or replace function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
  for (const file of [
    "202610180001_initial_schema.sql",
    "202610180002_storage.sql",
    "202610200001_demo_orders.sql",
    "202610200002_admin_panel.sql",
    "202610230001_mp_test_backend.sql",
    "202610230002_checkout_payments.sql",
  ])
    sql(readFileSync(`supabase/migrations/${file}`, "utf8"));
  const category = randomUUID();
  sql(
    `insert into public.categories(id,name,slug,active) values('${category}','Local','local',true);`,
  );
  docker(
    "run",
    "-d",
    "--network",
    net,
    "--name",
    names.rest,
    "-p",
    "127.0.0.1::3000",
    "-e",
    `PGRST_DB_URI=postgres://authenticator:local-rest-only@${names.pg}:5432/postgres`,
    "-e",
    "PGRST_DB_SCHEMAS=public",
    "-e",
    "PGRST_DB_ANON_ROLE=anon",
    "-e",
    `PGRST_JWT_SECRET=${secret}`,
    "postgrest/postgrest:v12.2.12",
  );
  const rest = address(names.rest, 3000);
  await until(async () => (await api(rest + "/")).ok);
  const anon = jwt("anon");
  const client = createClient(auth, anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) => {
        const u = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        );
        u.pathname = u.pathname.replace(/^\/auth\/v1/, "");
        return api(u, init);
      },
    },
  });
  const signup = await client.auth.signUp({
    email: "admin@local.invalid",
    password: "Only-Local-Test-Password-123!",
  });
  assert.equal(signup.error, null);
  assert.ok(signup.data.session);
  const user = signup.data.user.id;
  sql(
    `insert into public.admin_profiles(user_id,display_name) values('${user}','Local Admin');`,
  );
  async function call(token, name, args = {}) {
    return api(rest + "/rpc/" + name, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
  }
  const aal1 = signup.data.session.access_token;
  assert.equal((await call(aal1, "mp_test_settings")).status, 403);
  assert.equal(
    (await call(jwt("service_role"), "mp_test_settings")).status,
    200,
  );
  const [jwtHeader, jwtPayload, jwtSignature] = aal1.split(".");
  const tampered =
    jwtHeader +
    "." +
    b64({
      ...JSON.parse(Buffer.from(jwtPayload, "base64url").toString()),
      aal: "aal2",
    }) +
    "." +
    jwtSignature;
  assert.equal((await call(tampered, "is_admin")).status, 401);

  assert.equal(await (await call(aal1, "admin_membership")).json(), true);
  sql(`delete from public.admin_profiles where user_id='${user}';`);
  const metadata = await client.auth.updateUser({
    data: { role: "admin", is_admin: true },
  });
  assert.equal(metadata.error, null);
  assert.equal(await (await call(aal1, "admin_membership")).json(), false);
  sql(
    `insert into public.admin_profiles(user_id,display_name) values('${user}','Local Admin');`,
  );

  assert.equal(await (await call(aal1, "is_admin")).json(), false);
  const values = {
    category_id: category,
    name: "Real JWT product",
    slug: "real-jwt-product",
    description: "Local only",
    price_cents: 2700000,
    active: false,
  };
  assert.equal(
    (
      await call(aal1, "admin_save_product", {
        p_id: null,
        p_expected: null,
        p_values: values,
      })
    ).status,
    400,
  ); // SQL FORBIDDEN, no privilege escalation.
  const enrolled = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Local test",
  });
  assert.equal(enrolled.error, null);
  const challenge = await client.auth.mfa.challenge({
    factorId: enrolled.data.id,
  });
  assert.equal(challenge.error, null);
  const verified = await client.auth.mfa.verify({
    factorId: enrolled.data.id,
    challengeId: challenge.data.id,
    code: totp(enrolled.data.totp.secret),
  });
  assert.equal(verified.error, null);
  const aal2 = (await client.auth.getSession()).data.session.access_token;
  assert.equal(await (await call(aal2, "is_admin")).json(), true);
  assert.equal((await call(aal2, "mp_test_settings")).status, 403);
  assert.equal(
    (
      await call(aal2, "demo_transfer_payment", {
        p_reference: randomUUID(),
        p_owner: "a".repeat(64),
      })
    ).status,
    403,
  );
  console.log(
    "PASS real signed admin AAL1/AAL2 JWTs cannot execute payment backend RPCs; service JWT can",
  );
  if (withPasskeys)
    await passkeys.testPasskeys({
      gateway,
      anon,
      session: (await client.auth.getSession()).data.session,
      call,
      backupFactor: enrolled.data.id,
      backupCode: () => totp(enrolled.data.totp.secret),
    });
  const saved = await call(aal2, "admin_save_product", {
    p_id: null,
    p_expected: null,
    p_values: values,
  });
  assert.equal(saved.status, 200);
  const p = await saved.json();
  assert.equal(p.price_cents, 2700000);
  assert.equal(
    (
      await api(rest + "/products", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aal2}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api(rest + "/products?select=id", {
        headers: { Authorization: `Bearer ${anon}` },
      })
    ).status,
    200,
  );
  const hidden = await api(rest + "/products?select=id", {
    headers: { Authorization: `Bearer ${anon}` },
  });
  assert.deepEqual(await hidden.json(), []);
  if (withEmail) {
    const { testEmailAccess } = await import("./admin-email-local.mjs");
    await testEmailAccess({
      client,
      call,
      sql,
      api,
      auth,
      serviceToken: jwt("service_role"),
      until,
      user,
      values,
    });
  }
  sql(`update public.admin_profiles set active=false where user_id='${user}';`);
  assert.equal(await (await call(aal2, "is_admin")).json(), false);
  assert.equal(
    (
      await call(aal2, "admin_save_product", {
        p_id: null,
        p_expected: null,
        p_values: { ...values, slug: "revoked" },
      })
    ).status,
    400,
  );
  console.log(
    "PASS real GoTrue password login, TOTP enrollment/verification and signed AAL1/AAL2 JWTs through PostgREST RLS/RPC; draft privacy, direct DML denial, live admin revocation",
  );
  await client.auth.signOut();
  client.auth.stopAutoRefresh();
} catch (error) {
  const logs = spawnSync(
    "docker",
    ["--host=unix:///var/run/docker.sock", "logs", names.auth],
    { env, encoding: "utf8" },
  );
  writeFileSync(
    "work/stage6-auth-runtime.log",
    (logs.stdout + logs.stderr)
      .replaceAll(secret, "[local-secret]")
      .replaceAll("local-test-only", "[local-password]"),
  );
  throw error;
} finally {
  await gateway?.close();
  for (const name of [names.rest, names.auth, names.pg]) {
    try {
      docker("rm", "-f", name);
    } catch {
      /* may not have started */
    }
  }
  try {
    docker("network", "rm", net);
  } catch {
    /* cleanup */
  }
}
