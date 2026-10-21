import { beforeEach, expect, it, vi } from "vitest";
const { challenge, verify } = vi.hoisted(() => ({
  challenge: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("./client", () => ({
  adminClient: { auth: { mfa: { webauthn: { challenge, verify } } } },
}));
import { verifyDevice } from "./deviceVerification";
beforeEach(() => vi.clearAllMocks());
const params = {
  factorId: "own-factor",
  webauthn: { rpId: "localhost", rpOrigins: ["http://localhost"] },
};
it("keeps server challenge and requires device verification", async () => {
  challenge.mockResolvedValue({
    data: {
      challengeId: "fresh-server-challenge",
      webauthn: { type: "request", credential_response: { id: "signed" } },
    },
    error: null,
  });
  verify.mockResolvedValue({ data: {}, error: null });
  await verifyDevice(params, { userVerification: "required" });
  expect(challenge).toHaveBeenCalledWith(
    { ...params, signal: undefined },
    { request: { userVerification: "required", hints: ["client-device"] } },
  );
  expect(verify).toHaveBeenCalledWith(
    expect.objectContaining({
      challengeId: "fresh-server-challenge",
      factorId: "own-factor",
    }),
  );
});
it.each(["cancelled", "expired"])(
  "does not verify after %s challenge fails",
  async (code) => {
    challenge.mockResolvedValue({ data: null, error: { code } });
    expect(
      (await verifyDevice(params, { userVerification: "required" })).error,
    ).toEqual({ code });
    expect(verify).not.toHaveBeenCalled();
  },
);
