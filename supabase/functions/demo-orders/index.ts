import { createRpc } from "./rpc.ts";
import { writeDiagnostic } from "./diagnostics.ts";
import { makeHandler } from "./handler.ts";
// Deno Edge runtime only. No administrative credential is imported into src/.
const env = (name: string) => Deno.env.get(name) ?? "";
const url = env("SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");
const handler = makeHandler(
  {
    origin: env("DEMO_ALLOWED_ORIGIN"),
    challengeSecret: env("TURNSTILE_SECRET_KEY"),
    challengeHostname: env("DEMO_CHALLENGE_HOSTNAME"),
    actorSecret: env("DEMO_ACTOR_SECRET"),
  },
  createRpc(url, key),
  fetch,
  writeDiagnostic,
);
Deno.serve(handler);
