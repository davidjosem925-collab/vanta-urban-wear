import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it.each([
  ["localhost", "localhost", true],
  ["shop.example.com", "shop.example.com", true],
  ["example.com", "shop.example.com", true],
  ["localhost", "127.0.0.1", false],
  ["example.com", "otherexample.com", false],
  ["", "localhost", false],
  ["http://localhost", "localhost", false],
  ["localhost:5173", "localhost", false],
  ["local host", "local host", false],
  ["local\thost", "local\thost", false],
])("validates RP %s against host %s", async (rp, hostname, valid) => {
  vi.resetModules();
  vi.stubEnv("VITE_ADMIN_RP_ID", rp);
  vi.stubGlobal("location", { hostname });
  const { deviceConfigurationValid } = await import("./access");
  expect(deviceConfigurationValid()).toBe(valid);
});

it.each(["false", "", "TRUE", "1", "true"])(
  "requires explicit independent flags: %s",
  async (flag) => {
    vi.resetModules();
    vi.stubEnv("VITE_ADMIN_PASSKEYS_ENABLED", flag);
    vi.stubEnv("VITE_ADMIN_DEVICE_MFA_ENABLED", "false");
    const access = await import("./access");
    expect(access.passkeysEnabled).toBe(flag === "true");
    expect(access.deviceMfaEnabled).toBe(false);
  },
);
