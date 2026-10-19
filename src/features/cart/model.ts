import type { CatalogProduct, CatalogService } from "../catalog/service";
import type { Variant } from "../../lib/supabase/database.types";

export const STORAGE_KEY = "vanta.cart.v1";
export const MAX_QUANTITY = 10;
export const MAX_LINES = 30;
const CATALOG_TIMEOUT_MS = 15_000;
export type CartLine = {
  slug: string;
  productId: string;
  variantId: string;
  quantity: number;
};
export type CartEntry = {
  line: CartLine;
  status: "loading" | "ready" | "unavailable" | "error";
  product?: CatalogProduct;
  variant?: Variant;
};
const identifier = /^[a-zA-Z0-9-]{1,100}$/;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function validQuantity(value: number) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_QUANTITY;
}
function validLine(value: unknown): value is CartLine {
  if (!value || typeof value !== "object") return false;
  const v = value as CartLine;
  return (
    typeof v.slug === "string" &&
    v.slug.length <= 200 &&
    slugPattern.test(v.slug) &&
    typeof v.productId === "string" &&
    identifier.test(v.productId) &&
    typeof v.variantId === "string" &&
    identifier.test(v.variantId) &&
    validQuantity(v.quantity)
  );
}
export function readCart(raw: string | null): {
  lines: CartLine[];
  warning: string;
} {
  if (!raw) return { lines: [], warning: "" };
  const warning =
    "Revisamos los datos guardados y descartamos información inválida o desactualizada.";
  try {
    if (raw.length > 30_000) throw new Error("too large");
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !Array.isArray(data.lines))
      throw new Error("schema");
    let changed = false;
    const lines: CartLine[] = [];
    for (const value of data.lines) {
      if (!validLine(value)) {
        changed = true;
        continue;
      }
      // Deliberately copy only identifiers and quantity. Stored prices, URLs and stock are never read.
      const line = {
        slug: value.slug,
        productId: value.productId,
        variantId: value.variantId,
        quantity: value.quantity,
      };
      const duplicate = lines.find((l) => l.variantId === line.variantId);
      if (duplicate) {
        changed = true;
        if (
          duplicate.productId === line.productId &&
          duplicate.slug === line.slug
        )
          duplicate.quantity = Math.min(
            MAX_QUANTITY,
            duplicate.quantity + line.quantity,
          );
      } else if (lines.length < MAX_LINES) lines.push(line);
      else changed = true;
    }
    return { lines, warning: changed ? warning : "" };
  } catch {
    return { lines: [], warning };
  }
}
export function writeCart(lines: CartLine[]) {
  return JSON.stringify({
    version: 1,
    lines: lines.map(({ slug, productId, variantId, quantity }) => ({
      slug,
      productId,
      variantId,
      quantity,
    })),
  });
}
export function validProduct(
  product: CatalogProduct,
  slug: string,
  productId: string,
) {
  return (
    product.active &&
    product.slug === slug &&
    product.id === productId &&
    identifier.test(product.id) &&
    slugPattern.test(product.slug) &&
    product.slug.length <= 200 &&
    typeof product.name === "string" &&
    product.name.trim().length > 0 &&
    product.currency === "ARS" &&
    Number.isSafeInteger(product.price_cents) &&
    product.price_cents >= 0 &&
    product.price_cents <= 100_000_000_000
  );
}
export function selection(
  product: CatalogProduct,
  color: string,
  size: string,
  quantity: number,
): CartLine {
  if (!color || !size)
    throw new Error("Seleccioná talle y color antes de agregar la prenda.");
  if (!validQuantity(quantity))
    throw new Error(`Elegí una cantidad entera entre 1 y ${MAX_QUANTITY}.`);
  if (!validProduct(product, product.slug, product.id))
    throw new Error("No pudimos verificar el precio de esta prenda.");
  const variant = product.variants.find(
    (v) =>
      v.active &&
      v.product_id === product.id &&
      v.color === color &&
      v.size === size &&
      identifier.test(v.id),
  );
  if (!variant)
    throw new Error(
      "Esta combinación ya no está publicada. Elegí otra opción.",
    );
  return {
    slug: product.slug,
    productId: product.id,
    variantId: variant.id,
    quantity,
  };
}
export function addLine(lines: CartLine[], line: CartLine) {
  if (!validLine(line))
    throw new Error("Los datos de la prenda no son válidos.");
  const existing = lines.find((l) => l.variantId === line.variantId);
  if (existing) {
    if (existing.productId !== line.productId || existing.slug !== line.slug)
      throw new Error("La variante no corresponde a esta prenda.");
    if (existing.quantity + line.quantity > MAX_QUANTITY)
      throw new Error(
        `El límite del carrito es ${MAX_QUANTITY} unidades por variante; no indica stock disponible.`,
      );
    return lines.map((l) =>
      l === existing ? { ...l, quantity: l.quantity + line.quantity } : l,
    );
  }
  if (lines.length >= MAX_LINES)
    throw new Error(
      `El carrito admite hasta ${MAX_LINES} variantes diferentes.`,
    );
  return [...lines, line];
}
export function changeQuantity(
  lines: CartLine[],
  id: string,
  quantity: number,
) {
  if (!validQuantity(quantity))
    throw new Error(`Elegí una cantidad entera entre 1 y ${MAX_QUANTITY}.`);
  return lines.map((line) =>
    line.variantId === id ? { ...line, quantity } : line,
  );
}
export function removeLine(lines: CartLine[], id: string) {
  return lines.filter((line) => line.variantId !== id);
}
export function loadCartProduct(
  service: CatalogService,
  slug: string,
  signal?: AbortSignal,
): Promise<CatalogProduct | null> {
  const timeout = AbortSignal.timeout(CATALOG_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  // Bound the whole operation, including image signing (which may outlive the REST request).
  return new Promise((resolve, reject) => {
    const abort = () => {
      combined.removeEventListener("abort", abort);
      reject(new Error("No pudimos verificar el catálogo a tiempo."));
    };
    if (combined.aborted) {
      abort();
      return;
    }
    combined.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => service.product(slug, combined))
      .then(
        (value) => {
          combined.removeEventListener("abort", abort);
          resolve(value);
        },
        (error: unknown) => {
          combined.removeEventListener("abort", abort);
          reject(error);
        },
      );
  });
}
export async function resolveCart(
  lines: CartLine[],
  service: CatalogService,
  signal: AbortSignal,
): Promise<CartEntry[]> {
  const results = new Map<string, CatalogProduct | null | "error">();
  await Promise.all(
    [...new Set(lines.map((l) => l.slug))].map(async (slug) => {
      try {
        results.set(slug, await loadCartProduct(service, slug, signal));
      } catch {
        results.set(slug, "error");
      }
    }),
  );
  return lines.map((line) => {
    const product = results.get(line.slug);
    if (product === "error") return { line, status: "error" };
    if (!product || !validProduct(product, line.slug, line.productId))
      return { line, status: "unavailable" };
    const variant = product.variants.find(
      (v) =>
        v.id === line.variantId &&
        v.product_id === product.id &&
        v.active &&
        v.color?.trim() &&
        v.size?.trim(),
    );
    return variant
      ? { line, status: "ready", product, variant }
      : { line, status: "unavailable", product };
  });
}
export function cartTotals(entries: CartEntry[]) {
  const units = entries.reduce((n, e) => n + e.line.quantity, 0);
  if (entries.some((e) => e.status !== "ready" || !e.product))
    return { units, total: null };
  const total = entries.reduce(
    (n, e) => n + e.product!.price_cents * e.line.quantity,
    0,
  );
  return { units, total: Number.isSafeInteger(total) ? total : null };
}
