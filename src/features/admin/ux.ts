import type { AdminImage, AdminVariant, Inventory } from "./model";
import { originalImagePath } from "../catalog/imageProfiles";
export function productSlug(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 140)
    .replace(/-$/, "");
}
export function combinationPlan(
  variants: AdminVariant[],
  color: string,
  sizes: string[],
) {
  const normalize = (s: string) => s.trim().toLocaleLowerCase("es-AR");
  const unique = [
    ...new Map(
      sizes
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => [normalize(s), s]),
    ).values(),
  ];
  return unique.map((size) => ({
    size,
    exists: variants.some(
      (v) =>
        normalize(v.color) === normalize(color) &&
        normalize(v.size) === normalize(size),
    ),
  }));
}
export function stockResult(i: Inventory, action: string, amount: number) {
  if (
    !["add", "remove"].includes(action) ||
    !Number.isInteger(amount) ||
    amount < 1 ||
    amount > 1000
  )
    return null;
  const delta = action === "add" ? amount : -amount,
    physical = i.on_hand + delta;
  return physical >= i.reserved && physical <= 1000000000
    ? { delta, physical, available: physical - i.reserved }
    : null;
}
export const originals = (images: AdminImage[]) =>
  images.filter((i) => !originalImagePath(i.storage_path));
export function readiness(
  images: AdminImage[],
  variants: AdminVariant[],
  inventory: Inventory[],
) {
  return [
    { label: "Fotografías", done: originals(images).length > 0 },
    { label: "Talles y colores", done: variants.some((v) => v.active) },
    {
      label: "Stock disponible",
      done: variants.some(
        (v) =>
          v.active &&
          inventory.some(
            (i) => i.variant_id === v.id && i.on_hand > i.reserved,
          ),
      ),
    },
  ];
}
const labels: Record<string, string> = {
  pending: "Pendiente",
  expired: "Vencido",
  cancelled: "Cancelado",
  confirmed: "Confirmado",
  preparing: "En preparación",
  delivered: "Entregado",
  paid: "Pagado (histórico)",
  fulfilled: "Completado (histórico)",
  refunded: "Reintegrado (histórico)",
  active: "Vigente",
  released: "Liberada",
  consumed: "Utilizada",
  pickup: "Retiro en tienda",
  shipping: "Envío",
  cash: "Efectivo simulado",
  mercado_pago: "Mercado Pago simulado",
  transfer: "Transferencia simulada",
  bank_transfer: "Transferencia simulada",
  reserve: "Reserva",
  release: "Liberación",
  consume: "Salida",
  adjust: "Ajuste",
  initial: "Stock inicial",
};
export const friendly = (value: string) => labels[value] ?? "No informado";
