// @vitest-environment node
import { expect, it, vi } from "vitest";
import { Provider, snapshot } from "../functions/_shared/mp-orders/provider";
import { identity, payment, remote, resource, settings } from "./mp-fixture";
it.each([true, "false", "true", 0, 1, null, {}, [], undefined])(
  "present live_mode must be boolean false: %j",
  (live_mode) => {
    for (const dependency of ["create", "get"] as const)
      expect(() =>
        snapshot(remote({ live_mode }), payment, settings, dependency),
      ).toThrow(
        expect.objectContaining({
          code: "INVALID_PROVIDER_RESPONSE",
          validation: "live_mode",
          dependency,
        }),
      );
  },
);
it.each(["absent", "false"])(
  "documented %s live_mode preserves pending and explicit accredited evidence",
  (kind) => {
    for (const approved of [false, true]) {
      const raw = remote(
        approved
          ? {
              status: "processed",
              status_detail: "accredited",
              total_paid_amount: "50001.00",
            }
          : {},
      );
      if (kind === "false") Object.assign(raw, { live_mode: false });
      else delete (raw as Record<string, unknown>).live_mode;
      expect(snapshot(raw, payment, settings).value.state).toBe(
        approved ? "approved" : "pending",
      );
    }
  },
);
for (const method of ["create", "find", "cancel"] as const)
  it.each([
    { seller_id: "999" },
    { application_id: "999" },
    { seller_id: 123 },
    { application_id: null },
  ])(
    `${method} rejects inconsistent frozen identity before any provider request: %j`,
    async (extra) => {
      const fetcher = vi.fn();
      const p = new Provider(settings, fetcher);
      const c = {
        ...payment,
        provider_order_id: resource,
        ...extra,
      } as typeof payment;
      await expect(p[method](c)).rejects.toMatchObject({
        code: "NOT_CONFIGURED",
      });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
for (const method of ["create", "get", "find", "cancel"] as const)
  it.each([
    { tags: [] },
    { id: 999 },
    { site_id: "MLB" },
    { status: { site_status: "blocked" } },
  ])(
    `${method} still rejects non-test or unexpected authenticated seller: %j`,
    async (extra) => {
      const fetcher = vi.fn(async () =>
        Response.json({ ...identity, ...extra }),
      );
      const p = new Provider(settings, fetcher);
      const op =
        method === "get"
          ? p.get(resource)
          : p[method]({ ...payment, provider_order_id: resource });
      await expect(op).rejects.toMatchObject({
        code: "TEST_IDENTITY_REQUIRED",
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledWith(
        "https://api.mercadolibre.com/users/me",
        expect.objectContaining({ method: "GET" }),
      );
    },
  );
