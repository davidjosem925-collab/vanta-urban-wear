import { beforeEach, expect, it, vi } from "vitest";
const { list, listFactors } = vi.hoisted(() => ({
  list: vi.fn(),
  listFactors: vi.fn(),
}));
vi.mock("./client", () => ({
  adminClient: { auth: { passkey: { list }, mfa: { listFactors } } },
}));
import { ensureCredentialFamily } from "./deviceRegistration";
beforeEach(() => vi.clearAllMocks());
it("blocks primary enrollment if a verified device factor could be overwritten", async () => {
  listFactors.mockResolvedValue({
    data: { all: [{ factor_type: "webauthn", status: "verified" }] },
    error: null,
  });
  await expect(ensureCredentialFamily("login")).rejects.toMatchObject({
    code: "device_credential_conflict",
  });
});
it("blocks device-factor enrollment while primary credentials exist", async () => {
  list.mockResolvedValue({ data: [{ id: "primary" }], error: null });
  await expect(ensureCredentialFamily("verification")).rejects.toMatchObject({
    code: "device_credential_conflict",
  });
});
it("permits existing TOTP backup and failed incomplete device registrations", async () => {
  listFactors.mockResolvedValue({
    data: {
      all: [
        { factor_type: "totp", status: "verified" },
        { factor_type: "webauthn", status: "unverified" },
      ],
    },
    error: null,
  });
  await expect(ensureCredentialFamily("login")).resolves.toBeUndefined();
});
it("does not assume disabled primary API means no older credentials exist", async () => {
  list.mockResolvedValue({ data: null, error: { code: "passkey_disabled" } });
  await expect(ensureCredentialFamily("verification")).rejects.toMatchObject({
    code: "passkey_disabled",
  });
});
it("fails closed if active credentials cannot be inspected", async () => {
  list.mockResolvedValue({ data: null, error: { code: "network_error" } });
  await expect(ensureCredentialFamily("verification")).rejects.toMatchObject({
    code: "network_error",
  });
});
