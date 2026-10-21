import { useState } from "react";
import { AdminError, connected, rows, rpc } from "./client";
import { type AdminProduct, money, priceCents } from "./model";
import { productSlug } from "./ux";
import type { Execute } from "./ProductEditor";
export function GeneralInformation({
  product,
  categories,
  busy,
  execute,
  onSaved,
  onDirty,
  success,
}: {
  product: AdminProduct | null;
  categories: { id: string; name: string }[];
  busy: boolean;
  execute: Execute;
  onSaved(p: AdminProduct, message?: string): void;
  onDirty(v: boolean): void;
  success(t: string): void;
}) {
  const [name, setName] = useState(product?.name ?? ""),
    [category, setCategory] = useState(product?.category_id ?? ""),
    [description, setDescription] = useState(product?.description ?? ""),
    [price, setPrice] = useState(
      product ? String(product.price_cents / 100) : "",
    ),
    [slug, setSlug] = useState(""),
    [customSlug, setCustomSlug] = useState(false),
    [collision, setCollision] = useState(false),
    [addressIssue, setAddressIssue] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [conflict, setConflict] = useState(false),
    [serverCopy, setServerCopy] = useState<AdminProduct | null>(null);
  const address = product?.slug ?? (customSlug ? slug : productSlug(name));
  const update = (fn: () => void) => {
    fn();
    onDirty(true);
  };
  return (
    <section className="admin-card">
      <div className="admin-panel-heading">
        <h3>Información general</h3>
        <p className="admin-muted">
          Lo que tus clientes van a conocer de esta prenda.
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void execute(async () => {
            if (!name.trim())
              throw new Error("Escribí el nombre del producto.");
            if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(address)) {
              setAddressIssue(true);
              throw new Error(
                "No pudimos generar la dirección. Elegí una alternativa con letras, números y guiones.",
              );
            }
            const values = {
              name: name.trim(),
              category_id: category,
              description,
              price_cents: priceCents(price),
              slug: address,
              active: product?.active ?? false,
            };
            let saved: AdminProduct;
            try {
              saved = await rpc<AdminProduct>("admin_save_product", {
                p_id: product?.id ?? null,
                p_expected: product?.updated_at ?? null,
                p_values: values,
              });
            } catch (error) {
              if (error instanceof AdminError && error.kind === "conflict")
                setConflict(true);
              if (!product) {
                if (error instanceof AdminError && error.kind === "duplicate")
                  setCollision(true);
                else if (
                  !(error instanceof AdminError) ||
                  error.kind === "unknown"
                )
                  setUncertain(true);
              }
              throw error;
            }
            onDirty(false);
            onSaved(saved);
            success("Producto guardado correctamente.");
          });
        }}
      >
        <fieldset disabled={busy || uncertain}>
          <div className="admin-grid">
            <label>
              Nombre del producto
              <input
                name="name"
                value={name}
                onChange={(e) => update(() => setName(e.target.value))}
                required
                maxLength={200}
                placeholder="Ej.: Remera Oversize Hueso"
              />
            </label>
            <label>
              Categoría
              <select
                value={category}
                onChange={(e) => update(() => setCategory(e.target.value))}
                required
              >
                <option value="" disabled>
                  Elegí una categoría
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Descripción
            <textarea
              value={description}
              onChange={(e) => update(() => setDescription(e.target.value))}
              rows={4}
              maxLength={10000}
              placeholder="Contá cómo es la tela, el corte y los detalles de la prenda."
            />
          </label>
          <div className="admin-grid">
            <label>
              Precio en ARS
              <input
                aria-label="Precio en ARS"
                aria-describedby="admin-price-help"
                value={price}
                onChange={(e) => update(() => setPrice(e.target.value))}
                inputMode="decimal"
                placeholder="Ej.: 27000,50"
                required
                maxLength={14}
              />
              <span id="admin-price-help" className="admin-field-help">
                Sin puntos de miles. Podés usar coma para los centavos.
              </span>
            </label>
            <div className="admin-publication">
              <span>Estado de publicación</span>
              <strong>{product?.active ? "Publicado" : "Borrador"}</strong>
              <p>
                {product?.active
                  ? "La prenda está visible en la tienda."
                  : "Todavía no se muestra en la tienda."}
              </p>
              {product && (
                <a href={`#/admin/productos/${product.id}/revision`}>
                  Revisar publicación →
                </a>
              )}
            </div>
          </div>
          {!product && (
            <details open={collision || addressIssue || undefined}>
              <summary>
                Dirección del producto{" "}
                {collision
                  ? "· elegí una alternativa"
                  : "(se genera automáticamente)"}
              </summary>
              <p className="admin-muted">
                {collision
                  ? "Esa dirección ya está usada. Elegí otra, por ejemplo agregando el color. No se modificó el producto existente."
                  : "Esta dirección identifica la prenda en la tienda."}
              </p>
              <label>
                Dirección del producto
                <input
                  value={address}
                  onChange={(e) =>
                    update(() => {
                      setCustomSlug(true);
                      setSlug(e.target.value);
                    })
                  }
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  maxLength={150}
                />
              </label>
            </details>
          )}
          <button className="button primary">
            {busy
              ? "Guardando…"
              : product
                ? "Guardar cambios"
                : "Guardar borrador"}
          </button>
        </fieldset>
      </form>
      {conflict && product && (
        <div className="admin-query-warning">
          <p>
            Tu edición se conserva. Consultá la versión guardada para revisar
            qué cambió.
          </p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void execute(async () => {
                const ps = await rows<AdminProduct[]>(
                  connected().from("products").select("*").eq("id", product.id),
                );
                if (ps[0]) setServerCopy(ps[0]);
              })
            }
          >
            Consultar cambios guardados
          </button>
          {serverCopy && (
            <>
              <dl className="admin-facts">
                <div>
                  <dt>Nombre guardado</dt>
                  <dd>{serverCopy.name}</dd>
                </div>
                <div>
                  <dt>Precio guardado</dt>
                  <dd>{money(serverCopy.price_cents)}</dd>
                </div>
                <div>
                  <dt>Descripción guardada</dt>
                  <dd>{serverCopy.description || "Sin descripción"}</dd>
                </div>
                <div>
                  <dt>Categoría guardada</dt>
                  <dd>
                    {
                      categories.find((c) => c.id === serverCopy.category_id)
                        ?.name
                    }
                  </dd>
                </div>
              </dl>
              <button
                className="button secondary"
                onClick={() => {
                  if (
                    !window.confirm(
                      "¿Reemplazar tu edición sin guardar por los datos actuales?",
                    )
                  )
                    return;
                  setName(serverCopy.name);
                  setCategory(serverCopy.category_id);
                  setPrice(String(serverCopy.price_cents / 100));
                  setDescription(serverCopy.description);
                  onSaved(serverCopy);
                  onDirty(false);
                  setConflict(false);
                  setServerCopy(null);
                  success("Versión actual cargada. Podés editar nuevamente.");
                }}
              >
                Usar versión guardada
              </button>
            </>
          )}
        </div>
      )}
      {uncertain && (
        <div className="admin-query-warning">
          <p>
            No pudimos confirmar el guardado. Buscá primero el borrador para
            evitar cargarlo otra vez.
          </p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void execute(async () => {
                const ps = await rows<AdminProduct[]>(
                  connected().from("products").select("*").eq("slug", address),
                );
                if (ps.length) {
                  onDirty(false);
                  onSaved(
                    ps[0],
                    "Encontramos el producto. Revisá sus datos antes de continuar.",
                  );
                  success(
                    "Encontramos el producto. Revisá sus datos antes de continuar.",
                  );
                } else {
                  setUncertain(false);
                  success(
                    "No encontramos el borrador. Podés volver a guardar con la misma dirección.",
                  );
                }
              })
            }
          >
            Buscar el borrador guardado
          </button>
        </div>
      )}
    </section>
  );
}
