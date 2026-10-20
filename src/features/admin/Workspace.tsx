import { useCallback, useEffect, useRef, useState } from "react";
import { connected, rows, rpc } from "./client";
import { ProductEditor } from "./ProductEditor";
import { Orders } from "./Orders";
import {
  type AdminProduct,
  type Adjustment,
  type Movement,
  money,
  readAdjustment,
} from "./model";
export function AdminWorkspace({
  userId,
  onUnauthorized,
}: {
  userId: string;
  onUnauthorized(): void;
}) {
  const [tab, setTab] = useState<"products" | "orders">("products"),
    [products, setProducts] = useState<AdminProduct[]>([]),
    [page, setPage] = useState(0),
    [term, setTerm] = useState(""),
    [status, setStatus] = useState("all"),
    [selected, setSelected] = useState<AdminProduct | null | undefined>(
      undefined,
    ),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const mounted = useRef(true),
    request = useRef(0);
  const pendingKey = `vanta.admin.adjust.${userId}`;
  const [pending, setPending] = useState<Adjustment | null>(() => {
    try {
      return readAdjustment(sessionStorage.getItem(pendingKey));
    } catch {
      return null;
    }
  });
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    try {
      if (!(await rpc<boolean>("is_admin", {}))) {
        onUnauthorized();
        return;
      }
      let q = connected()
        .from("products")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id")
        .range(page * 20, page * 20 + 19);
      if (term) q = q.ilike("name", `%${term.replace(/[%_\\]/g, "")}%`);
      if (status !== "all") q = q.eq("active", status === "published");
      const result = await rows<AdminProduct[]>(q);
      if (mounted.current && id === request.current) {
        setProducts(result);
        setError("");
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current && id === request.current) setLoading(false);
    }
  }, [onUnauthorized, page, status, term]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  async function adjust(a: Adjustment) {
    setError("");
    try {
      sessionStorage.setItem(pendingKey, JSON.stringify(a));
      setPending(a);
      await rpc("demo_admin_adjust_inventory", {
        p_variant: a.variant,
        p_delta: a.delta,
        p_reason: a.reason,
        p_key: a.key,
      });
      sessionStorage.removeItem(pendingKey);
      setPending(null);
      setNotice(
        "Ajuste confirmado. El reintento usa la misma clave y no duplica unidades.",
      );
      void load();
      return true;
    } catch (e) {
      if ((e as Error).message.startsWith("El ajuste dejaría")) {
        sessionStorage.removeItem(pendingKey);
        setPending(null);
      }
      setError((e as Error).message);
      return false;
    }
  }
  async function resolvePending() {
    if (!pending) return;
    try {
      const result = await rows<Movement[]>(
        connected()
          .from("inventory_movements")
          .select("*")
          .eq("idempotency_key", pending.key),
      );
      if (result.length) {
        if (
          result[0].variant_id !== pending.variant ||
          result[0].quantity !== pending.delta ||
          result[0].reason !== pending.reason
        )
          throw new Error(
            "La clave corresponde a un ajuste distinto. Revisá los movimientos antes de continuar.",
          );
        sessionStorage.removeItem(pendingKey);
        setPending(null);
        setNotice("El ajuste ya estaba registrado. No se repitió.");
      } else await adjust(pending);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <nav className="admin-tabs" aria-label="Administración">
        <button
          aria-pressed={tab === "products"}
          onClick={() => {
            setTab("products");
            setSelected(undefined);
          }}
        >
          Productos e inventario
        </button>
        <button
          aria-pressed={tab === "orders"}
          onClick={() => {
            setTab("orders");
            setSelected(undefined);
          }}
        >
          Pedidos demo
        </button>
        <a href="#/catalogo">Ver tienda</a>
      </nav>
      {error && (
        <p className="admin-alert" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="admin-notice" role="status">
          {notice}
        </p>
      )}
      {pending && (
        <div className="admin-card" role="status">
          <p>
            Hay un ajuste sin resultado confirmado. Cantidad: {pending.delta}.
            Conservamos su identidad después de recargar.
          </p>
          <button
            className="button secondary"
            onClick={() => void resolvePending()}
          >
            Consultar o reintentar el mismo ajuste
          </button>
        </div>
      )}
      {tab === "orders" ? (
        <Orders onUnauthorized={onUnauthorized} />
      ) : selected !== undefined ? (
        <ProductEditor
          key={selected?.id ?? "new"}
          product={selected}
          pending={pending}
          onAdjust={adjust}
          onUnauthorized={onUnauthorized}
          onClose={() => {
            setSelected(undefined);
            void load();
          }}
          onSaved={(p) => {
            setSelected(p);
            setNotice("Producto guardado.");
            void load();
          }}
        />
      ) : (
        <>
          <div className="admin-toolbar">
            <h2>Productos</h2>
            <button
              className="button primary"
              onClick={() => setSelected(null)}
            >
              Nuevo producto
            </button>
          </div>
          <form
            className="admin-filters"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setPage(0);
              setTerm(String(f.get("search")).trim());
              setStatus(String(f.get("status")));
            }}
          >
            <label>
              Buscar por nombre
              <input name="search" maxLength={100} />
            </label>
            <label>
              Publicación
              <select name="status">
                <option value="all">Todos</option>
                <option value="published">Publicados</option>
                <option value="draft">Borradores</option>
              </select>
            </label>
            <button className="button secondary">Filtrar</button>
            <button
              className="button secondary"
              type="button"
              onClick={() => void load()}
            >
              Actualizar
            </button>
          </form>
          {loading ? (
            <p role="status">Cargando productos…</p>
          ) : products.length === 0 ? (
            <p>No hay productos para estos filtros.</p>
          ) : (
            <div className="admin-product-list">
              {products.map((p) => (
                <article className="admin-card" key={p.id}>
                  <div>
                    <h3>{p.name}</h3>
                    <p>
                      {p.active ? "Publicado" : "Borrador"} ·{" "}
                      {money(p.price_cents)}
                    </p>
                    <p className="admin-muted">{p.slug}</p>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => setSelected(p)}
                    aria-label={`Editar ${p.name}`}
                  >
                    Editar
                  </button>
                </article>
              ))}
            </div>
          )}
          <div className="admin-pagination">
            <button
              className="button secondary"
              disabled={!page || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </button>
            <span>Página {page + 1}</span>
            <button
              className="button secondary"
              disabled={products.length < 20 || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </button>
          </div>
        </>
      )}
    </>
  );
}
