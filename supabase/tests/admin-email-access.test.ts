// @vitest-environment node
import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createDemoDb } from "./demo-fixture";
let db: Awaited<ReturnType<typeof createDemoDb>>;
const admin = "10000000-0000-0000-0000-000000000001";
const other = "10000000-0000-0000-0000-000000000002";
const session = "20000000-0000-0000-0000-000000000001";
async function asUser(user = admin, claims: Record<string, unknown> = {}) {
  await db.exec("reset role");
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [
      user,
      JSON.stringify({
        role: "authenticated",
        aal: "aal1",
        session_id: session,
        ...claims,
      }),
    ],
  );
  await db.exec("set role authenticated");
}
async function allowed() {
  return (await db.query<{ v: boolean }>("select public.is_admin() v")).rows[0]
    .v;
}
async function save() {
  return db.query("select public.admin_save_product(null,null,$1::jsonb)", [
    JSON.stringify({
      category_id: admin,
      name: "Email demo",
      slug: "email-demo",
      description: "Demo",
      price_cents: 2700050,
      active: false,
    }),
  ]);
}
beforeAll(async () => {
  db = await createDemoDb();
  await db.exec(`alter table auth.users add column email_confirmed_at timestamptz, add column banned_until timestamptz;
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz not null default now(),not_after timestamptz);
 create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;`);
  for (const f of [
    "202610200001_demo_orders.sql",
    "202610200002_admin_panel.sql",
    "202610220001_admin_email_access.sql",
  ])
    await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
}, 30000);
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec(
    `reset role;begin;insert into auth.users(id,email_confirmed_at) values('${admin}',now()),('${other}',now());insert into public.admin_profiles(user_id,display_name) values('${admin}','Demo');insert into auth.sessions(id,user_id) values('${session}','${admin}');insert into public.categories(id,name,slug,active) values('${admin}','Remeras','remeras',true);`,
  );
  await asUser();
});
afterEach(async () => {
  await db.exec("rollback;reset role;");
});
it("allows a confirmed active member at AAL1 through RPC, never direct catalog/inventory writes", async () => {
  expect(await allowed()).toBe(true);
  expect(
    (await db.query<{ v: string }>("select public.admin_access_mode() v"))
      .rows[0].v,
  ).toBe("email");
  await save();
  expect((await db.query("select * from public.products")).rows).toHaveLength(
    1,
  );
  await expect(
    db.exec("update public.products set price_cents=1"),
  ).rejects.toThrow(/permission denied/);
});
it.each([
  "unconfirmed",
  "banned",
  "inactive",
  "missing-profile",
  "missing-session",
  "expired-session",
  "old-session",
])("denies %s on the server", async (kind) => {
  await db.exec("reset role");
  const changes: Record<string, string> = {
    unconfirmed: "update auth.users set email_confirmed_at=null",
    banned: "update auth.users set banned_until=now()+interval '1 day'",
    inactive: "update public.admin_profiles set active=false",
    "missing-profile": "delete from public.admin_profiles",
    "missing-session": "delete from auth.sessions",
    "expired-session":
      "update auth.sessions set not_after=now()-interval '1 second'",
    "old-session":
      "update auth.sessions set created_at=now()-interval '8 days'",
  };
  await db.exec(changes[kind]);
  await asUser();
  expect(await allowed()).toBe(false);
  await expect(save()).rejects.toThrow("FORBIDDEN");
});
it("non-member, anonymous, wrong session owner, malformed session and unexpected claims never authorize", async () => {
  await asUser(other);
  expect(await allowed()).toBe(false);
  await db.exec("savepoint denied_call");
  await expect(save()).rejects.toThrow("FORBIDDEN");
  await db.exec("rollback to savepoint denied_call");
  for (const claims of [
    { session_id: "not-a-session" },
    { session_id: null },
    { aal: "aal0" },
    { role: "anon" },
  ]) {
    await asUser(admin, claims);
    expect(await allowed()).toBe(false);
  }
  await db.exec("reset role;set role anon");
  expect(await allowed()).toBe(false);
  await expect(db.query("select public.admin_access_mode()")).rejects.toThrow(
    /permission denied/,
  );
});
it("revokes privileges immediately for the same session claims and preserves public draft privacy", async () => {
  await save();
  await db.exec("reset role;update public.admin_profiles set active=false");
  await asUser();
  expect(await allowed()).toBe(false);
  expect((await db.query("select * from public.products")).rows).toHaveLength(
    0,
  );
});
it("rollback restores AAL2 without deleting accounts, factors or business data", async () => {
  await save();
  await db.exec("reset role");
  await db.exec(
    readFileSync(
      "supabase/operations/admin-email-access-rollback.sql",
      "utf8",
    ).replace(/^(begin|commit);$/gm, ""),
  );
  await asUser();
  expect(await allowed()).toBe(false);
  await asUser(admin, { aal: "aal2" });
  expect(await allowed()).toBe(true);
  expect((await db.query("select * from public.products")).rows).toHaveLength(
    1,
  );
});
it("definers use empty search path and clients cannot read or alter Auth sessions", async () => {
  const r = await db.query<{ prosecdef: boolean; proconfig: string[] }>(
    "select prosecdef,proconfig from pg_proc where oid='public.is_admin()'::regprocedure",
  );
  expect(r.rows[0].prosecdef).toBe(true);
  expect(r.rows[0].proconfig.join()).toContain('search_path=""');
  await expect(db.query("select * from auth.sessions")).rejects.toThrow(
    /permission denied/,
  );
});
it("closes the unused direct category-write grant without changing read policies", async () => {
  expect((await db.query("select * from public.categories")).rows).toHaveLength(
    1,
  );
  await expect(
    db.exec("update public.categories set name='changed'"),
  ).rejects.toThrow(/permission denied/);
});
it("email authorization preserves stock idempotency and the reserved-unit floor", async () => {
  await db.exec(
    `reset role;insert into public.products(id,category_id,name,slug,description,price_cents,active) values('${admin}','${admin}','Local stock','local-stock','Demo',2700000,false);insert into public.product_variants(id,product_id,sku,size,color,active) values('${other}','${admin}','LOCAL-S','S','Negro',true);insert into public.inventory(variant_id,on_hand,reserved) values('${other}',6,2);`,
  );
  await asUser();
  const args = [other, -2, "Local adjustment", session];
  expect(
    (
      await db.query<{ v: boolean }>(
        "select public.demo_admin_adjust_inventory($1,$2,$3,$4) v",
        args,
      )
    ).rows[0].v,
  ).toBe(true);
  expect(
    (
      await db.query<{ v: boolean }>(
        "select public.demo_admin_adjust_inventory($1,$2,$3,$4) v",
        args,
      )
    ).rows[0].v,
  ).toBe(false);
  await db.exec("savepoint stock_floor");
  await expect(
    db.query("select public.demo_admin_adjust_inventory($1,-3,$2,$3)", [
      other,
      "Too low",
      other,
    ]),
  ).rejects.toThrow("INVALID_STOCK_ADJUSTMENT");
  await db.exec("rollback to savepoint stock_floor");
  expect(
    (await db.query("select on_hand,reserved from public.inventory")).rows,
  ).toEqual([{ on_hand: 4, reserved: 2 }]);
  await asUser(other);
  await expect(
    db.query("select public.demo_admin_adjust_inventory($1,1,$2,$3)", [
      other,
      "Unauthorized",
      admin,
    ]),
  ).rejects.toThrow("FORBIDDEN");
});
