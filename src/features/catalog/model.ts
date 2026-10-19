import type { Variant } from "../../lib/supabase/database.types";
export const menuCategories = [
  {
    name: "Remeras",
    slug: "remeras",
    image: "/images/vanta-categories.png",
    caption: "La base de todos los días.",
  },
  {
    name: "Buzos",
    slug: "buzos",
    image: "/images/vanta-categories.png",
    caption: "Capas con carácter.",
  },
  {
    name: "Pantalones",
    slug: "pantalones",
    image: "/images/vanta-categories.png",
    caption: "Otra forma de moverte.",
  },
  {
    name: "Conjuntos",
    slug: "conjuntos",
    image: "/images/vanta-categories.png",
    caption: "Una misma intención.",
  },
];
export function formatARS(cents: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
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

const SIZE_ORDER = ["S", "M", "L", "XL"];
export function orderedSizes(sizes: string[]) {
  const rank = (size: string) => {
    const index = SIZE_ORDER.indexOf(size);
    return index < 0 ? SIZE_ORDER.length : index;
  };
  return [...new Set(sizes)].sort((a, b) => rank(a) - rank(b));
}
