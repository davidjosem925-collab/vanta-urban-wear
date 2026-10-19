/** Contrato del catálogo basado en las migraciones de etapa 1.
 * No incluye datos privados. Insert/Update never impiden escrituras accidentales
 * desde estos servicios; la seguridad efectiva sigue estando en grants y RLS.
 */
export type Category = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  created_at: string;
};
export type Product = {
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
export type ProductImageRow = {
  id: string;
  product_id: string;
  storage_path: string;
  alt: string;
  position: number;
};
export type Variant = {
  id: string;
  product_id: string;
  sku: string;
  size: string;
  color: string;
  active: boolean;
};
type ReadTable<Row> = {
  Row: Row;
  Insert: never;
  Update: never;
  Relationships: [];
};
export type Database = {
  public: {
    Tables: {
      categories: ReadTable<Category>;
      products: ReadTable<Product>;
      product_images: ReadTable<ProductImageRow>;
      product_variants: ReadTable<Variant>;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
