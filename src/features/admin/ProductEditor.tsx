import { useCallback, useEffect, useRef, useState } from "react";
import { rpc } from "./client";
import { type AdminProduct, type Adjustment, money } from "./model";
import type { EditorSection } from "./navigation";
import { useProductData } from "./useProductData";
import { readiness } from "./ux";
import { Photos } from "./Photos";
import { Combinations } from "./Combinations";
import { StockControl } from "./StockControl";
import { Confirm } from "./Confirm";
import { GeneralInformation } from "./GeneralInformation";
export type Execute = (operation: () => Promise<void>) => Promise<void>;
export function ProductEditor({
  product,
  section,
  stockOnly,
  pending,
  onAdjust,
  onUnauthorized,
  onDirty,
  onSaved,
  backHref,
  revision,
}: {
  product: AdminProduct | null;
  section: EditorSection;
  stockOnly: boolean;
  pending: Adjustment | null;
  onAdjust(a: Adjustment): Promise<void>;
  onUnauthorized(): void;
  onDirty(value: boolean): void;
  onSaved(p: AdminProduct, message?: string): void;
  backHref: string;
  revision: number;
}) {
  const { data, loading, ready, readError, refresh } = useProductData(
    product?.id,
    onUnauthorized,
    revision,
  );
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(
      product
        ? ""
        : "Empezá con la información general. Tu producto se guardará como borrador.",
    ),
    [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState<Record<string, boolean>>({}),
    [confirm, setConfirm] = useState<{
      text: string;
      run: () => Promise<void>;
    } | null>(null);
  const busyRef = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  // Successful recovery is a new confirmed result, not an old failed mutation.
  useEffect(() => {
    if (revision) {
      setError("");
      setNotice("");
    }
  }, [revision]);
  const changed = useCallback(
    (part: string, value: boolean) =>
      setDirty((d) => (d[part] === value ? d : { ...d, [part]: value })),
    [],
  );
  const isDirty = Object.values(dirty).some(Boolean);
  useEffect(() => {
    onDirty(isDirty);
    return () => onDirty(false);
  }, [isDirty, onDirty]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [section]);
  const execute: Execute = async (fn) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!(await rpc<boolean>("is_admin", {}))) {
        onUnauthorized();
        return;
      }
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const saved = (text: string) => {
    setError("");
    setNotice(text);
  };
  const steps = readiness(data.images, data.variants, data.inventory),
    complete = steps.every((s) => s.done);
  const base = product
    ? `#/admin/productos/${product.id}`
    : "#/admin/productos/nuevo";
  const sections: [EditorSection, string][] = [
    ["general", "Información general"],
    ["fotos", "Fotografías"],
    ["talles", "Talles y colores"],
    ["stock", "Control de stock"],
    ["revision", "Revisar y publicar"],
  ];
  return (
    <section
      data-admin-dirty={isDirty ? "true" : "false"}
      data-admin-saving={busy ? "true" : "false"}
    >
      <a className="admin-back" href={backHref}>
        ← {stockOnly ? "Volver a stock" : "Volver a productos"}
      </a>
      <header className="admin-toolbar admin-section-heading">
        <div>
          <p className="eyebrow">
            {stockOnly ? "EXISTENCIAS" : "EDICIÓN DE PRODUCTO"}
          </p>
          <h2 ref={heading} tabIndex={-1}>
            {product?.name ?? "Agregar producto"}
          </h2>
          <p className="admin-muted">
            {stockOnly
              ? "Cantidades claras, cambios controlados."
              : "Un detalle a la vez. Guardá tus avances y continuá cuando quieras."}
          </p>
        </div>
        {product && (
          <span className={`admin-badge ${product.active ? "published" : ""}`}>
            {product.active ? "Publicado" : "Borrador"}
          </span>
        )}
      </header>
      {!stockOnly && (
        <nav className="admin-editor-nav" aria-label="Secciones del producto">
          {sections.map(([id, label], index) =>
            product || id === "general" ? (
              <a
                key={id}
                href={`${base}/${id}`}
                aria-current={section === id ? "page" : undefined}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {label}
              </a>
            ) : (
              <span key={id} aria-disabled="true">
                <span>{String(index + 1).padStart(2, "0")}</span>
                {label}
              </span>
            ),
          )}
        </nav>
      )}
      {notice && (
        <p className="admin-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="admin-alert" role="alert">
          {error}
        </p>
      )}
      {readError && (
        <div className="admin-query-warning">
          <p>{readError}</p>
          <button
            className="button secondary"
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            Reintentar consulta
          </button>
        </div>
      )}
      {loading && (
        <p role="status" className="admin-muted">
          Actualizando información…
        </p>
      )}
      <div hidden={stockOnly || section !== "general"} className="admin-panel">
        <GeneralInformation
          product={product}
          categories={data.categories}
          busy={busy || loading || !ready}
          execute={execute}
          onSaved={onSaved}
          onDirty={(v) => changed("general", v)}
          success={saved}
        />
      </div>
      {product && (
        <>
          <div
            hidden={stockOnly || section !== "fotos"}
            className="admin-panel"
          >
            <Photos
              product={product}
              data={data}
              busy={busy || loading || !ready}
              execute={execute}
              refresh={refresh}
              onDirty={(v) => changed("photos", v)}
              success={saved}
              confirm={setConfirm}
            />
          </div>
          <div
            hidden={stockOnly || section !== "talles"}
            className="admin-panel"
          >
            <Combinations
              product={product}
              variants={data.variants}
              busy={busy || loading || !ready}
              execute={execute}
              refresh={refresh}
              onDirty={(v) => changed("combinations", v)}
              success={saved}
            />
          </div>
          <div
            hidden={!stockOnly && section !== "stock"}
            className="admin-panel"
          >
            <StockControl
              product={product}
              data={data}
              pending={pending}
              busy={busy || loading || !ready}
              refresh={refresh}
              onAdjust={onAdjust}
              onDirty={(v) => changed("stock", v)}
              success={saved}
              confirm={setConfirm}
            />
          </div>
          <div
            hidden={stockOnly || section !== "revision"}
            className="admin-panel admin-card"
          >
            <p className="eyebrow">ÚLTIMO PASO</p>
            <h3>Tu prenda, lista para la colección</h3>
            <p>Revisá cada detalle antes de mostrarla en la tienda.</p>
            <dl className="admin-facts">
              <div>
                <dt>Producto</dt>
                <dd>{product.name}</dd>
              </div>
              <div>
                <dt>Precio</dt>
                <dd>{money(product.price_cents)}</dd>
              </div>
              <div>
                <dt>Categoría</dt>
                <dd>
                  {data.categories.find((c) => c.id === product.category_id)
                    ?.name ?? "Sin información"}
                </dd>
              </div>
              <div>
                <dt>Publicación</dt>
                <dd>{product.active ? "Publicado" : "Borrador"}</dd>
              </div>
            </dl>
            <ul className="admin-checklist">
              {steps.map((s, index) => (
                <li key={s.label}>
                  <span aria-label={s.done ? "Completo" : "Pendiente"}>
                    {s.done ? "✓" : "○"}
                  </span>
                  <a href={`${base}/${["fotos", "talles", "stock"][index]}`}>
                    {s.label}
                  </a>
                  <span>{s.done ? "Completo" : "Falta completar"}</span>
                </li>
              ))}
            </ul>
            {!complete && (
              <p className="admin-muted">
                Completá fotografías, combinaciones disponibles para la venta y
                stock antes de publicar. Podés continuar más tarde: el borrador
                ya está guardado.
              </p>
            )}
            <button
              className="button primary"
              disabled={
                busy || !ready || isDirty || (!complete && !product.active)
              }
              onClick={() =>
                setConfirm({
                  text: product.active
                    ? "¿Pasar esta prenda a borrador? Sus datos y pedidos se conservan."
                    : "¿Publicar esta prenda en la tienda? El stock reservado sigue protegido.",
                  run: async () => {
                    const p = await rpc<AdminProduct>("admin_save_product", {
                      p_id: product.id,
                      p_expected: product.updated_at,
                      p_values: {
                        name: product.name,
                        slug: product.slug,
                        category_id: product.category_id,
                        description: product.description,
                        price_cents: product.price_cents,
                        active: !product.active,
                      },
                    });
                    onSaved(p);
                    saved(
                      p.active
                        ? "Producto publicado correctamente."
                        : "Producto guardado como borrador.",
                    );
                  },
                })
              }
            >
              {product.active ? "Pasar a borrador" : "Publicar producto"}
            </button>
            {isDirty && (
              <p className="admin-muted">
                Guardá los cambios pendientes en las otras secciones antes de
                publicar.
              </p>
            )}
          </div>
          {!stockOnly && (
            <footer className="admin-editor-footer">
              <span>
                Los avances guardados quedan disponibles para continuar luego.
              </span>
              {section !== "revision" && (
                <a
                  className="button secondary"
                  href={`${base}/${sections[Math.min(sections.findIndex((s) => s[0] === section) + 1, 4)][0]}`}
                >
                  Continuar →
                </a>
              )}
            </footer>
          )}
        </>
      )}
      {confirm && (
        <Confirm
          text={confirm.text}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const fn = confirm.run;
            setConfirm(null);
            void execute(fn);
          }}
        />
      )}
    </section>
  );
}
