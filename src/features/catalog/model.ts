import type { Variant } from "../../lib/supabase/database.types";
export const menuCategories = [
  {
    name: "Remeras",
    slug: "remeras",
    number: "01",
    caption: "La base de todos los días.",
  },
  {
    name: "Buzos",
    slug: "buzos",
    number: "02",
    caption: "Capas con carácter.",
  },
  {
    name: "Pantalones",
    slug: "pantalones",
    number: "03",
    caption: "Otra forma de moverte.",
  },
  {
    name: "Conjuntos",
    slug: "conjuntos",
    number: "04",
    caption: "Una misma intención.",
  },
];
export function formatARS(cents: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}
export function selectedVariant(
  variants: Variant[],
  color: string,
  size: string,
) {
  return variants.find((v) => v.active && v.color === color && v.size === size);
}
export function categoryHref(slug: string) {
  return `#/categoria/${encodeURIComponent(slug)}`;
}
export function productHref(slug: string) {
  return `#/producto/${encodeURIComponent(slug)}`;
}
