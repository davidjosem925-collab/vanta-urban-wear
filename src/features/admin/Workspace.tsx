import { useCallback, useEffect, useRef, useState } from "react";
import { connected, rows, rpc } from "./client";
import { ProductEditor } from "./ProductEditor";
import { Orders } from "./Orders";
import { useAdminNavigation } from "./navigation";
import { imagePreviews } from "./previews";
import { originals } from "./ux";
import {
  type AdminProduct,
  type AdminImage,
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
  const { view, navigate, setDirty } = useAdminNavigation();
  const [products, setProducts] = useState<AdminProduct[]>([]),
    [product, setProduct] = useState<AdminProduct | null>(null),
    [categories, setCategories] = useState<{ id: string; name: string }[]>([]),
    [images, setImages] = useState<AdminImage[]>([]),
    [previews, setPreviews] = useState<Record<string, string>>({}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0),
    [resolving, setResolving] = useState(false);
  const generation = useRef(0);
  const pendingKey = `vanta.admin.adjust.${userId}`;
  const [pending, setPending] = useState<Adjustment | null>(() => {
    try {
      return readAdjustment(sessionStorage.getItem(pendingKey));
    } catch {
      return null;
    }
  });
  const page = Math.max(
    0,
    Math.min(100000, Number(view.query.get("pagina")) || 0),
  );
  const search = view.query.get("buscar") ?? "",
    status = view.query.get("estado") ?? "all";
  const returnList = useRef("#/admin/productos"),
    returnStock = useRef("#/admin/stock");
  // Use the hook snapshot, not location.hash, which may already point at the next view.
  if (view.area === "productos" && !view.id)
    returnList.current = `#/admin/productos${view.query.size ? `?${view.query}` : ""}`;
  if (view.area === "stock" && !view.id)
    returnStock.current = `#/admin/stock${view.query.size ? `?${view.query}` : ""}`;
  const load = useCallback(async () => {
    const id = ++generation.current;
    setLoading(true);
    setError("");
    setProduct(null);
    if (view.area === "pedidos") {
      setLoading(false);
      return;
    }
    try {
      if (!(await rpc<boolean>("is_admin", {}))) {
        onUnauthorized();
        return;
      }
      const c = connected();
      if (view.id && view.id !== "nuevo") {
        const ps = await rows<AdminProduct[]>(
          c.from("products").select("*").eq("id", view.id),
        );
        if (!ps.length)
          throw new Error(
            "No encontramos ese producto. Volvé al listado para consultar los disponibles.",
          );
        if (id === generation.current) setProduct(ps[0]);
      } else if (!view.id) {
        let q = c
          .from("products")
          .select("*")
          .order("created_at", { ascending: false })
          .order("id")
          .range(page * 20, page * 20 + 19);
        if (search) q = q.ilike("name", `%${search.replace(/[%_\\]/g, "")}%`);
        if (status !== "all") q = q.eq("active", status === "published");
        const [ps, cs] = await Promise.all([
          rows<AdminProduct[]>(q),
          rows<{ id: string; name: string }[]>(
            c.from("categories").select("id,name").order("name"),
          ),
        ]);
        if (id !== generation.current) return;
        setProducts(ps);
        setCategories(cs);
        // Photograph availability never turns a successful product query into a failed save.
        try {
          const ims = ps.length
            ? await rows<AdminImage[]>(
                c
                  .from("product_images")
                  .select("*")
                  .in(
                    "product_id",
                    ps.map((p) => p.id),
                  )
                  .order("position"),
              )
            : [];
          const urls = await imagePreviews(ims);
          if (id === generation.current) {
            setImages(ims);
            setPreviews(urls);
          }
        } catch {
          if (id === generation.current) {
            setImages([]);
            setPreviews({});
          }
        }
      }
    } catch (e) {
      if (id === generation.current)
        setError(
          (e as Error).message.startsWith("No encontramos")
            ? (e as Error).message
            : "No se pudieron actualizar los datos. Reintentar consulta no vuelve a guardar el producto.",
        );
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, [view.area, view.id, page, search, status, onUnauthorized]);
  useEffect(() => {
    void load();
    const counter = generation;
    return () => {
      counter.current++;
    };
  }, [load]);
  const trackDirty = useCallback(
    (value: boolean) => {
      setDirty(value);
      if (value) setNotice("");
    },
    [setDirty],
  );
  async function adjust(a: Adjustment) {
    // Persist intent BEFORE writing. A failed persistence prevents the write.
    try {
      sessionStorage.setItem(pendingKey, JSON.stringify(a));
    } catch {
      throw new Error(
        "No podemos conservar este intento de forma segura en el navegador. Habilitá su almacenamiento antes de cambiar stock. No se envió el cambio.",
      );
    }
    setPending(a);
    try {
      await rpc("demo_admin_adjust_inventory", {
        p_variant: a.variant,
        p_delta: a.delta,
        p_reason: a.reason,
        p_key: a.key,
      });
    } catch (e) {
      if ((e as Error).message.startsWith("El ajuste dejaría")) {
        try {
          sessionStorage.removeItem(pendingKey);
        } catch {
          /* confirmed movement can be rediscovered on reload */
        }
        setPending(null);
      }
      throw e;
    }
    // A confirmed RPC remains successful even if local cleanup or a later read fails.
    try {
      sessionStorage.removeItem(pendingKey);
    } catch {
      /* same-key recovery remains safe */
    }
    setPending(null);
  }
  async function resolvePending() {
    if (!pending || resolving) return;
    setResolving(true);
    setError("");
    setNotice("");
    try {
      const found = await rows<Movement[]>(
        connected()
          .from("inventory_movements")
          .select(
            "id,variant_id,kind,quantity,reason,created_at,idempotency_key",
          )
          .eq("idempotency_key", pending.key),
      );
      if (found.length) {
        if (
          found[0].variant_id !== pending.variant ||
          found[0].quantity !== pending.delta ||
          found[0].reason !== pending.reason
        )
          throw new Error(
            "El intento corresponde a otro cambio. Revisá el historial antes de continuar.",
          );
        try {
          sessionStorage.removeItem(pendingKey);
        } catch {
          /* confirmed movement can be rediscovered on reload */
        }
        setPending(null);
      } else await adjust(pending);
      setNotice(
        "Stock actualizado correctamente. El cambio se aplicó una sola vez.",
      );
      // Do not unmount an open editor or discard its drafts to refresh stock.
      setRevision((r) => r + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResolving(false);
    }
  }
  function listUrl(nextPage: number, term = search, state = status) {
    const q = new URLSearchParams({
      buscar: term,
      estado: state,
      pagina: String(nextPage),
    });
    return `#/admin/${view.area}?${q}`;
  }
  return (
    <div className="admin-layout">
      <nav className="admin-nav" aria-label="Administración">
        <span className="admin-nav-label">TU TIENDA</span>
        <a
          href="#/admin/productos"
          aria-current={view.area === "productos" ? "page" : undefined}
        >
          Productos <span aria-hidden="true">01</span>
        </a>
        <a
          href="#/admin/stock"
          aria-current={view.area === "stock" ? "page" : undefined}
        >
          Stock <span aria-hidden="true">02</span>
        </a>
        <a
          href="#/admin/pedidos"
          aria-label="Pedidos de demostración"
          aria-current={view.area === "pedidos" ? "page" : undefined}
        >
          Pedidos demo <span aria-hidden="true">03</span>
        </a>
        <p className="admin-muted">
          Espacio privado
          <br />
          VANTA Urban Wear
        </p>
      </nav>
      <div className="admin-content">
        {notice && (
          <p role="status" className="admin-notice">
            {notice}
          </p>
        )}
        {error && (
          <div className="admin-alert" role="alert">
            <p>{error}</p>
            <button
              className="button secondary"
              onClick={() => {
                setNotice("");
                void load();
              }}
            >
              Reintentar consulta
            </button>
          </div>
        )}
        {pending && (
          <div className="admin-pending">
            <strong>Un cambio de stock necesita confirmación</strong>
            <p>
              No lo cargues otra vez. Consultamos el intento original para
              evitar duplicarlo.
            </p>
            <button
              className="button secondary"
              disabled={resolving}
              onClick={() => void resolvePending()}
            >
              {resolving
                ? "Consultando…"
                : "Consultar o reintentar el mismo ajuste"}
            </button>
          </div>
        )}
        {view.area === "pedidos" ? (
          <Orders
            onUnauthorized={onUnauthorized}
            selectedId={view.id}
            navigate={navigate}
          />
        ) : loading && !product ? (
          <p role="status" className="admin-loading">
            Cargando {view.id ? "producto" : "productos"}…
          </p>
        ) : view.id && (product || view.id === "nuevo") ? (
          <ProductEditor
            key={view.id}
            product={product}
            section={view.section}
            stockOnly={view.area === "stock"}
            pending={pending}
            onAdjust={adjust}
            onUnauthorized={onUnauthorized}
            onDirty={trackDirty}
            revision={revision}
            onSaved={(p, message) => {
              setProduct(p);
              if (view.id === "nuevo") {
                setDirty(false);
                setNotice(message ?? "Producto guardado correctamente.");
                navigate(`#/admin/productos/${p.id}/general`, true);
              }
            }}
            backHref={
              view.area === "stock" ? returnStock.current : returnList.current
            }
          />
        ) : (
          !view.id && (
            <section>
              <header className="admin-toolbar admin-section-heading">
                <div>
                  <p className="eyebrow">
                    {view.area === "stock" ? "EXISTENCIAS" : "TU COLECCIÓN"}
                  </p>
                  <h2>
                    {view.area === "stock" ? "Control de stock" : "Productos"}
                  </h2>
                  <p className="admin-muted">
                    {view.area === "stock"
                      ? "Elegí una prenda para consultar o actualizar sus cantidades."
                      : "Todas tus prendas, listas para encontrar y editar."}
                  </p>
                </div>
                {view.area === "productos" && (
                  <a
                    className="button primary"
                    href="#/admin/productos/nuevo/general"
                  >
                    + Agregar producto
                  </a>
                )}
              </header>
              <form
                className="admin-filters"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  navigate(
                    listUrl(
                      0,
                      String(f.get("search")).trim(),
                      String(f.get("status")),
                    ),
                  );
                }}
              >
                <label>
                  Buscar producto
                  <input
                    name="search"
                    placeholder="Nombre de la prenda"
                    defaultValue={search}
                    maxLength={100}
                  />
                </label>
                <label>
                  Publicación
                  <select name="status" defaultValue={status}>
                    <option value="all">Todos los productos</option>
                    <option value="published">Publicados</option>
                    <option value="draft">Borradores</option>
                  </select>
                </label>
                <button className="button secondary">Buscar</button>
                <button
                  className="admin-text-action"
                  type="button"
                  onClick={() => void load()}
                >
                  Actualizar
                </button>
              </form>
              {!products.length ? (
                <div className="admin-empty">
                  <h3>No encontramos prendas</h3>
                  <p>Probá otro nombre o cambiá el filtro de publicación.</p>
                </div>
              ) : (
                <div className="admin-collection">
                  <div className="admin-collection-head" aria-hidden="true">
                    <span>Producto</span>
                    <span>Precio</span>
                    <span>Publicación</span>
                    <span>Acción</span>
                  </div>
                  {products.map((p) => {
                    const im = originals(
                      images.filter((i) => i.product_id === p.id),
                    )[0];
                    return (
                      <article className="admin-product-row" key={p.id}>
                        <div className="admin-product-identity">
                          <div className="admin-thumb">
                            {im && previews[im.storage_path] ? (
                              <img
                                src={previews[im.storage_path]}
                                alt={im.alt}
                                width="64"
                                height="80"
                                loading="lazy"
                                onError={(e) => {
                                  e.currentTarget.hidden = true;
                                }}
                              />
                            ) : (
                              <span aria-label="Sin fotografía">V</span>
                            )}
                          </div>
                          <div>
                            <h3>{p.name}</h3>
                            <p>
                              {categories.find((c) => c.id === p.category_id)
                                ?.name ?? "Categoría no disponible"}
                            </p>
                          </div>
                        </div>
                        <p className="admin-product-price">
                          {money(p.price_cents)}
                        </p>
                        <span
                          className={`admin-badge ${p.active ? "published" : ""}`}
                        >
                          {p.active ? "Publicado" : "Borrador"}
                        </span>
                        <a
                          className="admin-row-link"
                          href={
                            view.area === "stock"
                              ? `#/admin/stock/${p.id}`
                              : `#/admin/productos/${p.id}/general`
                          }
                          aria-label={`${view.area === "stock" ? "Ver stock de" : "Editar"} ${p.name}`}
                        >
                          {view.area === "stock" ? "Ver stock" : "Editar"}{" "}
                          <span aria-hidden="true">→</span>
                        </a>
                      </article>
                    );
                  })}
                </div>
              )}
              <div className="admin-pagination">
                <button
                  className="button secondary"
                  disabled={!page || loading}
                  onClick={() => navigate(listUrl(page - 1))}
                >
                  Anterior
                </button>
                <span>Página {page + 1}</span>
                <button
                  className="button secondary"
                  disabled={products.length < 20 || loading}
                  onClick={() => navigate(listUrl(page + 1))}
                >
                  Siguiente
                </button>
              </div>
            </section>
          )
        )}
      </div>
    </div>
  );
}
