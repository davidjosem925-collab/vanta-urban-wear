import { useState } from "react";
import { AdminError, rpc } from "./client";
import type { AdminProduct, AdminVariant } from "./model";
import type { Execute } from "./ProductEditor";
import { combinationPlan, productSlug } from "./ux";
export function Combinations({
  product,
  variants,
  busy,
  execute,
  refresh,
  onDirty,
  success,
}: {
  product: AdminProduct;
  variants: AdminVariant[];
  busy: boolean;
  execute: Execute;
  refresh(): Promise<boolean>;
  onDirty(v: boolean): void;
  success(t: string): void;
}) {
  const [chosen, setChosen] = useState(""),
    [color, setColor] = useState(""),
    [sizes, setSizes] = useState<string[]>([]),
    [extra, setExtra] = useState(""),
    [review, setReview] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [code, setCode] = useState(""),
    [enabled, setEnabled] = useState(true),
    [created, setCreated] = useState<AdminVariant[]>([]);
  // Retain confirmed rows locally until the read refresh succeeds; never replay a batch automatically.
  const all = [
    ...variants.map((v) => created.find((x) => x.id === v.id) ?? v),
    ...created.filter((v) => !variants.some((x) => x.id === v.id)),
  ];
  const colors = [...new Set(all.map((v) => v.color))],
    selected = colors.includes(chosen) ? chosen : (colors[0] ?? "");
  const canonical =
    colors.find(
      (c) =>
        c.toLocaleLowerCase("es-AR") ===
        color.trim().toLocaleLowerCase("es-AR"),
    ) ?? color.trim();
  const plan = combinationPlan(all, canonical, sizes),
    fresh = plan.filter((p) => !p.exists);
  function resetFlow() {
    setSizes([]);
    setColor("");
    setExtra("");
    setReview(false);
    onDirty(false);
  }
  return (
    <section className="admin-card">
      <div className="admin-panel-heading">
        <h3>Talles y colores</h3>
        <p className="admin-muted">
          Elegí un color para ver sus talles. Cambiar disponibilidad conserva su
          código y sus pedidos.
        </p>
      </div>
      {colors.length > 0 ? (
        <>
          <label className="admin-color-picker">
            Color a consultar
            <select
              value={selected}
              onChange={(e) => setChosen(e.target.value)}
            >
              {colors.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <div className="admin-size-table">
            <div className="admin-size-head" aria-hidden="true">
              <span>Talle</span>
              <span>Disponible para la venta</span>
              <span>Acción</span>
            </div>
            {all
              .filter((v) => v.color === selected)
              .map((v) => (
                <div className="admin-size-row" key={v.id}>
                  <strong>{v.size}</strong>
                  <span className="admin-badge">{v.active ? "Sí" : "No"}</span>
                  <button
                    className="admin-text-action"
                    disabled={busy}
                    onClick={() => {
                      if (
                        editing &&
                        (code !== all.find((x) => x.id === editing)?.sku ||
                          enabled !==
                            all.find((x) => x.id === editing)?.active) &&
                        !window.confirm("¿Descartar la edición de este talle?")
                      )
                        return;
                      setEditing(v.id);
                      setCode(v.sku);
                      setEnabled(v.active);
                    }}
                  >
                    Editar talle {v.size}
                  </button>
                </div>
              ))}
          </div>
        </>
      ) : (
        <div className="admin-empty">
          <h4>Elegí cómo se ofrece esta prenda</h4>
          <p>Agregá un color y sus talles. Después podrás cargar stock.</p>
        </div>
      )}
      {editing && (
        <form
          className="admin-inline-editor"
          onSubmit={(e) => {
            e.preventDefault();
            const v = all.find((v) => v.id === editing)!;
            void execute(async () => {
              const saved = await rpc<AdminVariant>("admin_save_variant", {
                p_id: v.id,
                p_product: product.id,
                p_expected: v,
                p_values: {
                  sku: code.trim(),
                  size: v.size,
                  color: v.color,
                  active: enabled,
                },
              });
              setCreated((old) => [
                ...old.filter((x) => x.id !== saved.id),
                saved,
              ]);
              setEditing(null);
              onDirty(Boolean(color || sizes.length));
              success("Talle y color guardados correctamente.");
              if (await refresh()) setCreated([]);
            });
          }}
        >
          <h4>
            {all.find((v) => v.id === editing)?.color} · talle{" "}
            {all.find((v) => v.id === editing)?.size}
          </h4>
          <p className="admin-muted">
            El talle y el color de una combinación existente se conservan para
            proteger su historial.
          </p>
          <fieldset disabled={busy}>
            <label>
              Código interno
              <input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  onDirty(true);
                }}
                maxLength={100}
                required
              />
            </label>
            <label className="admin-checkbox">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => {
                  setEnabled(e.target.checked);
                  onDirty(true);
                }}
              />
              Disponible para la venta
            </label>
            <div className="admin-actions">
              <button className="button primary">Guardar talle</button>
              <button
                type="button"
                className="admin-text-action"
                onClick={() => {
                  if (
                    (code !== all.find((v) => v.id === editing)?.sku ||
                      enabled !== all.find((v) => v.id === editing)?.active) &&
                    !window.confirm("¿Descartar los cambios de este talle?")
                  )
                    return;
                  setEditing(null);
                  onDirty(Boolean(color || sizes.length));
                }}
              >
                Cancelar edición
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <form
        className="admin-combination-builder"
        onSubmit={(e) => {
          e.preventDefault();
          setReview(true);
        }}
      >
        <h4>Agregar talle o color</h4>
        <p className="admin-muted">
          1. Elegí el color. 2. Marcá los talles. 3. Revisá las combinaciones.
        </p>
        <fieldset disabled={busy || Boolean(editing)}>
          <label>
            Color de la prenda
            <input
              list="admin-colors"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
                setReview(false);
                onDirty(true);
              }}
              placeholder="Ej.: Negro o Blanco hueso"
              required
              maxLength={60}
            />
            <datalist id="admin-colors">
              {colors.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <fieldset className="admin-size-options">
            <legend>Talles a agregar</legend>
            {[
              ...new Set([
                "S",
                "M",
                "L",
                "XL",
                ...all.map((v) => v.size),
                ...sizes,
              ]),
            ].map((s) => (
              <label className="admin-size-option" key={s}>
                <input
                  type="checkbox"
                  checked={sizes.includes(s)}
                  onChange={(e) => {
                    setSizes(
                      e.target.checked
                        ? [...sizes, s]
                        : sizes.filter((x) => x !== s),
                    );
                    setReview(false);
                    onDirty(true);
                  }}
                />
                {s}
              </label>
            ))}
          </fieldset>
          <div className="admin-custom-size">
            <label>
              Otro talle
              <input
                value={extra}
                onChange={(e) => {
                  setExtra(e.target.value);
                  onDirty(true);
                }}
                maxLength={30}
                placeholder="Ej.: XXL o 42"
              />
            </label>
            <button
              className="admin-text-action"
              type="button"
              disabled={!extra.trim()}
              onClick={() => {
                setSizes([...new Set([...sizes, extra.trim()])]);
                setExtra("");
                setReview(false);
                onDirty(true);
              }}
            >
              Incluir talle
            </button>
          </div>
          <button
            className="button secondary"
            disabled={!canonical || !sizes.length}
          >
            Revisar combinaciones
          </button>
        </fieldset>
      </form>
      {review && (
        <div className="admin-batch-review">
          <h4>{canonical}</h4>
          <ul>
            {plan.map((p) => (
              <li key={p.size}>
                <strong>Talle {p.size}</strong>
                <span>
                  {p.exists ? "Ya existe · se conserva" : "Se creará sin stock"}
                </span>
              </li>
            ))}
          </ul>
          <p className="admin-muted">
            Generamos un código interno único para cada combinación nueva. Los
            códigos existentes no cambian.
          </p>
          <button
            className="button primary"
            disabled={busy || !fresh.length}
            onClick={() =>
              void execute(async () => {
                let count = 0;
                try {
                  for (const p of fresh) {
                    const sku =
                      `${productSlug(product.slug).slice(0, 40)}-${productSlug(canonical).slice(0, 15)}-${productSlug(p.size).slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`.toUpperCase();
                    const row = await rpc<AdminVariant>("admin_save_variant", {
                      p_id: null,
                      p_product: product.id,
                      p_expected: null,
                      p_values: {
                        sku,
                        size: p.size,
                        color: canonical,
                        active: true,
                      },
                    });
                    setCreated((old) => [...old, row]);
                    count++;
                  }
                } catch (e) {
                  if (await refresh()) setCreated([]);
                  throw new Error(
                    `${count ? `${count} ${count === 1 ? "combinación quedó guardada" : "combinaciones quedaron guardadas"}. ` : ""}${e instanceof AdminError && e.kind === "duplicate" ? "Otra edición creó esa combinación. Consultá los talles antes de continuar." : "No se confirmó el resto de las combinaciones. Consultá los datos antes de volver a crearlas."}`,
                  );
                }
                setChosen(canonical);
                resetFlow();
                success(
                  `${count} ${count === 1 ? "combinación guardada" : "combinaciones guardadas"} correctamente. Podés continuar con el stock.`,
                );
                if (await refresh()) setCreated([]);
              })
            }
          >
            {fresh.length
              ? `Crear ${fresh.length} ${fresh.length === 1 ? "combinación" : "combinaciones"}`
              : "Todas las combinaciones ya existen"}
          </button>
        </div>
      )}
    </section>
  );
}
