/* global window, LocalAuthSdk, testAuth, location */
// Only imported by the disposable Docker harness. No hosted project input.
import { createServer } from "node:http";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { build } from "vite";
import { chromium } from "@playwright/test";
export async function passkeyGateway() {
  const result = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve("node_modules/@supabase/supabase-js/dist/index.mjs"),
        name: "LocalAuthSdk",
        formats: ["iife"],
      },
    },
  });
  const sdk = (Array.isArray(result) ? result[0] : result).output.find(
    (x) => x.type === "chunk",
  ).code;
  let authUrl;
  const server = createServer(async (req, res) => {
    try {
      if (req.url.startsWith("/auth/v1/")) {
        assert.ok(authUrl);
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const r = await fetch(authUrl + req.url.replace(/^\/auth\/v1/, ""), {
          method: req.method,
          headers: {
            "Content-Type": "application/json",
            Authorization: req.headers.authorization ?? "",
          },
          ...(req.method !== "GET" && req.method !== "HEAD"
            ? { body: Buffer.concat(chunks) }
            : {}),
          signal: AbortSignal.timeout(5000),
        });
        res.writeHead(r.status, { "Content-Type": "application/json" });
        res.end(Buffer.from(await r.arrayBuffer()));
      } else if (req.url === "/sdk.js") {
        res.writeHead(200, { "Content-Type": "text/javascript" });
        res.end(sdk);
      } else {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          '<!doctype html><title>Local isolated authentication test</title><script src="/sdk.js"></script>',
        );
      }
    } catch {
      res.writeHead(502);
      res.end("{}");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://localhost:${server.address().port}`;
  return {
    origin,
    connect: (url) => {
      assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
      authUrl = url;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
export async function testPasskeys({
  gateway,
  anon,
  session,
  call,
  backupFactor,
  backupCode,
}) {
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  try {
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await page.goto(gateway.origin);
    await page.evaluate(
      async ({ anon, session }) => {
        window.testAuth = LocalAuthSdk.createClient(location.origin, anon, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            experimental: { passkey: true },
          },
        });
        const r = await testAuth.auth.setSession(session);
        if (r.error) throw new Error("local session setup failed");
      },
      { anon, session },
    );
    const registered = await page.evaluate(async () => {
      const r = await testAuth.auth.registerPasskey();
      return {
        error: r.error?.code ?? (r.error ? "registration_failed" : null),
        id: r.data?.id,
      };
    });
    assert.equal(registered.error, null, "real server primary registration");
    const firstLevel = await page.evaluate(async () => {
      await testAuth.auth.signOut({ scope: "local" });
      const r = await testAuth.auth.signInWithPasskey();
      if (r.error) return { error: r.error.code ?? "sign_in_failed" };
      return {
        token: r.data.session.access_token,
        level: (await testAuth.auth.mfa.getAuthenticatorAssuranceLevel()).data
          .currentLevel,
      };
    });
    assert.equal(firstLevel.error, undefined);
    assert.equal(firstLevel.level, "aal1");
    assert.equal(
      await (await call(firstLevel.token, "is_admin")).json(),
      false,
      "passkey primary alone must NOT authorize admin",
    );
    const managementDenied = await page.evaluate(async (passkeyId) => {
      const r = await testAuth.auth.passkey.delete({ passkeyId });
      return Boolean(r.error);
    }, registered.id);
    assert.equal(
      managementDenied,
      true,
      "primary AAL1 must not delete credentials while verified MFA exists",
    );
    await page.evaluate(
      async ({ backupFactor, backupCode, passkeyId }) => {
        const login = await testAuth.auth.signInWithPassword({
          email: "admin@local.invalid",
          password: "Only-Local-Test-Password-123!",
        });
        if (login.error) throw new Error("restore local login");
        const restored = await testAuth.auth.mfa.challengeAndVerify({
          factorId: backupFactor,
          code: backupCode,
        });
        if (restored.error) throw new Error("restore local authorized session");
        const removed = await testAuth.auth.passkey.delete({ passkeyId });
        if (removed.error)
          throw new Error("remove primary before choosing device verification");
      },
      { backupFactor, backupCode: backupCode(), passkeyId: registered.id },
    );
    const factor = await page.evaluate(async () => {
      const r = await testAuth.auth.mfa.webauthn.register(
        {
          friendlyName: "Local device verification",
          webauthn: { rpId: "localhost", rpOrigins: [location.origin] },
        },
        {
          hints: ["client-device"],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            residentKey: "required",
            userVerification: "required",
          },
        },
      );
      const f = await testAuth.auth.mfa.listFactors();
      return {
        error: r.error?.code ?? (r.error ? "factor_registration_failed" : null),
        id: f.data?.all.find(
          (f) => f.factor_type === "webauthn" && f.status === "verified",
        )?.id,
      };
    });
    assert.equal(factor.error, null, "real server device enrollment");
    assert.ok(factor.id);
    const passwordLevel = await page.evaluate(async () => {
      await testAuth.auth.signOut({ scope: "local" });
      const r = await testAuth.auth.signInWithPassword({
        email: "admin@local.invalid",
        password: "Only-Local-Test-Password-123!",
      });
      if (r.error) throw new Error("local password login failed");
      return (await testAuth.auth.mfa.getAuthenticatorAssuranceLevel()).data
        .currentLevel;
    });
    assert.equal(passwordLevel, "aal1");
    const elevated = await page.evaluate(async (factorId) => {
      const r = await testAuth.auth.mfa.webauthn.challenge(
        {
          factorId,
          webauthn: { rpId: "localhost", rpOrigins: [location.origin] },
        },
        { request: { userVerification: "required", hints: ["client-device"] } },
      );
      if (r.error) return { error: r.error.code ?? "challenge_failed" };
      const v = await testAuth.auth.mfa.webauthn.verify({
        factorId,
        challengeId: r.data.challengeId,
        webauthn: {
          rpId: "localhost",
          rpOrigins: [location.origin],
          ...r.data.webauthn,
        },
      });
      if (v.error) return { error: v.error.code ?? "verify_failed" };
      return {
        token: (await testAuth.auth.getSession()).data.session.access_token,
        level: (await testAuth.auth.mfa.getAuthenticatorAssuranceLevel()).data
          .currentLevel,
      };
    }, factor.id);
    assert.equal(elevated.error, undefined);
    assert.equal(elevated.level, "aal2");
    assert.equal(await (await call(elevated.token, "is_admin")).json(), true);
    const removed = await page.evaluate(
      async ({ passkeyId, factorId }) => {
        const list = await testAuth.auth.passkey.list();
        const unenroll = await testAuth.auth.mfa.unenroll({ factorId });
        await testAuth.auth.signOut({ scope: "local" });
        return {
          listed: !list.error,
          deleted: !list.data?.some((p) => p.id === passkeyId),
          unenrolled: !unenroll.error,
        };
      },
      { passkeyId: registered.id, factorId: factor.id },
    );
    assert.deepEqual(removed, {
      listed: true,
      deleted: true,
      unenrolled: true,
    });
    console.log(
      "PASS real isolated GoTrue passkey cryptographic registration/login (AAL1 denied), device second factor (AAL2 authorized), list/removal; Chromium virtual authenticator, no hosted services",
    );
  } finally {
    await browser.close();
  }
}
