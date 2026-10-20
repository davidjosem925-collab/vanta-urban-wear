import { readPublicSupabaseConfig } from "../../lib/supabase/config";
export type OrderPayload = {
  items: {
    variant_id: string;
    quantity: number;
    expected_price_cents: number;
  }[];
  delivery: "shipping" | "pickup";
  payment: "mercado_pago" | "transfer" | "cash";
};
export type Receipt = {
  reference: string;
  status: string;
  subtotal_cents: number;
  created_at: string;
  expires_at: string;
  demo: true;
};
export type Attempt = {
  key: string;
  capability: string;
  payload: OrderPayload;
};
export type OrderService = {
  enabled: boolean;
  siteKey: string;
  confirm(a: Attempt, challenge: string): Promise<Receipt>;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function validPayload(p: unknown): p is OrderPayload {
  if (!p || typeof p !== "object") return false;
  const v = p as OrderPayload;
  if (
    Object.keys(v).sort().join(",") !== "delivery,items,payment" ||
    !["pickup", "shipping"].includes(v.delivery) ||
    !["mercado_pago", "transfer", "cash"].includes(v.payment) ||
    (v.payment === "cash" && v.delivery !== "pickup") ||
    !Array.isArray(v.items) ||
    v.items.length < 1 ||
    v.items.length > 12
  )
    return false;
  const seen = new Set<string>();
  let count = 0;
  for (const i of v.items) {
    if (
      !i ||
      Object.keys(i).sort().join(",") !==
        "expected_price_cents,quantity,variant_id" ||
      !uuid.test(i.variant_id) ||
      seen.has(i.variant_id) ||
      !Number.isSafeInteger(i.quantity) ||
      i.quantity < 1 ||
      i.quantity > 3 ||
      !Number.isSafeInteger(i.expected_price_cents) ||
      i.expected_price_cents < 0 ||
      i.expected_price_cents > 100000000000
    )
      return false;
    seen.add(i.variant_id);
    count += i.quantity;
  }
  return count <= 12;
}
export function readAttempt(raw: string | null): Attempt | null {
  try {
    if (!raw || raw.length > 8192) return null;
    const a = JSON.parse(raw);
    return Object.keys(a).sort().join(",") === "capability,key,payload" &&
      uuid.test(a.key) &&
      /^[a-f0-9]{64}$/.test(a.capability) &&
      validPayload(a.payload)
      ? a
      : null;
  } catch {
    return null;
  }
}
export function newAttempt(payload: OrderPayload): Attempt {
  return {
    key: crypto.randomUUID(),
    capability: [...crypto.getRandomValues(new Uint8Array(32))]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join(""),
    payload,
  };
}
export function receipt(value: unknown): Receipt {
  const r = value as Receipt;
  if (
    !r ||
    r.demo !== true ||
    !uuid.test(r.reference) ||
    ![
      "pending",
      "confirmed",
      "preparing",
      "delivered",
      "cancelled",
      "expired",
    ].includes(r.status) ||
    !Number.isSafeInteger(r.subtotal_cents) ||
    r.subtotal_cents < 0 ||
    !Number.isFinite(Date.parse(r.created_at)) ||
    Date.parse(r.expires_at) - Date.parse(r.created_at) !== 3600000
  )
    throw new Error("UNAVAILABLE");
  return {
    reference: r.reference,
    status: r.status,
    subtotal_cents: r.subtotal_cents,
    created_at: r.created_at,
    expires_at: r.expires_at,
    demo: true,
  };
}
export const orderMessages: Record<string, string> = {
  INSUFFICIENT_STOCK:
    "No hay unidades suficientes para toda la selección. Revisá el carrito.",
  PRICE_CHANGED:
    "Cambió un precio. Revisá los importes actualizados del carrito.",
  PRODUCT_UNAVAILABLE:
    "Una prenda o variante ya no está publicada. Revisá el carrito.",
  INVALID_REQUEST:
    "La demo admite hasta 12 unidades, 12 variantes y 3 unidades por variante. Revisá la selección.",
  IDEMPOTENCY_CONFLICT:
    "No pudimos recuperar este intento. No se confirmó un nuevo pedido.",
  CHALLENGE_REQUIRED: "Completá nuevamente la verificación de seguridad.",
  RATE_LIMITED:
    "Alcanzaste el límite de intentos de la demo. Intentá más tarde.",
  DEMO_CAPACITY: "La demo alcanzó su límite de reservas. Intentá más tarde.",
  UNAVAILABLE:
    "No pudimos confirmar el resultado. El carrito permanece intacto. Reintentá para consultar el mismo intento.",
  EXPIRED:
    "Este intento ya venció o fue cancelado. Revisá el carrito antes de confirmar otro.",
  STORAGE:
    "Para recuperar un intento con seguridad, habilitá el almacenamiento de sesión del navegador.",
};
function configuration() {
  try {
    return readPublicSupabaseConfig(import.meta.env);
  } catch {
    return null;
  }
}
const config = configuration();
export const orderService: OrderService = {
  enabled:
    import.meta.env.VITE_DEMO_ORDERS_ENABLED === "true" &&
    Boolean(config) &&
    Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY),
  siteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "",
  async confirm(a, challenge) {
    if (!this.enabled || !config) throw new Error("UNAVAILABLE");
    const response = await fetch(`${config.url}/functions/v1/demo-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.key },
      body: JSON.stringify({
        action: "create",
        idempotency_key: a.key,
        capability: a.capability,
        payload: a.payload,
        challenge,
      }),
      signal: AbortSignal.timeout(25000),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        Object.hasOwn(orderMessages, data.error) ? data.error : "UNAVAILABLE",
      );
    return receipt(data);
  },
};
