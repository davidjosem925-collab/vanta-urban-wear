import { useEffect, useRef, useState } from "react";
import type { AdminProduct, Adjustment } from "./model";
import { date } from "./model";
import type { ProductData } from "./useProductData";
import type { RequestConfirm } from "./Photos";
import { friendly, stockResult } from "./ux";
export function StockControl({
  product,
  data,
  pending,
  busy,
  refresh,
  onAdjust,
  onDirty,
  success,
  confirm,
}: {
  product: AdminProduct;
  data: ProductData;
  pending: Adjustment | null;
  busy: boolean;
  refresh(): Promise<boolean>;
  onAdjust(a: Adjustment): Promise<void>;
  onDirty(v: boolean): void;
  success(t: string): void;
  confirm: RequestConfirm;
}) {
  const [color, setColor] = useState(""),
    [selected, setSelected] = useState(""),
    [action, setAction] = useState("add"),
    [quantity, setQuantity] = useState(""),
    [reason, setReason] = useState("");
  const previous = useRef(pending?.key);
  const focus = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (previous.current && !pending) {
      setQuantity("");
      setReason("");
      onDirty(false);
    }
    previous.current = pending?.key;
  }, [pending, onDirty]);
  const colors = [...new Set(data.variants.map((v) => v.color))],
    currentColor = colors.includes(color) ? color : (colors[0] ?? "");
  const variant = data.variants.find((v) => v.id === selected),
    inventory = data.inventory.find((i) => i.variant_id === selected);
  const result = inventory
    ? stockResult(inventory, action, Number(quantity))
    : null;
  const history = selected
    ? data.movements.filter((m) => m.variant_id === selected)
    : data.movements;
  function changeSelection(id: string) {
    if (
      (quantity || reason) &&
      !window.confirm("¿Descartar este cambio de stock sin guardar?")
    )
      return;
    setSelected(id);
    setQuantity("");
    setReason("");
    onDirty(false);
    requestAnimationFrame(() => focus.current?.focus({ preventScroll: true }));
  }
  return (
    <section className="admin-card">
      <div className="admin-toolbar admin-panel-heading">
        <div>
          <h3>Control de stock</h3>
          <p className="admin-muted">
            Elegí un talle para agregar o quitar unidades físicas.
          </p>
        </div>
        <button
          type="button"
          className="admin-text-action"
          disabled={busy}
          onClick={() => void refresh()}
          aria-label="Actualizar cantidades de stock"
        >
          Actualizar
        </button>
      </div>
      <details className="admin-stock-help">
        <summary>¿Qué significa cada cantidad?</summary>
        <dl>
          <div>
            <dt>Físico</dt>
            <dd>Las unidades que tenés en la tienda.</dd>
          </div>
          <div>
            <dt>Reservado</dt>
            <dd>
              Unidades apartadas temporalmente por pedidos demo. No se editan a
              mano.
            </dd>
          </div>
          <div>
            <dt>Disponible</dt>
            <dd>
              Stock físico menos las unidades reservadas. El servidor comprueba
              el valor actual al guardar.
            </dd>
          </div>
        </dl>
      </details>
      {!data.variants.length ? (
        <div className="admin-empty">
          <h4>Todavía no hay talles y colores</h4>
          <p>Agregá al menos una combinación antes de cargar stock.</p>
          <a href={`#/admin/productos/${product.id}/talles`}>
            Agregar talles y colores →
          </a>
        </div>
      ) : (
        <>
          <label className="admin-color-picker">
            Color para consultar stock
            <select
              value={currentColor}
              onChange={(e) => {
                if (
                  (quantity || reason) &&
                  !window.confirm(
                    "¿Descartar este cambio de stock sin guardar?",
                  )
                )
                  return;
                setColor(e.target.value);
                setSelected("");
                setQuantity("");
                setReason("");
                onDirty(false);
              }}
            >
              {colors.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <div className="admin-stock-table">
            <div className="admin-stock-head" aria-hidden="true">
              <span>Talle</span>
              <span>Físico</span>
              <span>Reservado</span>
              <span>Disponible</span>
              <span>Acción</span>
            </div>
            {data.variants
              .filter((v) => v.color === currentColor)
              .map((v) => {
                const i = data.inventory.find((i) => i.variant_id === v.id);
                return (
                  <div
                    className={`admin-stock-row ${selected === v.id ? "selected" : ""}`}
                    key={v.id}
                  >
                    <strong>
                      {v.size}
                      {!v.active && <small>No disponible para la venta</small>}
                    </strong>
                    <span>
                      <span className="admin-sr-only">Stock físico: </span>
                      <small aria-hidden="true">Físico</small>
                      {i?.on_hand ?? "—"}
                    </span>
                    <span>
                      <span className="admin-sr-only">Reservado: </span>
                      <small aria-hidden="true">Reservado</small>
                      {i?.reserved ?? "—"}
                    </span>
                    <span>
                      <span className="admin-sr-only">Disponible: </span>
                      <small aria-hidden="true">Disponible</small>
                      {i ? i.on_hand - i.reserved : "—"}
                    </span>
                    <button
                      className="admin-text-action"
                      disabled={busy || Boolean(pending) || !i}
                      onClick={() => changeSelection(v.id)}
                      aria-label={`Actualizar stock ${v.color} talle ${v.size}`}
                    >
                      Actualizar
                    </button>
                  </div>
                );
              })}
          </div>
        </>
      )}
      {variant && inventory && (
        <form
          className="admin-stock-editor"
          onSubmit={(e) => {
            e.preventDefault();
            if (!result || reason.trim().length < 3) return;
            const a = {
              key: crypto.randomUUID(),
              variant: variant.id,
              delta: result.delta,
              reason: reason.trim(),
            };
            confirm({
              text: `${product.name} · ${variant.color} · talle ${variant.size}. ${action === "add" ? "Agregar" : "Quitar"} ${quantity} unidades. Stock físico esperado: ${result.physical}. Disponible esperado: ${result.available}. Se validan nuevamente las reservas al guardar.`,
              run: async () => {
                await onAdjust(a);
                setQuantity("");
                setReason("");
                onDirty(false);
                success("Stock actualizado correctamente.");
                await refresh();
                requestAnimationFrame(() =>
                  focus.current?.focus({ preventScroll: true }),
                );
              },
            });
          }}
        >
          <h4 ref={focus} tabIndex={-1}>
            {product.name} · {variant.color} · talle {variant.size}
          </h4>
          <dl className="admin-stock-numbers">
            <div>
              <dt>Físico actual</dt>
              <dd>{inventory.on_hand}</dd>
            </div>
            <div>
              <dt>Reservado</dt>
              <dd>{inventory.reserved}</dd>
            </div>
            <div>
              <dt>Disponible</dt>
              <dd>{inventory.on_hand - inventory.reserved}</dd>
            </div>
          </dl>
          <fieldset disabled={busy || Boolean(pending)}>
            <div className="admin-grid">
              <label>
                Qué querés hacer
                <select
                  value={action}
                  onChange={(e) => {
                    setAction(e.target.value);
                    onDirty(true);
                  }}
                >
                  <option value="add">Agregar stock</option>
                  <option value="remove">Quitar stock</option>
                </select>
              </label>
              <label>
                Cantidad de unidades
                <input
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min="1"
                  max="1000"
                  required
                  value={quantity}
                  onChange={(e) => {
                    setQuantity(e.target.value);
                    onDirty(true);
                  }}
                  aria-describedby="stock-result"
                />
              </label>
            </div>
            <label>
              Motivo del cambio
              <input
                aria-label="Motivo del cambio"
                aria-describedby="admin-stock-reason-help admin-stock-reason-error"
                aria-invalid={
                  (reason.length > 0 && reason.trim().length < 3) || undefined
                }
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  onDirty(true);
                }}
                minLength={3}
                maxLength={100}
                required
                placeholder="Ej.: Ingreso de prendas o recuento de depósito"
              />
              <span id="admin-stock-reason-help" className="admin-field-help">
                Queda registrado en el historial. No incluyas datos personales.
              </span>
              {reason.length > 0 && reason.trim().length < 3 && (
                <span
                  id="admin-stock-reason-error"
                  className="admin-field-help"
                  role="alert"
                >
                  Escribí al menos tres caracteres en el motivo.
                </span>
              )}
            </label>
            <p id="stock-result" className="admin-stock-result" role="status">
              {!quantity
                ? "Ingresá las unidades para revisar el resultado."
                : result
                  ? `Después del cambio: ${result.physical} físicas · ${inventory.reserved} reservadas · ${result.available} disponibles.`
                  : action === "remove" &&
                      Number(quantity) > inventory.on_hand - inventory.reserved
                    ? inventory.reserved > 0
                      ? "No podés quitar unidades reservadas. Reducí la cantidad."
                      : "No hay suficientes unidades físicas. Reducí la cantidad."
                    : "Ingresá una cantidad entera entre 1 y 1000, dentro del stock permitido."}
            </p>
            <button
              className="button primary"
              disabled={!result || reason.trim().length < 3}
            >
              Revisar cambio de stock
            </button>
          </fieldset>
        </form>
      )}
      <details className="admin-history">
        <summary>Historial de movimientos</summary>
        <p className="admin-muted">
          Últimos 30 movimientos de esta prenda
          {selected ? ", filtrados por el talle seleccionado" : ""}.
        </p>
        {history.length ? (
          <ol>
            {history.map((m) => {
              const v = data.variants.find((v) => v.id === m.variant_id);
              return (
                <li key={m.id}>
                  <div>
                    <strong>
                      {friendly(m.kind)} · {m.quantity > 0 ? "+" : ""}
                      {m.quantity} unidades
                    </strong>
                    <span>
                      {v?.color} · {v?.size}
                    </span>
                  </div>
                  <time dateTime={m.created_at}>{date(m.created_at)}</time>
                  {m.reason && <p>{m.reason}</p>}
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="admin-empty">
            <p>No hay movimientos para esta selección.</p>
          </div>
        )}
      </details>
    </section>
  );
}
