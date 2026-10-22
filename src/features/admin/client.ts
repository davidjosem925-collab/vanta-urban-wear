import { createClient } from "@supabase/supabase-js";
import { readPublicSupabaseConfig } from "../../lib/supabase/config";
// Separate namespace preserves the legacy tab session during transition/rollback.
const emailMode = import.meta.env.VITE_ADMIN_EMAIL_ACCESS_ENABLED === "true";
export const ADMIN_AUTH_STORAGE_KEY = emailMode
  ? "vanta.admin.email.auth.v1"
  : "vanta.admin.auth.v1";
export const adminSessionStorage = () =>
  emailMode ? window.localStorage : window.sessionStorage;
// Loaded only inside the admin chunk. Never shares auth storage with the storefront.
function configure() {
  try {
    const c = readPublicSupabaseConfig(import.meta.env);
    return c
      ? createClient(c.url, c.key, {
          auth: {
            storageKey: ADMIN_AUTH_STORAGE_KEY,
            // PKCE verifier is shared. Legacy sessions stay tab-scoped; approved email mode persists separately.
            storage: {
              getItem: (key: string) =>
                (key.endsWith("-code-verifier")
                  ? window.localStorage
                  : adminSessionStorage()
                ).getItem(key),
              setItem: (key: string, value: string) =>
                (key.endsWith("-code-verifier")
                  ? window.localStorage
                  : adminSessionStorage()
                ).setItem(key, value),
              removeItem: (key: string) =>
                (key.endsWith("-code-verifier")
                  ? window.localStorage
                  : adminSessionStorage()
                ).removeItem(key),
            },
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
            flowType: "pkce",
            experimental: { passkey: true, appendPkceFlowIdToRedirects: true },
          },
        })
      : null;
  } catch {
    return null;
  }
}
export const adminClient = configure();
export class AdminError extends Error {
  constructor(
    message: string,
    public kind = "unknown",
  ) {
    super(message);
  }
}
export function safeError(error: unknown): Error {
  const e = error as { code?: string; message?: string };
  if (e?.code === "42501" || e?.message?.includes("FORBIDDEN"))
    return new AdminError("Acceso no autorizado. Volvé a verificar tu acceso.");
  if (e?.message?.includes("PROVIDER_CONFIRMATION_REQUIRED"))
    return new AdminError(
      "Mercado Pago solo puede confirmarse mediante verificación del proveedor.",
    );
  if (e?.message?.includes("PAYMENT_CONFLICT"))
    return new AdminError(
      "El pago no permite esta acción. Actualizá el pedido y revisá su estado.",
    );
  if (e?.message?.includes("IDEMPOTENCY_CONFLICT"))
    return new AdminError(
      "La operación no coincide con el intento guardado. Consultá el pedido antes de continuar.",
    );
  if (e?.message?.includes("INVALID_TRANSITION"))
    return new AdminError(
      "El estado actual no permite ese cambio. Actualizá el pedido.",
    );
  if (e?.code === "23505")
    return new AdminError(
      "Esa dirección, código interno o combinación ya existe. Revisá los datos.",
      "duplicate",
    );
  if (e?.message?.includes("EDIT_CONFLICT"))
    return new AdminError(
      "La información cambió desde que comenzaste a editar. Consultá los datos actuales antes de guardar.",
      "conflict",
    );
  if (e?.message?.includes("INVALID_STOCK_ADJUSTMENT"))
    return new AdminError(
      "El ajuste dejaría stock inferior a lo reservado o fuera de rango.",
    );
  if (
    ["23514", "22P02", "22003"].includes(e?.code ?? "") ||
    (e?.code === "P0001" && e?.message?.includes("INVALID_REQUEST"))
  )
    return new AdminError(
      "Revisá los campos: falta algún dato o está fuera de los límites permitidos.",
      "validation",
    );
  if (e?.code === "23503")
    return new AdminError("La relación seleccionada no está disponible.");
  return new AdminError(
    "No pudimos completar la operación. Conservá el intento y reintentá o recargá los datos.",
  );
}
export function connected() {
  if (!adminClient)
    throw new Error("Falta la configuración pública de Supabase.");
  return adminClient;
}
export async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await connected().rpc(name, args);
  if (error) throw safeError(error);
  return data as T;
}
export async function rows<T>(
  query: PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw safeError(error);
  return data as T;
}
