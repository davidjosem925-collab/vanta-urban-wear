// Explicit local Deno compatibility test; no Supabase/Cloudflare network access.
// deno test --no-config --allow-net=127.0.0.1 supabase/tests/siteverify.deno.ts
import { makeHandler, type Rpc } from "../functions/demo-orders/handler.ts";
import type { DiagnosticEvent } from "../functions/demo-orders/diagnostics.ts";
function assert(value: unknown): asserts value {
  if (!value) throw new Error("Siteverify compatibility assertion failed");
}
for (const mode of ["valid", "invalid-secret", "non-2xx-success"] as const) {
  Deno.test(
    `Deno form encoding and fail-closed Siteverify: ${mode}`,
    async () => {
      const secret = "fixture +/=&%? ñ",
        token = "fixture +/=&%? é";
      const events: DiagnosticEvent[] = [],
        calls: string[] = [];
      const server = Deno.serve(
        { hostname: "127.0.0.1", port: 0, onListen() {} },
        async (req) => {
          assert(req.method === "POST");
          assert(
            req.headers.get("content-type") ===
              "application/x-www-form-urlencoded",
          );
          assert(
            !req.headers.has("authorization") && !req.headers.has("apikey"),
          );
          const form = await req.formData();
          assert([...form.keys()].sort().join(",") === "response,secret");
          assert(
            form.get("secret") === secret && form.get("response") === token,
          );
          return Response.json(
            mode === "invalid-secret"
              ? { success: false, "error-codes": ["invalid-input-secret"] }
              : {
                  success: true,
                  hostname: "shop.example",
                  action: "demo-order",
                },
            { status: mode === "valid" ? 200 : 400 },
          );
        },
      );
      try {
        const rpc: Rpc = async (name) => {
          calls.push(name);
          return {
            data: name === "demo_order_replay" ? null : true,
            error: null,
          };
        };
        const fetcher: typeof fetch = (input, init) => {
          assert(
            input ===
              "https://challenges.cloudflare.com/turnstile/v0/siteverify",
          );
          return fetch(`http://127.0.0.1:${server.addr.port}/siteverify`, init);
        };
        const handler = makeHandler(
          {
            origin: "https://shop.example",
            challengeHostname: "shop.example",
            challengeSecret: secret,
            actorSecret: "x".repeat(32),
          },
          rpc,
          fetcher,
          (e) => events.push(e),
        );
        const id = "10000000-0000-0000-0000-000000000001";
        const response = await handler(
          new Request("https://local-fixture.example", {
            method: "POST",
            headers: {
              origin: "https://shop.example",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              action: "create",
              capability: "a".repeat(64),
              idempotency_key: id,
              challenge: token,
              payload: {
                items: [
                  { variant_id: id, quantity: 1, expected_price_cents: 100 },
                ],
                delivery: "pickup",
                payment: "cash",
              },
            }),
          }),
        );
        assert(response.status === (mode === "valid" ? 200 : 503));
        const result = await response.json();
        if (mode === "invalid-secret")
          assert(result.error === "CHALLENGE_CONFIG");
        if (mode === "non-2xx-success")
          assert(result.error === "CHALLENGE_UNAVAILABLE");
        assert(
          calls.filter((name) => name === "demo_create_order").length ===
            (mode === "valid" ? 1 : 0),
        );
        assert(events.length === 1);
        const log = JSON.stringify(events);
        assert(
          ![secret, token, id, "a".repeat(64)].some((value) =>
            log.includes(value),
          ),
        );
      } finally {
        await server.shutdown();
      }
    },
  );
}
