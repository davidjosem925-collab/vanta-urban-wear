import { it, expect } from "vitest";
import { priceCents, readAdjustment, money } from "./model";
it("prices use exact centavos, reject ambiguous separators, floats and unsafe ranges", () => {
  expect(priceCents("27000")).toBe(2700000);
  expect(priceCents("27000,50")).toBe(2700050);
  expect(priceCents("0.01")).toBe(1);
  for (const v of ["27.000", "1e5", "-1", "1,005", "Infinity", "1000000001"])
    expect(() => priceCents(v)).toThrow();
  expect(money(2700000)).toContain("27.000");
});
it("pending adjustment storage is untrusted and restores only bounded operations", () => {
  const a = {
    key: "10000000-0000-0000-0000-000000000001",
    variant: "10000000-0000-0000-0000-000000000002",
    delta: -2,
    reason: "Recount",
  };
  expect(readAdjustment(JSON.stringify(a))).toEqual(a);
  for (const raw of [
    "broken",
    null,
    "{}",
    JSON.stringify({ ...a, delta: 0 }),
    JSON.stringify({ ...a, delta: 1001 }),
    JSON.stringify({ ...a, reason: null }),
  ])
    expect(readAdjustment(raw)).toBeNull();
});
