import { useEffect, useRef, useState } from "react";
import {
  isDialogBackdrop,
  trapModalFocus,
  useModalDialog,
} from "../../components/useModalDialog";
import { Photo } from "../../components/Photo";
import { formatARS, productHref } from "../catalog/model";
import { useCart } from "./context";
import { MAX_LINES, MAX_QUANTITY, type CartEntry } from "./model";

export function CartTrigger({ beforeOpen }: { beforeOpen(): void }) {
  const cart = useCart();
  return (
    <button
      className="cart-trigger"
      aria-label={`Abrir carrito, ${cart.units} ${cart.units === 1 ? "unidad" : "unidades"}`}
      aria-haspopup="dialog"
      aria-expanded={cart.open}
      aria-controls="vanta-cart"
      onClick={() => {
        beforeOpen();
        cart.openCart();
      }}
    >
      <svg
        width="23"
        height="25"
        viewBox="0 0 24 26"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        aria-hidden="true"
      >
        <path d="M4 8h16l1 16H3L4 8Z" />
        <path d="M8 9V6a4 4 0 0 1 8 0v3" />
      </svg>
      <span className="cart-trigger-label">Carrito</span>
      {cart.units > 0 && (
        <span className="cart-count" aria-hidden="true">
          {cart.units}
        </span>
      )}
    </button>
  );
}
function CartItem({
  entry,
  onNavigate,
}: {
  entry: CartEntry;
  onNavigate(): void;
}) {
  const cart = useCart();
  const { line, product, variant, status } = entry;
  const name = product?.name ?? "Prenda por verificar";
  const ready = status === "ready" && product && variant;
  const verifying = status === "loading" && Boolean(product && variant);
  const image = product?.images[0];
  return (
    <li className="cart-item">
      <div className="cart-item-photo">
        <Photo
          key={`${image?.id}/${image?.url}`}
          image={image}
          service={cart.service}
          allowRetry
        />
      </div>
      <div className="cart-item-copy">
        <h3>
          {product ? (
            <a href={productHref(product.slug)} onClick={onNavigate}>
              {name}
            </a>
          ) : (
            name
          )}
        </h3>
        {variant && (
          <p className="cart-variant">
            Talle {variant.size} <span aria-hidden="true">/</span>{" "}
            {variant.color}
          </p>
        )}
        {ready || verifying ? (
          <>
            <p className="cart-unit-price">
              {ready ? (
                <>
                  {formatARS(product.price_cents)} ARS <span>/ unidad</span>
                </>
              ) : (
                <>
                  Verificando precio…
                  <span className="sr-only">Verificando prenda y precio…</span>
                </>
              )}
            </p>
            <p className="cart-stock">Stock por confirmar</p>
          </>
        ) : (
          <p className="cart-line-notice">
            {status === "loading"
              ? "Verificando prenda y precio…"
              : status === "error"
                ? "No pudimos consultar el catálogo. Revisá tu conexión."
                : "Producto o variante sin disponibilidad publicada. Revisá la ficha o eliminá el artículo."}
          </p>
        )}
        <div className="cart-item-actions">
          <div
            className="cart-quantity"
            role="group"
            aria-label={`Cantidad de ${name}${variant ? `, ${variant.color}, ${variant.size}` : ""}`}
          >
            <button
              aria-label={`Disminuir cantidad de ${name}`}
              disabled={line.quantity <= 1}
              onClick={() =>
                cart.setQuantity(line.variantId, line.quantity - 1)
              }
            >
              −
            </button>
            <span aria-live="polite" aria-atomic="true">
              {line.quantity}
            </span>
            <button
              aria-label={`Aumentar cantidad de ${name}`}
              disabled={line.quantity >= MAX_QUANTITY}
              onClick={() =>
                cart.setQuantity(line.variantId, line.quantity + 1)
              }
            >
              +
            </button>
          </div>
          <button
            className="cart-text-button"
            aria-label={`Eliminar ${name}${variant ? `, ${variant.color}, ${variant.size}` : ""}`}
            onClick={cart.remove.bind(null, line.variantId)}
          >
            Eliminar
          </button>
        </div>
        {(ready || verifying) && (
          <p className="cart-subtotal">
            Subtotal{" "}
            <strong>
              {ready
                ? `${formatARS(product.price_cents * line.quantity)} ARS`
                : "Por confirmar"}
            </strong>
          </p>
        )}
      </div>
    </li>
  );
}
export function CartDrawer() {
  const cart = useCart();
  const { dialog, initialFocus: close } = useModalDialog(cart.open);
  const clearButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const restoreClearFocus = useRef(false);
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    if (confirmClear) cancelButton.current?.focus();
    else if (restoreClearFocus.current) {
      clearButton.current?.focus();
      restoreClearFocus.current = false;
    }
  }, [confirmClear]);
  function dismiss() {
    setConfirmClear(false);
    cart.closeCart();
  }
  function cancelClear() {
    restoreClearFocus.current = true;
    setConfirmClear(false);
  }
  return (
    <dialog
      ref={dialog}
      id="vanta-cart"
      className="cart-drawer"
      aria-labelledby="cart-title"
      aria-describedby="cart-disclaimer"
      onKeyDown={trapModalFocus}
      onCancel={(event) => {
        event.preventDefault();
        if (confirmClear) cancelClear();
        else dismiss();
      }}
      onClick={(event) => {
        if (isDialogBackdrop(event)) dismiss();
      }}
    >
      <header className="cart-heading">
        <div>
          <p className="eyebrow">TU SELECCIÓN / VANTA</p>
          <h2 id="cart-title">
            Tu carrito
            <span className="heading-dot" aria-hidden="true">
              .
            </span>
          </h2>
          <p className="muted small">
            {cart.units} {cart.units === 1 ? "unidad" : "unidades"}
          </p>
        </div>
        <button
          ref={close}
          className="cart-close"
          aria-label="Cerrar carrito"
          onClick={dismiss}
        >
          ×
        </button>
      </header>
      <div className="cart-scroll">
        {cart.warning && (
          <p className="cart-notice" role="alert">
            {cart.warning}
          </p>
        )}
        {cart.entries.length === 0 ? (
          <div className="cart-empty">
            <span aria-hidden="true">V.</span>
            <h3>Tu próxima selección empieza acá.</h3>
            <p className="muted">Todavía no agregaste prendas a tu carrito.</p>
            <a className="button secondary" href="#/catalogo" onClick={dismiss}>
              Explorar la colección
            </a>
          </div>
        ) : (
          <>
            <ul className="cart-items" aria-label="Prendas en tu carrito">
              {cart.entries.map((entry) => (
                <CartItem
                  key={entry.line.variantId}
                  entry={entry}
                  onNavigate={dismiss}
                />
              ))}
            </ul>
            {cart.entries.some(
              (entry) =>
                entry.status === "error" || entry.status === "unavailable",
            ) && (
              <button
                className="button secondary cart-retry"
                onClick={cart.refresh}
              >
                Volver a verificar catálogo
              </button>
            )}
            <p className="cart-limits muted small">
              Límite de {MAX_QUANTITY} unidades por variante y {MAX_LINES}{" "}
              variantes. Estos límites no representan stock disponible.
            </p>
            {confirmClear ? (
              <div
                className="cart-clear-confirm"
                role="group"
                aria-label="Confirmar vaciar carrito"
              >
                <p>¿Eliminar todas las prendas del carrito?</p>
                <button
                  className="cart-text-button"
                  onClick={() => {
                    cart.clear();
                    setConfirmClear(false);
                    close.current?.focus();
                  }}
                >
                  Sí, vaciar
                </button>
                <button
                  ref={cancelButton}
                  className="cart-text-button"
                  onClick={cancelClear}
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                ref={clearButton}
                className="cart-text-button cart-clear"
                onClick={() => setConfirmClear(true)}
              >
                Vaciar carrito
              </button>
            )}
          </>
        )}
      </div>
      <footer className="cart-summary">
        <div className="cart-total" aria-live="polite" aria-atomic="true">
          <span>
            Total <small>ARS</small>
          </span>
          <strong>
            {cart.total === null ? "Por confirmar" : formatARS(cart.total)}
          </strong>
        </div>
        <p id="cart-disclaimer" className="muted small">
          Stock por confirmar. Los precios se consultan en el catálogo; no se
          reserva inventario.
        </p>
        <button className="button primary" disabled>
          Continuar compra — próximamente
        </button>
        <p className="cart-future muted small">
          El carrito prepara tu selección. Las compras todavía no están
          habilitadas.
        </p>
      </footer>
    </dialog>
  );
}
