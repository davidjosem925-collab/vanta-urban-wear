/** Runtime-neutral edge handler. No request/PII logging, no public order-reading endpoint. */
export type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
export type Settings = {
  origin: string;
  challengeSecret: string;
  challengeHostname: string;
  actorSecret: string;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export async function sha(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
function validPayload(p: Record<string, unknown>) {
  if (
    Object.keys(p).sort().join(",") !== "delivery,items,payment" ||
    !["shipping", "pickup"].includes(String(p.delivery)) ||
    !["mercado_pago", "transfer", "cash"].includes(String(p.payment)) ||
    (p.payment === "cash" && p.delivery !== "pickup") ||
    !Array.isArray(p.items) ||
    p.items.length < 1 ||
    p.items.length > 12
  )
    return false;
  let units = 0;
  const seen = new Set();
  for (const raw of p.items) {
    if (!raw || typeof raw !== "object") return false;
    const i = raw as Record<string, unknown>;
    if (
      Object.keys(i).sort().join(",") !==
        "expected_price_cents,quantity,variant_id" ||
      typeof i.variant_id !== "string" ||
      !uuid.test(i.variant_id) ||
      seen.has(i.variant_id) ||
      !Number.isInteger(i.quantity) ||
      Number(i.quantity) < 1 ||
      Number(i.quantity) > 3 ||
      !Number.isSafeInteger(i.expected_price_cents) ||
      Number(i.expected_price_cents) < 0 ||
      Number(i.expected_price_cents) > 100000000000
    )
      return false;
    seen.add(i.variant_id);
    units += Number(i.quantity);
  }
  return units <= 12;
}
export function makeHandler(
  settings: Settings,
  rpc: Rpc,
  fetcher: typeof fetch = fetch,
) {
  return async (request: Request): Promise<Response> => {
    const headers = {
      "Access-Control-Allow-Origin": settings.origin,
      Vary: "Origin",
      "Access-Control-Allow-Headers": "authorization,apikey,content-type",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    };
    const reply = (status: number, code: string, data?: unknown) =>
      new Response(JSON.stringify(data ?? { error: code }), {
        status,
        headers,
      });
    if (
      !settings.origin ||
      !settings.challengeSecret ||
      !settings.challengeHostname ||
      settings.actorSecret.length < 32
    )
      return reply(503, "NOT_CONFIGURED");
    if (request.headers.get("origin") !== settings.origin)
      return reply(403, "FORBIDDEN");
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return reply(405, "METHOD_NOT_ALLOWED");
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return reply(415, "INVALID_REQUEST");
    if (Number(request.headers.get("content-length")) > 8192)
      return reply(413, "REQUEST_TOO_LARGE");
    // Bounded stream read; Content-Length alone is untrusted and may be absent.
    let text = "";
    let size = 0;
    const reader = request.body?.getReader();
    if (!reader) return reply(400, "INVALID_REQUEST");
    try {
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) {
          await reader.cancel();
          return reply(413, "REQUEST_TOO_LARGE");
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      let b;
      try {
        b = JSON.parse(text);
      } catch {
        return reply(400, "INVALID_REQUEST");
      }
      if (
        !b ||
        typeof b !== "object" ||
        !["create", "cancel"].includes(b.action) ||
        typeof b.capability !== "string" ||
        !/^[a-f0-9]{64}$/.test(b.capability)
      )
        return reply(400, "INVALID_REQUEST");
      const owner = await sha(b.capability);
      // Gateway must overwrite/append X-Forwarded-For. Last hop is a rate bucket only,
      // never authorization. Global DB limits and mandatory Turnstile do not rely on it.
      const hop =
        request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
        "unknown";
      const actor = await sha(`${settings.actorSecret}:${hop}`);
      const limit = await rpc("demo_rate_limit", { p_actor: actor });
      if (limit.error) return reply(503, "UNAVAILABLE");
      if (limit.data !== true) return reply(429, "RATE_LIMITED");
      if (b.action === "cancel") {
        if (
          Object.keys(b).sort().join(",") !== "action,capability,reference" ||
          !uuid.test(b.reference)
        )
          return reply(400, "INVALID_REQUEST");
        const result = await rpc("demo_cancel_order", {
          p_reference: b.reference,
          p_owner: owner,
        });
        return result.error
          ? reply(404, "ORDER_UNAVAILABLE")
          : reply(200, "", { cancelled: result.data === true });
      }
      if (
        Object.keys(b).sort().join(",") !==
          "action,capability,challenge,idempotency_key,payload" ||
        !uuid.test(b.idempotency_key) ||
        !b.payload ||
        typeof b.payload !== "object" ||
        !validPayload(b.payload) ||
        typeof b.challenge !== "string" ||
        b.challenge.length > 2048
      )
        return reply(400, "INVALID_REQUEST");
      const args = {
        p_key: b.idempotency_key,
        p_owner: owner,
        p_payload: b.payload,
      };
      const replay = await rpc("demo_order_replay", args);
      if (replay.error)
        return reply(
          409,
          replay.error.message.includes("IDEMPOTENCY_EXPIRED")
            ? "EXPIRED"
            : "IDEMPOTENCY_CONFLICT",
        );
      if (replay.data) return reply(200, "", replay.data);
      const challengeResponse = await fetcher(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          body: new URLSearchParams({
            secret: settings.challengeSecret,
            response: b.challenge,
          }),
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!challengeResponse.ok) return reply(503, "UNAVAILABLE");
      const challenge = await challengeResponse.json();
      if (
        challenge.success !== true ||
        challenge.hostname !== settings.challengeHostname ||
        challenge.action !== "demo-order"
      )
        return reply(403, "CHALLENGE_REQUIRED");
      const admission = await rpc("demo_admit_creation", {});
      if (admission.error) return reply(503, "UNAVAILABLE");
      if (admission.data !== true) return reply(429, "RATE_LIMITED");
      const result = await rpc("demo_create_order", args);
      if (result.error) {
        const code = [
          "INSUFFICIENT_STOCK",
          "PRODUCT_UNAVAILABLE",
          "PRICE_CHANGED",
          "IDEMPOTENCY_CONFLICT",
          "DEMO_CAPACITY",
          "INVALID_REQUEST",
        ].find((c) => result.error!.message.includes(c));
        return reply(
          code === "INVALID_REQUEST" ? 400 : code ? 409 : 503,
          code ?? "UNAVAILABLE",
        );
      }
      return reply(200, "", result.data);
    } catch {
      return reply(503, "UNAVAILABLE");
    }
  };
}
