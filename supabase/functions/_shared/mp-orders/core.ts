/** Server-only protocol primitives. Do not import from src/. */
export type Code =
  | "NOT_CONFIGURED"
  | "DISABLED"
  | "INVALID_REQUEST"
  | "FORBIDDEN"
  | "ORDER_UNAVAILABLE"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_HTTP"
  | "INVALID_PROVIDER_RESPONSE"
  | "TEST_IDENTITY_REQUIRED"
  | "INVALID_SIGNATURE"
  | "RPC_UNAVAILABLE"
  | "PAYMENT_CONFLICT";
export type Dependency =
  | "identity"
  | "create"
  | "get"
  | "search"
  | "cancel"
  | "rpc";
export class PaymentError extends Error {
  constructor(
    readonly code: Code,
    readonly http = 503,
    readonly dependency?: Dependency,
    readonly upstreamStatus?: number,
  ) {
    super(code);
  }
}
export type Settings = {
  enabled: boolean;
  mode: string;
  token: string;
  seller: string;
  application: string;
  webhookSecret: string;
  workerSecret: string;
  origin: string;
  actorSecret: string;
};
export const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const testOrder = /^ORDTST[A-Z0-9]{10,60}$/;
export function validateSettings(c: Settings) {
  // Prefix is syntax, NOT evidence of sandbox: authenticated identity is checked before API use.
  if (
    c.mode !== "test" ||
    !/^(APP_USR|TEST)-[A-Za-z0-9-]{10,250}$/.test(c.token) ||
    !/^[0-9]{1,20}$/.test(c.seller) ||
    !/^[0-9]{1,20}$/.test(c.application) ||
    c.workerSecret.length < 32 ||
    c.webhookSecret.length < 32 ||
    c.actorSecret.length < 32
  )
    throw new PaymentError("NOT_CONFIGURED");
  try {
    const u = new URL(c.origin);
    if (
      u.origin !== c.origin ||
      u.protocol !== "https:" ||
      u.username ||
      u.password
    )
      throw new Error();
  } catch {
    throw new PaymentError("NOT_CONFIGURED");
  }
}
export async function hash(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export async function sameSecret(a: string, b: string) {
  const algorithm = { name: "HMAC", hash: "SHA-256" };
  const actual = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(a || " "),
    algorithm,
    false,
    ["sign"],
  );
  const expected = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(b),
    algorithm,
    false,
    ["verify"],
  );
  const data = new TextEncoder().encode("vanta-worker-auth-v1");
  return crypto.subtle.verify(
    "HMAC",
    expected,
    await crypto.subtle.sign("HMAC", actual, data),
    data,
  );
}
export async function jsonBody(
  response: Response | Request,
  limit = 65536,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new PaymentError("INVALID_REQUEST", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new PaymentError("INVALID_REQUEST", 413);
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof PaymentError) throw e;
    throw new PaymentError("PROVIDER_UNAVAILABLE");
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    throw new PaymentError("INVALID_REQUEST", 400);
  }
}
export function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new PaymentError("INVALID_PROVIDER_RESPONSE");
  return v as Record<string, unknown>;
}
export function identifier(v: unknown) {
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0)
    return String(v);
  if (typeof v === "string" && /^[0-9]{1,20}$/.test(v)) return v;
  throw new PaymentError("INVALID_PROVIDER_RESPONSE");
}
export function cents(value: unknown) {
  if (typeof value !== "string" || !/^\d{1,10}(?:\.\d{1,2})?$/.test(value))
    throw new PaymentError("INVALID_PROVIDER_RESPONSE");
  const [integer, fraction = ""] = value.split(".");
  const n = Number(integer) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n > 200000000000)
    throw new PaymentError("INVALID_PROVIDER_RESPONSE");
  return n;
}
export function checkoutUrl(value: unknown, id: string): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "string" ||
    value !==
      `https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=${id}`
  )
    throw new PaymentError("INVALID_PROVIDER_RESPONSE");
  return value;
}
export type Context = {
  payment_id: string;
  reference: string;
  order_status: string;
  expires_at: string;
  amount_cents: number;
  status: string;
  reconciliation: string;
  provider_order_id: string | null;
  checkout_url: string | null;
  request: Record<string, unknown>;
  idempotency_key: string;
  cancel_key: string;
  attempts: number;
  seller_id: string;
  application_id: string;
};
export function context(raw: unknown): Context {
  const v = record(raw);
  if (
    !uuid.test(String(v.payment_id)) ||
    !uuid.test(String(v.reference)) ||
    !uuid.test(String(v.idempotency_key)) ||
    !uuid.test(String(v.cancel_key)) ||
    typeof v.amount_cents !== "number" ||
    !Number.isSafeInteger(v.amount_cents) ||
    v.amount_cents <= 0 ||
    v.amount_cents > 100000000000 ||
    typeof v.expires_at !== "string" ||
    !Number.isFinite(Date.parse(v.expires_at)) ||
    (v.provider_order_id !== null &&
      !testOrder.test(String(v.provider_order_id)))
  )
    throw new PaymentError("RPC_UNAVAILABLE");
  record(v.request);
  identifier(v.seller_id);
  identifier(v.application_id);
  return v as unknown as Context;
}
export function publicPayment(c: Context) {
  return {
    reference: c.reference,
    order_status: c.order_status,
    payment_status: c.status,
    reconciliation: c.reconciliation,
    amount_cents: c.amount_cents,
    currency: "ARS",
    expires_at: c.expires_at,
    checkout_url:
      c.order_status === "pending" &&
      c.status !== "approved" &&
      c.reconciliation !== "review" &&
      Date.parse(c.expires_at) > Date.now()
        ? c.checkout_url
        : null,
    demo: true,
  };
}
export type Operation = "checkout" | "webhook" | "worker";
export type Diagnostic = {
  event: "mp_test_diagnostic";
  operation: Operation;
  outcome: "ok" | Code;
  http_status: number;
  dependency?: Dependency;
  upstream_status?: number;
};
export type Sink = (entry: Diagnostic) => void;
export type RpcName =
  | "mp_test_settings"
  | "mp_test_prepare"
  | "mp_test_lookup"
  | "mp_test_claim_create"
  | "mp_test_accept_event"
  | "mp_test_claim_event"
  | "mp_test_finish_event"
  | "mp_test_apply"
  | "mp_test_claim_work"
  | "mp_test_unlinked_result"
  | "demo_rate_limit";
export type Rpc = (
  name: RpcName,
  args: Record<string, unknown>,
) => Promise<unknown>;
export function createPaymentRpc(
  url: string,
  key: string,
  fetcher: typeof fetch = fetch,
): Rpc {
  return async (name, args) => {
    let response: Response;
    try {
      response = await fetcher(`${url}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
    } catch {
      throw new PaymentError("RPC_UNAVAILABLE");
    }
    let data: unknown;
    try {
      data = await jsonBody(response);
    } catch {
      throw new PaymentError("RPC_UNAVAILABLE");
    }
    if (!response.ok) {
      const message =
        typeof data === "object" && data !== null
          ? "message" in data
            ? String(data.message)
            : ""
          : "";
      if (message === "ORDER_UNAVAILABLE")
        throw new PaymentError("ORDER_UNAVAILABLE", 404);
      if (message === "PAYMENTS_DISABLED") throw new PaymentError("DISABLED");
      if (message === "PAYMENT_CONFLICT")
        throw new PaymentError("PAYMENT_CONFLICT", 409);
      throw new PaymentError("RPC_UNAVAILABLE");
    }
    return data;
  };
}
