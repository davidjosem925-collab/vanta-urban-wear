export type AdminProduct = {
  id: string;
  category_id: string;
  name: string;
  slug: string;
  description: string;
  price_cents: number;
  currency: "ARS";
  active: boolean;
  created_at: string;
  updated_at: string;
};
export type AdminVariant = {
  id: string;
  product_id: string;
  sku: string;
  size: string;
  color: string;
  active: boolean;
};
export type AdminImage = {
  id: string;
  product_id: string;
  storage_path: string;
  alt: string;
  position: number;
};
export type Inventory = {
  variant_id: string;
  on_hand: number;
  reserved: number;
};
export type Movement = {
  id: string;
  variant_id: string;
  kind: string;
  quantity: number;
  reason: string | null;
  created_at: string;
  idempotency_key: string | null;
};
export type DemoOrder = {
  id: string;
  public_reference: string;
  status: string;
  created_at: string;
  reservation_expires_at: string;
  reservation_resolved_at: string | null;
  subtotal_cents: number;
  delivery: string;
  demo_payment: string;
};
export type OrderItem = {
  id: string;
  product_name: string;
  sku: string;
  size: string;
  color: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
};
export type Reservation = {
  id: string;
  variant_id: string;
  quantity: number;
  status: string;
  expires_at: string;
};
export function priceCents(value: string) {
  if (!/^\d{1,10}([.,]\d{1,2})?$/.test(value))
    throw new Error(
      "Ingresá un precio en ARS, sin separadores de miles y con hasta dos decimales.",
    );
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n > 100000000000)
    throw new Error("Precio fuera de rango.");
  return n;
}
export const money = (n: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: n % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(n / 100);
export const date = (s: string) =>
  new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(s));
export type Adjustment = {
  key: string;
  variant: string;
  delta: number;
  reason: string;
};
export function readAdjustment(raw: string | null): Adjustment | null {
  try {
    const a = JSON.parse(raw ?? "null");
    if (
      a &&
      typeof a === "object" &&
      !Array.isArray(a) &&
      Object.keys(a).sort().join(",") === "delta,key,reason,variant" &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        a.key,
      ) &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        a.variant,
      ) &&
      Number.isInteger(a.delta) &&
      a.delta !== 0 &&
      Math.abs(a.delta) <= 1000 &&
      typeof a.reason === "string" &&
      a.reason.trim().length >= 3 &&
      a.reason.length <= 100
    )
      return a;
  } catch {
    /* untrusted tab storage */
  }
  return null;
}
