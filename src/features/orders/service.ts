import { normalizeNotificationEmail } from "./notificationEmail";
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
  email_requested?: boolean;
};
export type Attempt = {
  key: string;
  capability: string;
  payload: OrderPayload;
};
export type OrderService = {
  enabled: boolean;
  siteKey: string;
  notificationsEnabled?: boolean;
  confirm(
    a: Attempt,
    challenge: string,
    notificationEmail?: string,
  ): Promise<Receipt>;
  recover(a: Attempt): Promise<Receipt | null>;
};
export class OrderRequestError extends Error {
  constructor(
    code: string,
    public readonly kind:
      "http" | "network" | "timeout" | "protocol" | "configuration",
    public readonly status?: number,
  ) {
    super(code);
    this.name = "OrderRequestError";
  }
}
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
    (r.email_requested !== undefined &&
      typeof r.email_requested !== "boolean") ||
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
    throw new OrderRequestError("INVALID_RESPONSE", "protocol");
  return {
    reference: r.reference,
    status: r.status,
    subtotal_cents: r.subtotal_cents,
    created_at: r.created_at,
    expires_at: r.expires_at,
    demo: true,
    ...(r.email_requested !== undefined
      ? { email_requested: r.email_requested }
      : {}),
  };
}
export const orderMessages: Record<string, string> = {
  INVALID_EMAIL:
    "Ingresá un correo válido para las notificaciones de prueba, sin espacios ni caracteres especiales en el dominio.",
  EMAIL_DISABLED:
    "Los correos de prueba no están habilitados en el servidor. No se creó otro pedido. Consultá el mismo intento antes de reintentar.",
  EMAIL_NOT_CONFIGURED:
    "No pudimos preparar las notificaciones de prueba. Conservamos el mismo intento; consultá el resultado antes de reintentar.",
  EMAIL_RECIPIENT_UNAVAILABLE:
    "Ese correo no está habilitado para recibir notificaciones de esta demostración. Usá una dirección de prueba autorizada por el propietario.",
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
  CHALLENGE_REQUIRED:
    "Completá la verificación de seguridad antes de confirmar.",
  CHALLENGE_EXPIRED:
    "La verificación venció o ya fue utilizada. Completá una nueva y reintentá el mismo pedido.",
  CHALLENGE_REJECTED:
    "Turnstile rechazó la verificación. Completá una nueva y reintentá.",
  CHALLENGE_CONTEXT:
    "La verificación no corresponde al sitio o a la acción esperada. Revisá el dominio y la configuración de Turnstile.",
  CHALLENGE_CONFIG:
    "El servidor no pudo validar la configuración de Turnstile. Revisá las claves del widget en el entorno correspondiente.",
  CHALLENGE_UNAVAILABLE:
    "El servidor no pudo contactar o validar la respuesta de Turnstile. Reintentá con una nueva verificación.",
  FORBIDDEN:
    "El servidor rechazó el origen de esta solicitud. Revisá la URL local y el origen permitido.",
  NOT_CONFIGURED: "El servicio de pedidos no está configurado correctamente.",
  RECOVERY_UNSUPPORTED:
    "El servicio no admite esta consulta de recuperación. Actualizá la Edge Function antes de repetir la prueba; conservamos el mismo intento.",
  HTTP_REJECTED:
    "El servidor rechazó la solicitud. El carrito permanece intacto; consultá el mismo intento antes de repetir la confirmación.",
  NETWORK_ERROR:
    "No pudimos conectar con el servidor. El carrito permanece intacto. Consultá el resultado del mismo intento al recuperar la conexión.",
  TIMEOUT_ERROR:
    "La solicitud agotó el tiempo de espera. El resultado es incierto y el carrito permanece intacto. Consultá el mismo intento.",
  INVALID_RESPONSE:
    "El servidor devolvió una respuesta no válida. El carrito permanece intacto. Consultá el mismo intento.",
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
/** Only safe codes and HTTP status escape the transport; never response bodies or fetch errors. */
export async function requestOrder(
  url: string,
  key: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(`${url}/functions/v1/demo-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    const timeout =
      (e instanceof Error || e instanceof DOMException) &&
      ["TimeoutError", "AbortError"].includes(e.name);
    throw new OrderRequestError(
      timeout ? "TIMEOUT_ERROR" : "NETWORK_ERROR",
      timeout ? "timeout" : "network",
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new OrderRequestError(
      response.ok ? "INVALID_RESPONSE" : "HTTP_REJECTED",
      response.ok ? "protocol" : "http",
      response.status,
    );
  }
  if (!response.ok) {
    const code =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof data.error === "string" &&
      Object.hasOwn(orderMessages, data.error)
        ? data.error
        : "HTTP_REJECTED";
    throw new OrderRequestError(
      body.action === "recover" &&
        response.status === 400 &&
        code === "INVALID_REQUEST"
        ? "RECOVERY_UNSUPPORTED"
        : code,
      "http",
      response.status,
    );
  }
  return data;
}
function configured() {
  if (!orderService.enabled || !config)
    throw new OrderRequestError("NOT_CONFIGURED", "configuration");
  return config;
}
export const orderService: OrderService = {
  enabled:
    import.meta.env.VITE_DEMO_ORDERS_ENABLED === "true" &&
    Boolean(config) &&
    Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY),
  siteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "",
  notificationsEnabled:
    import.meta.env.VITE_DEMO_EMAIL_ENABLED === "true" &&
    import.meta.env.VITE_DEMO_ORDERS_ENABLED === "true" &&
    Boolean(config) &&
    Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY),
  async confirm(a, challenge, notificationEmail) {
    const c = configured();
    return receipt(
      await requestOrder(c.url, c.key, {
        action: "create",
        idempotency_key: a.key,
        capability: a.capability,
        payload: a.payload,
        challenge,
        ...(notificationEmail !== undefined && orderService.notificationsEnabled
          ? {
              notification_email: normalizeNotificationEmail(notificationEmail),
            }
          : {}),
      }),
    );
  },
  async recover(a) {
    const c = configured();
    const data = await requestOrder(c.url, c.key, {
      action: "recover",
      idempotency_key: a.key,
      capability: a.capability,
      payload: a.payload,
    });
    if (
      data &&
      typeof data === "object" &&
      "found" in data &&
      data.found === false &&
      Object.keys(data).length === 1
    )
      return null;
    return receipt(data);
  },
};
