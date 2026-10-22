import { act, renderHook } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useDemoOrder } from "./useDemoOrder";
import {
  newAttempt,
  receipt,
  type OrderService,
  type Receipt,
  type OrderPayload,
} from "./service";
const reference = "20000000-0000-0000-0000-000000000001";
const payload: OrderPayload = {
  items: [
    { variant_id: reference, quantity: 2, expected_price_cents: 2500050 },
  ],
  delivery: "pickup",
  payment: "transfer",
};
const r: Receipt = {
  reference,
  status: "pending",
  subtotal_cents: 5000100,
  created_at: "2026-10-22T20:00:00Z",
  expires_at: "2026-10-22T21:00:00Z",
  demo: true,
  email_requested: true,
};
beforeEach(() => sessionStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});
it("notification email is ephemeral, outside original idempotent order payload and persisted recovery identity", async () => {
  const confirm = vi
      .fn()
      .mockRejectedValueOnce(Error("NETWORK_ERROR"))
      .mockResolvedValue(r),
    recover = vi.fn().mockResolvedValue(r),
    success = vi.fn();
  const s: OrderService = {
    enabled: true,
    siteKey: "fixture",
    notificationsEnabled: true,
    confirm,
    recover,
  };
  const first = renderHook(() => useDemoOrder(s, success));
  await act(() =>
    first.result.current.confirm(payload, "single-use", "owner@example.test"),
  );
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({ payload }),
    "single-use",
    "owner@example.test",
  );
  expect(sessionStorage.getItem("vanta.order-attempt.v1")).not.toContain(
    "owner@example.test",
  );
  expect(JSON.stringify(confirm.mock.calls[0][0])).not.toContain("email");
  first.unmount();
  const next = renderHook(() => useDemoOrder(s, success));
  await act(() => next.result.current.recover());
  expect(recover.mock.calls[0][0]).toEqual(confirm.mock.calls[0][0]);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(success).toHaveBeenCalledWith(r, payload, expect.anything());
});
it("disabled feature cannot leak an email through an injected legacy service", async () => {
  const confirm = vi.fn().mockResolvedValue({ ...r, email_requested: false });
  const h = renderHook(() =>
    useDemoOrder(
      { enabled: true, siteKey: "fixture", confirm, recover: vi.fn() },
      vi.fn(),
    ),
  );
  await act(() =>
    h.result.current.confirm(payload, "token", "owner@example.test"),
  );
  expect(confirm).toHaveBeenCalledWith(expect.anything(), "token");
});
it("receipt acknowledges requested email, not delivery; old receipts remain compatible and malformed metadata fails closed", () => {
  expect(receipt(r).email_requested).toBe(true);
  const old = { ...r };
  delete old.email_requested;
  expect(receipt(old)).not.toHaveProperty("email_requested");
  expect(() => receipt({ ...r, email_requested: "delivered" })).toThrow(
    "INVALID_RESPONSE",
  );
});
async function configured(flag = "true") {
  for (const [key, value] of Object.entries({
    VITE_SUPABASE_URL: "https://fixture.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit_fixture_only",
    VITE_DEMO_ORDERS_ENABLED: "true",
    VITE_TURNSTILE_SITE_KEY: "fixture-public",
    VITE_DEMO_EMAIL_ENABLED: flag,
  }))
    vi.stubEnv(key, value);
  vi.resetModules();
  return (await import("./service")).orderService;
}
it("public flag enables only validated email input to demo-orders; no Resend credentials or data beyond the recipient", async () => {
  const service = await configured();
  const fetcher = vi.fn().mockImplementation(async () => Response.json(r));
  vi.stubGlobal("fetch", fetcher);
  const attempt = newAttempt(payload);
  expect(service.notificationsEnabled).toBe(true);
  await service.confirm(attempt, "token", "OWNER@example.test");
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe("https://fixture.supabase.co/functions/v1/demo-orders");
  expect(JSON.parse(options.body)).toEqual({
    action: "create",
    idempotency_key: attempt.key,
    capability: attempt.capability,
    payload,
    challenge: "token",
    notification_email: "owner@example.test",
  });
  await service.recover(attempt);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).not.toHaveProperty(
    "notification_email",
  );
  expect(JSON.stringify(fetcher.mock.calls)).not.toMatch(
    /RESEND|re_fixture|ENCRYPTION_KEY/,
  );
});
it("feature defaults off; invalid notification address is rejected before fetch", async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json(r));
  vi.stubGlobal("fetch", fetcher);
  const disabled = await configured("false");
  await disabled.confirm(newAttempt(payload), "token", "owner@example.test");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty(
    "notification_email",
  );
  fetcher.mockClear();
  const enabled = await configured();
  await expect(
    enabled.confirm(
      newAttempt(payload),
      "token",
      "bad\r\nBcc:other@example.test",
    ),
  ).rejects.toThrow("INVALID_EMAIL");
  expect(fetcher).not.toHaveBeenCalled();
});
