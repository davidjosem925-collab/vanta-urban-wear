import { readPublicSupabaseConfig } from "../../lib/supabase/config";
import { readAttempt, type Attempt } from "../orders/service";

export type PaymentStatus =
  "pending" | "approved" | "rejected" | "cancelled" | "expired" | "refunded";
export type PaymentView = {
  reference: string;
  order_status:
    | "pending"
    | "confirmed"
    | "preparing"
    | "delivered"
    | "cancelled"
    | "expired";
  payment_status: PaymentStatus;
  reconciliation: "unlinked" | "awaiting" | "settled" | "review" | "closed";
  amount_cents: number;
  currency: "ARS";
  expires_at: string;
  checkout_url: string | null;
  demo: true;
};
export type PaymentSession = {
  version: 1;
  reference: string;
  attempt: Attempt;
};
export type PaymentService = {
  enabled: boolean;
  request(
    session: PaymentSession,
    action: "create" | "recover",
  ): Promise<PaymentView | null>;
};
export const paymentStorageKey = "vanta.payment-session.v1";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function readPaymentSession(raw: string | null): PaymentSession | null {
  if (raw === null) return null;
  try {
    if (raw.length > 12288) throw Error();
    const v = JSON.parse(raw);
    const attempt = readAttempt(JSON.stringify(v.attempt));
    if (
      Object.keys(v).sort().join(",") !== "attempt,reference,version" ||
      v.version !== 1 ||
      !uuid.test(v.reference) ||
      !attempt ||
      !["mercado_pago", "transfer"].includes(attempt.payload.payment)
    )
      throw Error();
    return { version: 1, reference: v.reference, attempt };
  } catch {
    throw new Error("STORAGE");
  }
}
/** Exact provider URL only. Never follow a return URL, query parameter or stored checkout URL. */
export function checkoutUrl(raw: unknown): string {
  if (
    typeof raw !== "string" ||
    !/^https:\/\/www\.mercadopago\.com\.ar\/checkout\/v1\/redirect\?order_id=ORDTST[A-Z0-9]{10,80}$/.test(
      raw,
    )
  )
    throw new Error("INVALID_RESPONSE");
  return raw;
}
export function paymentView(raw: unknown, reference: string): PaymentView {
  const p = raw as PaymentView;
  if (
    !p ||
    p.demo !== true ||
    p.reference !== reference ||
    !uuid.test(p.reference) ||
    p.currency !== "ARS" ||
    !Number.isSafeInteger(p.amount_cents) ||
    p.amount_cents <= 0 ||
    p.amount_cents > 100000000000 ||
    ![
      "pending",
      "confirmed",
      "preparing",
      "delivered",
      "cancelled",
      "expired",
    ].includes(p.order_status) ||
    ![
      "pending",
      "approved",
      "rejected",
      "cancelled",
      "expired",
      "refunded",
    ].includes(p.payment_status) ||
    !["unlinked", "awaiting", "settled", "review", "closed"].includes(
      p.reconciliation,
    ) ||
    typeof p.expires_at !== "string" ||
    !Number.isFinite(Date.parse(p.expires_at)) ||
    (p.checkout_url !== null && typeof p.checkout_url !== "string")
  )
    throw new Error("INVALID_RESPONSE");
  return {
    reference: p.reference,
    order_status: p.order_status,
    payment_status: p.payment_status,
    reconciliation: p.reconciliation,
    amount_cents: p.amount_cents,
    currency: "ARS",
    expires_at: p.expires_at,
    checkout_url: p.checkout_url === null ? null : checkoutUrl(p.checkout_url),
    demo: true,
  };
}
export const paymentMessages: Record<string, string> = {
  STORAGE:
    "No pudimos conservar el acceso privado al pedido. Habilitá el almacenamiento de sesión y volvé a consultar el intento original. No crees otro pedido.",
  NOT_CONFIGURED:
    "Los pagos de prueba todavía no están habilitados. Tu pedido conserva su reserva original.",
  DISABLED:
    "La creación de pagos de prueba está deshabilitada. Podés consultar una operación existente.",
  FORBIDDEN:
    "No pudimos autorizar esta consulta. Volvé a la pestaña donde creaste el pedido.",
  ORDER_UNAVAILABLE:
    "No pudimos recuperar este pedido. No se creó otro pedido ni una nueva reserva.",
  RATE_LIMITED:
    "Alcanzaste el límite de consultas. Esperá antes de volver a consultar; no crees otro pedido.",
  NETWORK_ERROR:
    "No pudimos conectar. El resultado es incierto: consultá la misma operación antes de reintentar.",
  TIMEOUT:
    "La consulta demoró demasiado. Conservamos el mismo intento; consultá su estado antes de reintentar.",
  INVALID_RESPONSE:
    "No pudimos verificar la respuesta del servidor. No damos el pago por confirmado. Consultá nuevamente la misma operación.",
  UNAVAILABLE:
    "No pudimos verificar el pago. Conservamos el mismo pedido y su reserva original. Consultá el estado antes de continuar.",
};
export async function requestPayment(
  config: { url: string; key: string },
  session: PaymentSession,
  action: "create" | "recover",
  fetcher: typeof fetch = fetch,
): Promise<PaymentView | null> {
  const transfer = session.attempt.payload.payment === "transfer";
  // No prices, contact data, status or items may enter this payload.
  const body = {
    action: transfer ? "transfer" : action,
    reference: session.reference,
    capability: session.attempt.capability,
  };
  let response: Response;
  try {
    response = await fetcher(
      `${config.url}/functions/v1/${transfer ? "demo-orders" : "mp-checkout"}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: config.key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25000),
        redirect: "error",
        credentials: "omit",
      },
    );
  } catch (e) {
    throw new Error(
      (e instanceof Error || e instanceof DOMException) &&
        ["TimeoutError", "AbortError"].includes(e.name)
        ? "TIMEOUT"
        : "NETWORK_ERROR",
    );
  }
  // Bound a potentially invalid upstream response; do not surface raw bodies or messages.
  let data: unknown;
  try {
    const reader = response.body?.getReader();
    if (!reader) throw Error();
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        throw Error();
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(response.ok ? "INVALID_RESPONSE" : "UNAVAILABLE");
  }
  if (!response.ok) {
    const code =
      data && typeof data === "object" && "error" in data ? data.error : null;
    throw new Error(
      typeof code === "string" && Object.hasOwn(paymentMessages, code)
        ? code
        : "UNAVAILABLE",
    );
  }
  if (
    !transfer &&
    action === "recover" &&
    data &&
    typeof data === "object" &&
    Object.keys(data).length === 1 &&
    "found" in data &&
    data.found === false
  )
    return null;
  const p = paymentView(data, session.reference);
  if (transfer && p.checkout_url !== null) throw new Error("INVALID_RESPONSE");
  return p;
}
export function paymentConfiguration(env: Record<string, unknown>) {
  try {
    const config = readPublicSupabaseConfig(env);
    return env.VITE_MP_CHECKOUT_ENABLED === "true" &&
      env.VITE_DEMO_ORDERS_ENABLED === "true" &&
      typeof env.VITE_TURNSTILE_SITE_KEY === "string" &&
      env.VITE_TURNSTILE_SITE_KEY.trim() &&
      config
      ? config
      : null;
  } catch {
    return null;
  }
}
const config = paymentConfiguration(import.meta.env);
export const paymentService: PaymentService = {
  enabled: Boolean(config),
  async request(session, action) {
    if (!config) throw new Error("NOT_CONFIGURED");
    return requestPayment(config, session, action);
  },
};
