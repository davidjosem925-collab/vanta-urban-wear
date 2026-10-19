import { createContext, useContext } from "react";
import type { CatalogProduct, CatalogService } from "../catalog/service";
import type { CartEntry } from "./model";
import type { Variant } from "../../lib/supabase/database.types";

export type CartNotice = {
  id: number;
  product: CatalogProduct;
  variant: Variant;
  quantity: number;
};

export type CartContextValue = {
  entries: CartEntry[];
  units: number;
  total: number | null;
  warning: string;
  open: boolean;
  adding: boolean;
  notice: CartNotice | null;
  dismissNotice(): void;
  service: CatalogService;
  openCart(): void;
  closeCart(): void;
  refresh(): void;
  add(
    product: CatalogProduct,
    color: string,
    size: string,
    quantity: number,
  ): Promise<void>;
  setQuantity(id: string, quantity: number): void;
  remove(id: string): void;
  clear(): void;
};
export const CartContext = createContext<CartContextValue | null>(null);
export function useCart() {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("CartProvider requerido");
  return cart;
}
