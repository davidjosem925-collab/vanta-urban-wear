import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CatalogService } from "../catalog/service";
import { CartContext, type CartNotice } from "./context";
import {
  addLine,
  cartTotals,
  changeQuantity,
  loadCartProduct,
  readCart,
  removeLine,
  resolveCart,
  selection,
  STORAGE_KEY,
  writeCart,
  type CartEntry,
  type CartLine,
} from "./model";

const storageWarning =
  "No pudimos guardar el carrito en este navegador. Podés usarlo durante esta visita.";
function initialCart() {
  try {
    return readCart(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { lines: [], warning: storageWarning };
  }
}
export function CartProvider({
  service,
  children,
}: {
  service: CatalogService;
  children: ReactNode;
}) {
  const [initial] = useState(initialCart);
  const [lines, setLines] = useState(initial.lines);
  const linesRef = useRef(lines);
  const [warning, setWarning] = useState(initial.warning);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<CartNotice | null>(null);
  const noticeId = useRef(0);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const addingRef = useRef(false);
  const epoch = useRef(0);
  const mounted = useRef(false);
  const [revision, setRevision] = useState(0);
  const revisionRef = useRef(0);
  const [resolved, setResolved] = useState<{
    lines: CartLine[];
    revision: number;
    service: CatalogService;
    entries: CartEntry[];
  } | null>(null);
  const refresh = useCallback(() => {
    revisionRef.current++;
    setRevision(revisionRef.current);
  }, []);
  const commit = useCallback((next: CartLine[]) => {
    linesRef.current = next;
    setLines(next);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, writeCart(lines));
    } catch {
      setWarning(storageWarning);
    }
  }, [lines]);
  useEffect(() => {
    const controller = new AbortController();
    void resolveCart(lines, service, controller.signal).then((entries) => {
      if (!controller.signal.aborted)
        setResolved({ lines, revision, service, entries });
    });
    return () => controller.abort();
  }, [lines, revision, service]);
  useEffect(() => {
    function storage(event: StorageEvent) {
      if (
        event.storageArea !== localStorage ||
        (event.key !== STORAGE_KEY && event.key !== null)
      )
        return;
      const next = readCart(event.newValue);
      epoch.current++;
      setWarning(next.warning);
      commit(next.lines);
    }
    window.addEventListener("storage", storage);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", storage);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [commit, refresh]);
  const entries: CartEntry[] =
    resolved?.lines === lines &&
    resolved.revision === revision &&
    resolved.service === service
      ? resolved.entries
      : lines.map((line) => {
          // Keep the last public description/photo while refreshing, never its monetary totals.
          const previous =
            resolved?.service === service
              ? resolved.entries.find(
                  (e) =>
                    e.line.variantId === line.variantId &&
                    e.line.productId === line.productId &&
                    e.line.slug === line.slug,
                )
              : undefined;
          return {
            line,
            status: "loading",
            product: previous?.product,
            variant: previous?.variant,
          };
        });
  const { units, total } = cartTotals(entries);
  return (
    <CartContext.Provider
      value={{
        entries,
        units,
        total,
        warning,
        open,
        adding,
        notice,
        dismissNotice,
        service,
        refresh,
        openCart() {
          dismissNotice();
          refresh();
          setOpen(true);
        },
        closeCart() {
          setOpen(false);
        },
        async add(product, color, size, quantity) {
          dismissNotice();
          selection(product, color, size, quantity);
          if (addingRef.current)
            throw new Error("Esperá a que termine la verificación anterior.");
          const generation = epoch.current;
          addingRef.current = true;
          setAdding(true);
          try {
            let fresh;
            try {
              fresh = await loadCartProduct(service, product.slug);
            } catch {
              throw new Error(
                "No pudimos verificar la prenda. Revisá tu conexión e intentá nuevamente.",
              );
            }
            if (!mounted.current || generation !== epoch.current)
              throw new Error(
                "El carrito cambió durante la consulta. Intentá nuevamente.",
              );
            if (
              !fresh ||
              fresh.id !== product.id ||
              fresh.slug !== product.slug
            )
              throw new Error("Esta prenda ya no está publicada.");
            const next = addLine(
              linesRef.current,
              selection(fresh, color, size, quantity),
            );
            // Show the just-verified product immediately; never seed from local prices.
            // Other products remain pending until the normal full refresh completes.
            const entries: CartEntry[] = next.map((line) => {
              if (line.productId !== fresh.id || line.slug !== fresh.slug)
                return { line, status: "loading" };
              const variant = fresh.variants.find(
                (v) =>
                  v.id === line.variantId &&
                  v.active &&
                  v.product_id === fresh.id,
              );
              return variant
                ? { line, status: "ready", product: fresh, variant }
                : { line, status: "unavailable", product: fresh };
            });
            setResolved({
              lines: next,
              revision: revisionRef.current,
              service,
              entries,
            });
            commit(next);
            const added = selection(fresh, color, size, quantity);
            setNotice({
              id: ++noticeId.current,
              product: fresh,
              variant: fresh.variants.find((v) => v.id === added.variantId)!,
              quantity,
            });
          } finally {
            addingRef.current = false;
            if (mounted.current) setAdding(false);
          }
        },
        setQuantity(id, quantity) {
          epoch.current++;
          commit(changeQuantity(linesRef.current, id, quantity));
        },
        remove(id) {
          epoch.current++;
          commit(removeLine(linesRef.current, id));
        },
        clear() {
          dismissNotice();
          epoch.current++;
          commit([]);
        },
      }}
    >
      {children}
    </CartContext.Provider>
  );
}
