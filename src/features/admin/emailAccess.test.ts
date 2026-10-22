import { beforeEach, expect, it, vi } from "vitest";
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("./client", () => ({ adminClient: { auth: { signInWithOtp: send } } }));
import { readEmailCallback, requestAdminLink } from "./emailAccess";
beforeEach(() => vi.clearAllMocks());
it("requests only existing users with a fixed application callback", async () => {
  send.mockResolvedValue({ error: null });
  await requestAdminLink("admin@example.invalid");
  expect(send).toHaveBeenCalledWith({
    email: "admin@example.invalid",
    options: {
      shouldCreateUser: false,
      emailRedirectTo: expect.stringContaining("admin_email=1"),
    },
  });
});
it.each([
  "?admin_email=1&token_hash=demo&type=email",
  "?admin_recovery=1&token_hash=demo&type=recovery",
])("accepts official token hash with fixed purpose %s", (q) =>
  expect(readEmailCallback(new URL("http://localhost/" + q))).toMatchObject({
    kind: "hash",
    token: "demo",
  }),
);
it.each([
  "?admin_email=1&token_hash=demo&type=recovery",
  "?admin_email=1&admin_recovery=1&code=x",
  "?admin_email=1&error=expired",
  "?admin_email=1&code=x&token_hash=y",
  "?token_hash=x&type=email",
  "?admin_email=1",
  "?admin_email=1&token_hash=x&type=signup",
])("rejects mixed, invalid and unsupported callbacks %s", (q) =>
  expect(readEmailCallback(new URL("http://localhost/" + q))).toEqual({
    kind: "invalid",
  }),
);
it("preserves the PKCE flow identifier, with no invented verifier or redirect", () =>
  expect(
    readEmailCallback(
      new URL(
        "http://localhost/?admin_email=1&code=demo&sb_flow_id=slot&next=https://evil.invalid",
      ),
    ),
  ).toEqual({ kind: "code", code: "demo", flowId: "slot", recovery: false }));
