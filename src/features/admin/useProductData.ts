import { useCallback, useEffect, useRef, useState } from "react";
import { connected, rows, rpc } from "./client";
import type { AdminImage, AdminVariant, Inventory, Movement } from "./model";
import { imagePreviews } from "./previews";
export type ProductData = {
  categories: { id: string; name: string }[];
  variants: AdminVariant[];
  images: AdminImage[];
  inventory: Inventory[];
  movements: Movement[];
  previews: Record<string, string>;
};
const empty: ProductData = {
  categories: [],
  variants: [],
  images: [],
  inventory: [],
  movements: [],
  previews: {},
};
export function useProductData(
  id: string | undefined,
  onUnauthorized: () => void,
  revision: number,
) {
  const [data, setData] = useState(empty),
    [loading, setLoading] = useState(true),
    [ready, setReady] = useState(false),
    [readError, setReadError] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setReadError("");
    try {
      if (!(await rpc<boolean>("is_admin", {}))) {
        onUnauthorized();
        return false;
      }
      const c = connected();
      const categories = await rows<ProductData["categories"]>(
        c.from("categories").select("id,name").order("name"),
      );
      let next: ProductData = { ...empty, categories };
      if (id) {
        const [variants, images] = await Promise.all([
          rows<AdminVariant[]>(
            c
              .from("product_variants")
              .select("*")
              .eq("product_id", id)
              .order("sku"),
          ),
          rows<AdminImage[]>(
            c
              .from("product_images")
              .select("*")
              .eq("product_id", id)
              .order("position"),
          ),
        ]);
        const ids = variants.map((v) => v.id);
        const [inventory, movements] = ids.length
          ? await Promise.all([
              rows<Inventory[]>(
                c
                  .from("inventory")
                  .select("variant_id,on_hand,reserved")
                  .in("variant_id", ids),
              ),
              rows<Movement[]>(
                c
                  .from("inventory_movements")
                  .select(
                    "id,variant_id,kind,quantity,reason,created_at,idempotency_key",
                  )
                  .in("variant_id", ids)
                  .order("created_at", { ascending: false })
                  .limit(30),
              ),
            ])
          : [[], []];
        let previews: Record<string, string> = {};
        try {
          previews = await imagePreviews(images);
        } catch {
          if (request === generation.current)
            setReadError(
              "No se pudieron cargar las fotografías. Podés renovar las vistas previas sin repetir el guardado.",
            );
        }
        next = { categories, variants, images, inventory, movements, previews };
      }
      if (request === generation.current) {
        setData(next);
        setReady(true);
      }
      return true;
    } catch {
      if (request === generation.current)
        setReadError(
          "No se pudieron actualizar los datos. Reintentar consulta no vuelve a guardar tus cambios.",
        );
      return false;
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [id, onUnauthorized]);
  useEffect(() => {
    void refresh();
    const counter = generation;
    return () => {
      counter.current++;
    };
  }, [refresh, revision]);
  return { data, loading, ready, readError, refresh };
}
