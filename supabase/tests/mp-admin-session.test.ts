// @vitest-environment node
import { expect, it, vi } from "vitest";
import { makePaymentHandler } from "../functions/_shared/mp-orders/handlers";
import { settings, payment } from "./mp-fixture";

function request(action: string, token?: string) {
  return new Request("https://edge.example/mp-checkout", {
    method: "POST",
    headers: {
      origin: settings.origin,
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      action, reference: payment.reference, capability: "a".repeat(64),
    }),
  });
}
for (const action of ["create", "recover"]) {
  it.each([undefined, "x".repeat(8193)])("rejects missing/oversized token before any dependency: %s", async (token) => {
    const rpc = vi.fn(), fetcher = vi.fn();
    const response = await makePaymentHandler("checkout", settings, rpc, fetcher)(request(action, token));
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    [401, { message: "invalid signature" }],
    [401, { message: "expired JWT" }],
    [200, false], // Revoked session or authenticated non-admin.
    [403, false], // anon/service_role cannot execute the guard.
    [200, { v: true }], // Only the exact scalar contract is accepted.
    [500, true],
  ])("denies auth response %s before all payment RPCs", async (status, body) => {
    const rpc = vi.fn();
    const fetcher = vi.fn(async () => Response.json(body, { status }));
    const response = await makePaymentHandler("checkout", settings, rpc, fetcher)(request(action, "visitor-jwt"));
    expect([401, 403]).toContain(response.status);
    expect(rpc).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(settings.supabaseUrl + "/rest/v1/rpc/mp_checkout_is_admin");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer visitor-jwt");
    expect(new Headers(init.headers).get("apikey")).toBe(settings.anonKey);
  });
  it("fails closed on authentication network errors", async () => {
    const rpc = vi.fn();
    const fetcher = vi.fn(async () => { throw new Error("offline"); });
    expect((await makePaymentHandler("checkout", settings, rpc, fetcher)(request(action, "jwt"))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
}
it("authorizes recovery before payment RPCs without contacting the provider", async () => {
  const order: string[] = [];
  const fetcher = vi.fn(async () => { order.push("auth"); return Response.json(true); });
  const rpc = vi.fn(async (name: string) => {
    order.push(name);
    if (name === "demo_rate_limit") return true;
    if (name === "mp_test_settings") return { seller_id: settings.seller, application_id: settings.application };
    return null;
  });
  const response = await makePaymentHandler("checkout", settings, rpc, fetcher)(request("recover", "admin-jwt"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ found: false });
  expect(order).toEqual(["auth", "demo_rate_limit", "mp_test_settings", "mp_test_prepare"]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
