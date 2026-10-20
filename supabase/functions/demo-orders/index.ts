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
  async (name, args) => {
    const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const error = await response.json();
      return {
        data: null,
        error: { message: String(error.message ?? "UNAVAILABLE") },
      };
    }
    return { data: await response.json(), error: null };
  },
);
Deno.serve(handler);
