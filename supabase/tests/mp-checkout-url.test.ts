// @vitest-environment node
import { expect, it } from "vitest";
import { checkoutUrl as serverUrl } from "../functions/_shared/mp-orders/core";
import { checkoutUrl as browserUrl } from "../../src/features/payments/service";
import { snapshot } from "../functions/_shared/mp-orders/provider";
import { payment, remote, resource, settings } from "./mp-fixture";
import { prefix, validUrls, invalidUrls } from "./mp-url-fixture";
it.each(validUrls)(
  "server and browser preserve the complete provider URL: %s",
  (url) => {
    expect(serverUrl(url, resource)).toBe(url);
    expect(browserUrl(url)).toBe(url);
    for (const dependency of ["create", "get"] as const) {
      const data = remote({ checkout_url: url });
      delete (data as Record<string, unknown>).total_paid_amount;
      delete (data as Record<string, unknown>).status_detail;
      expect(snapshot(data, payment, settings, dependency)).toMatchObject({
        id: resource,
        url,
        value: {
          state: "pending",
          paid_cents: null,
          paid_evidence: "unreported",
        },
      });
    }
  },
);
it.each(invalidUrls)(
  "server and browser reject unsafe/ambiguous URLs: %s",
  (url) => {
    expect(() => serverUrl(url, resource)).toThrow();
    expect(() => browserUrl(url)).toThrow();
    for (const dependency of ["create", "get"] as const)
      expect(() =>
        snapshot(remote({ checkout_url: url }), payment, settings, dependency),
      ).toThrow(
        expect.objectContaining({ validation: "checkout_url", dependency }),
      );
  },
);
it("order_id must equal the validated provider order, never pref_id or another order", () => {
  const url = `${prefix}order_id=ORDTSTAAAAAAAAAAAA&pref_id=${resource}`;
  expect(() => serverUrl(url, resource)).toThrow();
  expect(() =>
    snapshot(remote({ checkout_url: url }), payment, settings),
  ).toThrow(expect.objectContaining({ validation: "checkout_url" }));
});
