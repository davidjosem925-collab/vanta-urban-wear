// Only imported by disposable local harness; no remote URLs/DSNs accepted.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
export async function testEmailAccess({
  client,
  call,
  sql,
  api,
  auth,
  serviceToken,
  until,
  user,
  values,
}) {
  assert.match(auth, /^http:\/\/127\.0\.0\.1:\d+$/);
  sql(
    readFileSync(
      "supabase/migrations/202610220001_admin_email_access.sql",
      "utf8",
    ),
  );
  const originalSession = (await client.auth.getSession()).data.session;
  await until(async () => {
    const response = await call(
      originalSession.access_token,
      "admin_access_mode",
    );
    return response.ok && (await response.json()) === "email";
  });
  const generate = async (
    type = "magiclink",
    email = "admin@local.invalid",
  ) => {
    const r = await api(auth + "/admin/generate_link", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type, email }),
    });
    assert.equal(r.status, 200);
    return (await r.json()).hashed_token;
  };
  const consume = (token_hash, type = "email") =>
    client.auth.verifyOtp({ token_hash, type });
  // Official generated links test cryptography/one-time semantics, not SMTP.
  const token = await generate();
  const result = await consume(token);
  assert.equal(result.error, null);
  const access = result.data.session.access_token;
  assert.equal(
    JSON.parse(Buffer.from(access.split(".")[1], "base64url")).aal,
    "aal1",
  );
  assert.equal(await (await call(access, "is_admin")).json(), true);
  assert.equal(
    (
      await call(access, "admin_save_product", {
        p_id: null,
        p_expected: null,
        p_values: { ...values, slug: "email-admin" },
      })
    ).status,
    200,
  );
  assert.ok((await consume(token)).error, "one-time link cannot be reused");
  assert.ok((await consume("invalid-local-token")).error);
  const expired = await generate();
  await new Promise((r) => setTimeout(r, 3100));
  assert.ok((await consume(expired)).error, "expired link must fail");
  const recovery = await consume(await generate("recovery"), "recovery");
  assert.equal(recovery.error, null);
  assert.equal(
    await (await call(recovery.data.session.access_token, "is_admin")).json(),
    true,
  );
  const protectedChange = await client.auth.updateUser({
    password: "New-Local-Only-Password-123!",
  });
  assert.ok(protectedChange.error, "existing MFA protects password changes");
  assert.equal(protectedChange.error.code, "insufficient_aal");
  const ordinary = await client.auth.signUp({
    email: "ordinary@local.invalid",
    password: "Only-Local-Test-Password-123!",
  });
  assert.equal(ordinary.error, null);
  assert.equal(
    await (await call(ordinary.data.session.access_token, "is_admin")).json(),
    false,
  );
  assert.equal(
    (
      await call(ordinary.data.session.access_token, "admin_save_product", {
        p_id: null,
        p_expected: null,
        p_values: { ...values, slug: "blocked" },
      })
    ).status,
    400,
  );
  // Recovery is fully usable without MFA; never remove existing factors to test it.
  sql(
    `insert into public.admin_profiles(user_id,display_name) values('${ordinary.data.user.id}','Second local admin');`,
  );
  const noMfaRecovery = await consume(
    await generate("recovery", "ordinary@local.invalid"),
    "recovery",
  );
  assert.equal(noMfaRecovery.error, null);
  assert.equal(
    await (
      await call(noMfaRecovery.data.session.access_token, "is_admin")
    ).json(),
    true,
  );
  assert.equal(
    (await client.auth.updateUser({ password: "Changed-Local-Password-123!" }))
      .error,
    null,
  );
  const changedLogin = await client.auth.signInWithPassword({
    email: "ordinary@local.invalid",
    password: "Changed-Local-Password-123!",
  });
  assert.equal(changedLogin.error, null);
  const anotherLogin = await client.auth.signInWithPassword({
    email: "ordinary@local.invalid",
    password: "Changed-Local-Password-123!",
  });
  assert.equal(anotherLogin.error, null);
  assert.equal((await client.auth.signOut({ scope: "global" })).error, null);
  for (const token of [
    changedLogin.data.session.access_token,
    anotherLogin.data.session.access_token,
  ])
    assert.equal(
      await (await call(token, "is_admin")).json(),
      false,
      "global signout revokes each SQL session",
    );
  const login = await client.auth.signInWithPassword({
    email: "admin@local.invalid",
    password: "Only-Local-Test-Password-123!",
  });
  assert.equal(login.error, null);
  const passwordJwt = login.data.session.access_token;
  assert.equal(await (await call(passwordJwt, "is_admin")).json(), true);
  sql(`update public.admin_profiles set active=false where user_id='${user}';`);
  assert.equal(await (await call(passwordJwt, "is_admin")).json(), false);
  sql(`update public.admin_profiles set active=true where user_id='${user}';`);
  assert.equal(await (await call(passwordJwt, "is_admin")).json(), true);
  assert.equal((await client.auth.signOut({ scope: "local" })).error, null);
  assert.equal(
    await (await call(passwordJwt, "is_admin")).json(),
    false,
    "signed-out JWT immediately loses SQL authority",
  );
  sql(
    readFileSync("supabase/operations/admin-email-access-rollback.sql", "utf8"),
  );
  const again = await client.auth.signInWithPassword({
    email: "admin@local.invalid",
    password: "Only-Local-Test-Password-123!",
  });
  assert.equal(again.error, null);
  assert.equal(
    await (await call(again.data.session.access_token, "is_admin")).json(),
    false,
    "rollback restores AAL2",
  );
  console.log(
    "PASS real isolated email/password AAL1 authorization, one-time/invalid/expired links, recovery preserving MFA restriction, non-member denial, profile/session revocation and rollback; SMTP not tested.",
  );
}
