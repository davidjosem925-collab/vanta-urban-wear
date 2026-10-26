// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createEmailDb, payload, capability } from "./email-fixture";
import { makeHandler } from "../functions/demo-orders/handler";
import { makePaymentHandler } from "../functions/_shared/mp-orders/handlers";
import { settings } from "./mp-fixture";
import type { Rpc as DemoRpc } from "../functions/demo-orders/rpc";
import type { Rpc } from "../functions/_shared/mp-orders/core";
const migration = readFileSync(
  "supabase/migrations/202610260001_public_demo_rate_limits.sql",
  "utf8",
);
const preflight = readFileSync(
  "supabase/operations/public-demo-rate-preflight.sql",
  "utf8",
);
const verification = readFileSync(
  "supabase/operations/public-demo-rate-verify.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/operations/public-demo-rate-rollback.sql",
  "utf8",
);
const legacy = readFileSync(
  "supabase/tests/fixtures/demo-rate-limit-legacy.sql",
  "utf8",
).replace("create function", "create or replace function");
let f: Awaited<ReturnType<typeof createEmailDb>>;
const actor = (n: number) => n.toString(16).padStart(64, "0");
const rate = (n = 1) => f.rpc("demo_rate_limit", { p_actor: actor(n) });
let oldDefinition: unknown, acl: unknown, admission: unknown, rows: unknown;
beforeAll(async () => {
  f = await createEmailDb();
  for (const name of [
    "202610230004_admin_payments.sql",
    "202610240001_mp_payment_evidence.sql",
    "202610240002_mp_created_without_detail.sql",
    "202610240003_mp_checkout_pref_id.sql",
    "202610250001_mp_approved_email_only.sql",
  ])
    await f.db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  oldDefinition = await f.scalar(
    "select pg_get_functiondef('public.demo_rate_limit(text)'::regprocedure) v",
  );
  acl = await f.scalar(
    "select proacl::text v from pg_proc where oid='public.demo_rate_limit(text)'::regprocedure",
  );
  admission = await f.scalar(
    "select pg_get_functiondef('public.demo_admit_creation()'::regprocedure) v",
  );
  await rate();
  await f.rpc("demo_admit_creation", {});
  rows = await f.scalar(
    "select jsonb_agg(to_jsonb(r) order by bucket) v from public.demo_request_limits r",
  );
  await f.db.exec(preflight);
  await f.db.exec(migration);
  await f.db.exec(verification);
  expect(
    await f.scalar(
      "select jsonb_agg(to_jsonb(r) order by bucket) v from public.demo_request_limits r",
    ),
  ).toEqual(rows);
}, 30000);
beforeEach(async () => {
  await f.reset();
  await f.db.exec("delete from public.demo_request_limits");
});
afterAll(() => f.db.close());
it("accepts exactly 60 per actor; other actors are independent and global is untouched", async () => {
  for (let i = 1; i <= 61; i++) expect(await rate()).toBe(i <= 60);
  expect(await rate(2)).toBe(true);
  expect(
    await f.scalar(
      "select count(*)::int v from public.demo_request_limits where bucket='global'",
    ),
  ).toBe(0);
});
it("invalid actor creates no bucket", async () => {
  for (const p_actor of [null, "", "x", "a".repeat(63)])
    expect(await f.rpc("demo_rate_limit", { p_actor })).toBe(false);
  expect(
    await f.scalar("select count(*)::int v from public.demo_request_limits"),
  ).toBe(0);
});
it("fixed window renews once after expiry and rejected attempts do not extend it", async () => {
  await rate();
  const start = await f.scalar(
    "select window_start v from public.demo_request_limits",
  );
  for (let i = 0; i < 61; i++) await rate();
  expect(
    await f.scalar("select window_start v from public.demo_request_limits"),
  ).toEqual(start);
  await f.db.exec(
    "update public.demo_request_limits set window_start=clock_timestamp()-interval '61 minutes'",
  );
  expect(await rate()).toBe(true);
  expect(
    await f.scalar("select attempts v from public.demo_request_limits"),
  ).toBe(1);
});
it("global creation budget remains 60 independent from the actor request budget", async () => {
  for (let i = 1; i <= 61; i++)
    expect(await f.rpc("demo_admit_creation", {})).toBe(i <= 60);
  expect(await rate()).toBe(true);
  await f.db.exec(
    "update public.demo_request_limits set window_start=clock_timestamp()-interval '61 minutes' where bucket='global'",
  );
  expect(await f.rpc("demo_admit_creation", {})).toBe(true);
  expect(
    await f.scalar(
      "select attempts v from public.demo_request_limits where bucket='global'",
    ),
  ).toBe(1);
  expect(
    await f.scalar(
      "select pg_get_functiondef('public.demo_admit_creation()'::regprocedure) v",
    ),
  ).toEqual(admission);
});
it("preserves restricted security and exact ACL", async () => {
  expect(
    await f.scalar(
      "select proacl::text v from pg_proc where oid='public.demo_rate_limit(text)'::regprocedure",
    ),
  ).toEqual(acl);
  for (const role of ["anon", "authenticated"])
    expect(
      await f.scalar(
        "select has_function_privilege($1,'public.demo_rate_limit(text)','EXECUTE') v",
        [role],
      ),
    ).toBe(false);
  expect(
    await f.scalar(
      "select prosecdef and proconfig=array['search_path=\"\"']::text[] v from pg_proc where oid='public.demo_rate_limit(text)'::regprocedure",
    ),
  ).toBe(true);
});
it("checkout and payment recovery share the same actor budget without admission, provider calls or duplicate reservations", async () => {
  const receipt = await f.order("mercado_pago", false);
  const key = await f.scalar("select idempotency_key v from public.orders");
  const rpc = vi.fn((name: string, args: Record<string, unknown>) =>
    f.rpc(name, args),
  );
  const demo: DemoRpc = async (name, args) => ({
    data: await rpc(name, args),
    error: null,
  });
  const provider = vi.fn(async (url: RequestInfo | URL) =>
    String(url).includes("/rest/v1/rpc/is_admin")
      ? Response.json(true, { status: 200 })
      : Response.json({}),
  ) as typeof fetch;
  const orders = makeHandler(
    {
      origin: settings.origin,
      challengeHostname: "shop.example",
      challengeSecret: "fixture",
      actorSecret: settings.actorSecret,
    },
    demo,
    provider,
  );
  const payments = makePaymentHandler(
    "checkout",
    settings,
    rpc as Rpc,
    provider,
  );
  const req = (body: unknown) =>
    new Request("https://edge.example/test", {
      method: "POST",
      headers: {
        origin: settings.origin,
        "content-type": "application/json",
        authorization: "Bearer admin-session-token",
      },
      body: JSON.stringify(body),
    });
  for (let i = 0; i < 60; i++) {
    const r =
      i % 2 === 0
        ? await orders(
            req({
              action: "recover",
              capability,
              idempotency_key: key,
              payload,
            }),
          )
        : await payments(
            req({
              action: "recover",
              reference: receipt.reference,
              capability,
            }),
          );
    expect(r.status).toBe(200);
  }
  expect(
    (
      await payments(
        req({ action: "recover", reference: receipt.reference, capability }),
      )
    ).status,
  ).toBe(429);
  expect(
    (
      await orders(
        req({ action: "recover", capability, idempotency_key: key, payload }),
      )
    ).status,
  ).toBe(429);
  expect(
    provider.mock.calls.filter(
      ([url]) => !String(url).includes("/rest/v1/rpc/is_admin"),
    ),
  ).toHaveLength(0);
  expect(rpc.mock.calls.some(([n]) => n === "demo_admit_creation")).toBe(false);
  expect(await f.scalar("select count(*)::int v from public.orders")).toBe(1);
  expect(
    await f.scalar("select count(*)::int v from public.stock_reservations"),
  ).toBe(1);
  expect(
    await f.scalar("select count(*)::int v from public.demo_request_limits"),
  ).toBe(1);
});
it("rollback restores the exact repository predecessor without resetting counters", async () => {
  await rate();
  const counters = await f.scalar(
    "select to_jsonb(r) v from public.demo_request_limits r",
  );
  await f.db.exec(rollback);
  expect(
    await f.scalar(
      "select pg_get_functiondef('public.demo_rate_limit(text)'::regprocedure) v",
    ),
  ).toEqual(oldDefinition);
  expect(
    await f.scalar("select to_jsonb(r) v from public.demo_request_limits r"),
  ).toEqual(counters);
  await f.db.exec(migration);
});
it("admits the exact two-bucket legacy candidate and rolls back to it without fabricating a remote match", async () => {
  await f.db.exec(rollback);
  await f.db.exec(legacy);
  await rate();
  const counters = await f.scalar(
    "select jsonb_agg(to_jsonb(r) order by bucket) v from public.demo_request_limits r",
  );
  expect(
    await f.scalar("select count(*)::int v from public.demo_request_limits"),
  ).toBe(2);
  const before = await f.scalar(
    "select pg_get_functiondef('public.demo_rate_limit(text)'::regprocedure) v",
  );
  await f.db.exec(preflight);
  await f.db.exec(migration);
  await rate(2);
  expect(
    await f.scalar(
      "select attempts v from public.demo_request_limits where bucket='global'",
    ),
  ).toBe(1);
  await f.db.exec(rollback);
  expect(
    await f.scalar(
      "select pg_get_functiondef('public.demo_rate_limit(text)'::regprocedure) v",
    ),
  ).toEqual(before);
  expect(counters).toBeTruthy();
  // Leave repository predecessor for subsequent cases.
  await f.db.exec(String(oldDefinition));
  await f.db.exec(migration);
});
it.each([
  "body",
  "security",
  "admission",
  "admission_body",
  "acl",
  "path",
  "comment",
])(
  "preflight and activation reject unexpected %s drift atomically",
  async (kind) => {
    await f.db.exec(rollback);
    if (kind === "body")
      await f.db.exec(
        "create or replace function public.demo_rate_limit(p_actor text) returns boolean language plpgsql security definer set search_path='' as $$begin return true;end$$",
      );
    if (kind === "security")
      await f.db.exec(
        "alter function public.demo_rate_limit(text) security invoker",
      );
    if (kind === "admission")
      await f.db.exec(
        "alter function public.demo_admit_creation() security invoker",
      );
    if (kind === "comment")
      await f.db.exec(
        "comment on function public.demo_rate_limit(text) is 'custom'",
      );
    if (kind === "admission_body")
      await f.db.exec(
        "create or replace function public.demo_admit_creation() returns boolean language plpgsql security definer set search_path='' as $$begin return true;end$$",
      );
    if (kind === "acl")
      await f.db.exec(
        "grant execute on function public.demo_rate_limit(text) to public",
      );
    if (kind === "path")
      await f.db.exec(
        "alter function public.demo_rate_limit(text) set search_path=public",
      );
    const before = await f.scalar(
      "select pg_get_functiondef('public.demo_rate_limit(text)'::regprocedure) v",
    );
    await expect(f.db.exec(preflight)).rejects.toThrow(/UNEXPECTED/);
    await expect(f.db.exec(migration)).rejects.toThrow(/UNEXPECTED/);
    await f.db.exec("rollback");
    expect(
      await f.scalar(
        "select pg_get_functiondef('public.demo_rate_limit(text)'::regprocedure) v",
      ),
    ).toEqual(before);
    await f.db.exec(String(oldDefinition));
    await f.db.exec(
      "alter function public.demo_rate_limit(text) security definer;comment on function public.demo_rate_limit(text) is null;alter function public.demo_admit_creation() security definer",
    );
    await f.db.exec(String(admission));
    await f.db.exec(
      "revoke execute on function public.demo_rate_limit(text) from public",
    );
    await f.db.exec(migration);
  },
);
it("reapplication and rollback without an exact marker are refused", async () => {
  await expect(f.db.exec(migration)).rejects.toThrow(
    "UNEXPECTED_RATE_DEFINITION",
  );
  await f.db.exec("rollback");
  const marker = await f.scalar(
    "select obj_description('public.demo_rate_limit(text)'::regprocedure,'pg_proc') v",
  );
  await f.db.exec(
    "comment on function public.demo_rate_limit(text) is 'wrong'",
  );
  await expect(f.db.exec(rollback)).rejects.toThrow(
    "RATE_ROLLBACK_MARKER_REQUIRED",
  );
  await f.db.exec("rollback");
  await f.db.query("select 1");
  await f.db.exec(
    `comment on function public.demo_rate_limit(text) is '${marker}'`,
  );
});
