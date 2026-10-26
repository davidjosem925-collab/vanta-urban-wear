// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createDemoDb } from "./demo-fixture";

let db: Awaited<ReturnType<typeof createDemoDb>>;
const admin = "10000000-0000-0000-0000-000000000001";
const sid = "20000000-0000-0000-0000-000000000001";
async function claims(extra: Record<string, unknown> = {}) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [admin, JSON.stringify({ role: "authenticated", aal: "aal2", session_id: sid, ...extra })]);
  await db.exec("set role authenticated");
}
async function allowed() {
  return (await db.query<{ v: boolean }>("select public.mp_checkout_is_admin() v")).rows[0].v;
}
beforeAll(async () => {
  db = await createDemoDb();
  await db.exec(`alter table auth.users add column email_confirmed_at timestamptz, add column banned_until timestamptz;
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz not null default now(),not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;`);
  for (const f of ["202610200001_demo_orders.sql", "202610200002_admin_panel.sql", "202610260001_mp_admin_session.sql"])
    await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
}, 30000);
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec(`reset role;begin;
    insert into auth.users(id,email_confirmed_at) values('${admin}',now());
    insert into public.admin_profiles(user_id,display_name) values('${admin}','Admin');
    insert into auth.sessions(id,user_id) values('${sid}','${admin}');`);
  await claims();
});
afterEach(async () => { await db.exec("rollback;reset role"); });
it("accepts an active AAL2 administrator without the optional email migration", async () => {
  expect(await allowed()).toBe(true);
});
it("rejects a session owned by a different user", async () => {
  await db.exec(`reset role;insert into auth.users(id) values('${sid}');update auth.sessions set user_id='${sid}'`);
  await claims();
  expect(await allowed()).toBe(false);
});
it.each([
  "delete from auth.sessions",
  "update auth.sessions set not_after=now()-interval '1 second'",
  "update auth.users set banned_until=now()+interval '1 day'",
  "update auth.users set email_confirmed_at=null",
  "update public.admin_profiles set active=false",
  "delete from public.admin_profiles",
])("denies revoked or unauthorized identity: %s", async (sql) => {
  await db.exec("reset role");
  await db.exec(sql);
  await claims();
  expect(await allowed()).toBe(false);
});
it.each([{session_id: "wrong"}, {session_id: null}, {role: "service_role"}, {aal: "aal1"}])("preserves role, session and existing AAL policy: %s", async (extra) => {
  await claims(extra);
  expect(await allowed()).toBe(false);
});
it.each(["anon", "service_role"])("does not grant the user guard to %s", async (role) => {
  await db.exec(`reset role;set role ${role}`);
  await expect(allowed()).rejects.toThrow(/permission denied/);
});
it("preserves optional email mode, including its session age policy", async () => {
  await db.exec("reset role");
  await db.exec(readFileSync("supabase/migrations/202610220001_admin_email_access.sql", "utf8").replace(/^(begin|commit);$/gm, ""));
  await claims({ aal: "aal1" });
  expect(await allowed()).toBe(true);
  await db.exec("reset role;update auth.sessions set created_at=now()-interval '8 days'");
  await claims({ aal: "aal1" });
  expect(await allowed()).toBe(false);
});
