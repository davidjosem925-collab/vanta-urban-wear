import { expect, it } from "vitest";
import headers from "../../../vercel.json";
import { parseRoute } from "../../app/router";
it("keeps routes compatible and prepares restrictive hosting headers without any private key", () => {
  expect(parseRoute("#/admin")).toEqual({ kind: "admin" });
  expect(parseRoute("#/catalogo")).toEqual({ kind: "catalog" });
  expect(parseRoute("#/checkout")).toEqual({
    kind: "checkout",
    step: "details",
  });
  const h = headers.headers[0].headers,
    csp = h.find((h) => h.key === "Content-Security-Policy")!.value;
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("https://challenges.cloudflare.com");
  expect(csp).toContain("https://evlbfjvvljbkntlozokt.supabase.co");
  expect(csp).not.toContain("https://*.");
  expect(JSON.stringify(headers)).not.toMatch(/service_role|sb_secret_|eyJ/);
  expect(h.find((h) => h.key === "Referrer-Policy")?.value).toBe("no-referrer");
});
