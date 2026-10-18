import type { Category } from "../lib/supabase/database.types";
import type {
  CatalogProduct,
  CatalogService,
} from "../features/catalog/service";
export const categories: Category[] = [
  {
    id: "cat-tee",
    name: "Remeras",
    slug: "remeras",
    active: true,
    created_at: "2026-01-01",
  },
  {
    id: "cat-hoodie",
    name: "Buzos",
    slug: "buzos",
    active: true,
    created_at: "2026-01-01",
  },
];
export const product: CatalogProduct = {
  id: "product-1",
  category_id: "cat-tee",
  name: "Remera Essential",
  slug: "remera-essential",
  description: "Algodón de silueta amplia.",
  price_cents: 2500050,
  currency: "ARS",
  active: true,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  images: [
    {
      id: "image-1",
      product_id: "product-1",
      storage_path: "essential/front.webp",
      alt: "Essential vista frontal",
      position: 0,
      url: "https://example.com/front.webp",
    },
    {
      id: "image-2",
      product_id: "product-1",
      storage_path: "essential/back.webp",
      alt: "Essential vista posterior",
      position: 1,
      url: "https://example.com/back.webp",
    },
  ],
  variants: [
    {
      id: "variant-1",
      product_id: "product-1",
      sku: "ESS-BLK-M",
      size: "M",
      color: "Negro",
      active: true,
    },
    {
      id: "variant-2",
      product_id: "product-1",
      sku: "ESS-GRY-L",
      size: "L",
      color: "Grafito",
      active: true,
    },
  ],
};
export function fixtureService(
  overrides: Partial<CatalogService> = {},
): CatalogService {
  return {
    categories: async () => categories,
    products: async () => ({ products: [product], hasMore: false }),
    product: async () => product,
    imageUrl: async () => null,
    ...overrides,
  };
}
