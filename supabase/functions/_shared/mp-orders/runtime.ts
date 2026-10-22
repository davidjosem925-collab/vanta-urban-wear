import type { Settings, Operation } from "./core.ts";
import { createPaymentRpc } from "./core.ts";
import { makePaymentHandler } from "./handlers.ts";
export function servePayments(operation: Operation) {
  const env = (name: string) => Deno.env.get(name) ?? "";
  const settings: Settings = {
    enabled: env("MP_CHECKOUT_ENABLED") === "true",
    mode: env("MP_MODE"),
    token: env("MP_ACCESS_TOKEN"),
    seller: env("MP_TEST_SELLER_ID"),
    application: env("MP_APPLICATION_ID"),
    webhookSecret: env("MP_WEBHOOK_SECRET"),
    workerSecret: env("MP_WORKER_SECRET"),
    origin: env("MP_ALLOWED_ORIGIN"),
    actorSecret: env("DEMO_ACTOR_SECRET"),
  };
  Deno.serve(
    makePaymentHandler(
      operation,
      settings,
      createPaymentRpc(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY")),
      fetch,
      (e) => console.info(JSON.stringify(e)),
    ),
  );
}
