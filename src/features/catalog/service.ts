import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Category,
  Database,
  Product,
  ProductImageRow,
  Variant,
} from "../../lib/supabase/database.types";
import {
  supabase,
  supabaseConfigurationError,
} from "../../lib/supabase/client";

export type CatalogImage = ProductImageRow & { url: string | null };
export type CatalogProduct = Product & {
  images: CatalogImage[];
  variants: Variant[];
};
export type ProductPage = { products: CatalogProduct[]; hasMore: boolean };
export type CatalogService = {
  categories(signal?: AbortSignal): Promise<Category[]>;
  products(
    categoryId: string | undefined,
    page: number,
    signal?: AbortSignal,
  ): Promise<ProductPage>;
  product(slug: string, signal?: AbortSignal): Promise<CatalogProduct | null>;
  imageUrl(path: string): Promise<string | null>;
};
export const PAGE_SIZE = 12;
const IMAGE_LIFETIME_SECONDS = 900;

export function createCatalogService(
  client: SupabaseClient<Database> | null,
): CatalogService {
  function connected() {
    if (!client)
      throw new Error(supabaseConfigurationError ?? "Catálogo sin conexión.");
    return client;
  }
  async function imageUrl(path: string) {
    // Private bucket: signed URL, never getPublicUrl. No file uploads/DB writes.
    const { data, error } = await connected()
      .storage.from("product-images")
      .createSignedUrl(path, IMAGE_LIFETIME_SECONDS);
    return error ? null : data.signedUrl;
  }
  async function hydrate(
    products: Product[],
    signal?: AbortSignal,
  ): Promise<CatalogProduct[]> {
    if (!products.length) return [];
    const ids = products.map((p) => p.id);
    let imagesQuery = connected()
      .from("product_images")
      .select("*")
      .in("product_id", ids)
      .order("position");
    let variantsQuery = connected()
      .from("product_variants")
      .select("*")
      .eq("active", true)
      .in("product_id", ids)
      .order("size");
    if (signal) {
      imagesQuery = imagesQuery.abortSignal(signal);
      variantsQuery = variantsQuery.abortSignal(signal);
    }
    const [images, variants] = await Promise.all([imagesQuery, variantsQuery]);
    if (images.error || variants.error)
      throw new Error("No pudimos cargar la información de los productos.");
    const rows = images.data ?? [];
    const paths = rows.map((i) => i.storage_path);
    const signed = paths.length
      ? await connected()
          .storage.from("product-images")
          .createSignedUrls(paths, IMAGE_LIFETIME_SECONDS)
      : null;
    const urls = new Map(signed?.data?.map((i) => [i.path, i.signedUrl]));
    return products.map((product) => {
      if (
        !Number.isSafeInteger(product.price_cents) ||
        product.price_cents < 0 ||
        product.currency !== "ARS"
      )
        throw new Error("El catálogo contiene un precio inválido.");
      return {
        ...product,
        images: rows
          .filter((i) => i.product_id === product.id)
          .map((i) => ({ ...i, url: urls.get(i.storage_path) || null })),
        variants: (variants.data ?? []).filter(
          (v) => v.product_id === product.id,
        ),
      };
    });
  }
  return {
    async categories(signal) {
      let query = connected()
        .from("categories")
        .select("*")
        .eq("active", true)
        .order("name");
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query;
      if (error) throw new Error("No pudimos cargar las categorías.");
      return data ?? [];
    },
    async products(categoryId, page, signal) {
      if (!Number.isInteger(page) || page < 0)
        throw new Error("Página inválida.");
      let query = connected()
        .from("products")
        .select("*")
        .eq("active", true)
        .order("created_at", { ascending: false })
        .order("id")
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      if (categoryId) query = query.eq("category_id", categoryId);
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query;
      if (error)
        throw new Error("No pudimos cargar la colección. Intentá nuevamente.");
      return {
        products: await hydrate((data ?? []).slice(0, PAGE_SIZE), signal),
        hasMore: (data?.length ?? 0) > PAGE_SIZE,
      };
    },
    async product(slug, signal) {
      let query = connected()
        .from("products")
        .select("*")
        .eq("active", true)
        .eq("slug", slug);
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query.maybeSingle();
      if (error) throw new Error("No pudimos cargar este producto.");
      return data ? (await hydrate([data], signal))[0] : null;
    },
    imageUrl,
  };
}
export const catalogService = createCatalogService(supabase);
