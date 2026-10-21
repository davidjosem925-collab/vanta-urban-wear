import { afterEach, describe, expect, it, vi } from "vitest";
import { accessError, deviceSupported } from "./access";
afterEach(() => vi.unstubAllGlobals());
describe("safe device authentication messages", () => {
  it.each([
    { name: "NotAllowedError" },
    { cause: { name: "AbortError" } },
    { code: "ERROR_CEREMONY_ABORTED" },
  ])("explains cancellation without echoing details", (e) => {
    expect(accessError({ ...e, message: "SECRET" })).toContain("canceló");
    expect(accessError({ ...e, message: "SECRET" })).not.toContain("SECRET");
  });
  it.each([
    "passkey_disabled",
    "mfa_webauthn_enroll_not_enabled",
    "mfa_webauthn_verify_not_enabled",
  ])("keeps backup for disabled %s", (code) =>
    expect(accessError({ code })).toContain("respaldo"),
  );
  it.each(["webauthn_challenge_expired", "webauthn_challenge_not_found"])(
    "restarts expired %s",
    (code) => expect(accessError({ code })).toContain("venció"),
  );
  it("never exposes server secrets or user identifiers", () =>
    expect(accessError({ message: "private identifier" })).not.toContain(
      "private",
    ));
  it("rejects insecure or unsupported browsers", () => {
    vi.stubGlobal("isSecureContext", false);
    expect(deviceSupported()).toBe(false);
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("PublicKeyCredential", undefined);
    expect(deviceSupported()).toBe(false);
  });
});

it.each([
  ["mfa_verification_failed", "El código no es válido"],
  ["mfa_totp_verify_not_enabled", "no está habilitada"],
  ["mfa_totp_enroll_not_enabled", "no está habilitada"],
  ["mfa_factor_not_found", "Actualizá los métodos"],
  ["mfa_challenge_expired", "verificación venció"],
  ["mfa_ip_address_mismatch", "conexión cambió"],
  ["session_not_found", "sesión venció"],
  ["insufficient_aal", "segunda verificación"],
])("maps %s without raw service details", (code, message) => {
  expect(accessError({ code, message: "PRIVATE" })).toContain(message);
  expect(accessError({ code, message: "PRIVATE" })).not.toContain("PRIVATE");
});
it("distinguishes rate limits, network and unknown HTTP rejection", () => {
  expect(accessError({ status: 429 })).toContain("demasiados intentos");
  expect(accessError({ name: "AuthRetryableFetchError", status: 0 })).toContain(
    "conexión",
  );
  expect(accessError({ status: 403, message: "PRIVATE" })).toContain(
    "HTTP 403",
  );
});
