import { productTitle } from "../catalog/presentation";
import { useEffect, useRef, useState } from "react";
import { Photo } from "../../components/Photo";
import { useAnyModalOpen } from "../../components/useAnyModalOpen";
import { formatARS } from "../catalog/model";
import { useCart } from "./context";

function Bag() {
  return (
    <svg
      width="22"
      height="24"
      viewBox="0 0 24 26"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <path d="M4 8h16l1 16H3L4 8Z" />
      <path d="M8 9V6a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
export function CartFeedback({
  suspendFloating = false,
}: {
  suspendFloating?: boolean;
}) {
  const cart = useCart();
  const modalOpen = useAnyModalOpen();
  const toast = useRef<HTMLElement>(null);
  const [paused, setPaused] = useState(false);
  const hovered = useRef(false);
  const notice = cart.notice;
  useEffect(() => {
    if (!notice) {
      hovered.current = false;
      setPaused(false);
    }
  }, [notice]);
  useEffect(() => {
    if (!notice || paused || modalOpen) return;
    const timer = window.setTimeout(cart.dismissNotice, 4000);
    return () => window.clearTimeout(timer);
  }, [notice, paused, modalOpen, cart.dismissNotice]);
  // Keep the node (and its focus) stable when consecutive additions replace the contents.
  function dismiss() {
    if (toast.current?.contains(document.activeElement))
      document
        .querySelector<HTMLButtonElement>(".cart-trigger")
        ?.focus({ preventScroll: true });
    hovered.current = false;
    setPaused(false);
    cart.dismissNotice();
  }
  return (
    <>
      {notice && (
        <section
          ref={toast}
          className="cart-toast"
          aria-label="Producto agregado"
          hidden={modalOpen}
          onMouseEnter={() => {
            hovered.current = true;
            setPaused(true);
          }}
          onMouseLeave={() => {
            hovered.current = false;
            if (!toast.current?.contains(document.activeElement))
              setPaused(false);
          }}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget) &&
              !hovered.current
            )
              setPaused(false);
          }}
        >
          <div className="cart-toast-photo">
            <Photo
              image={notice.product.images[0]}
              service={cart.service}
              profile="thumb"
              eager
            />
          </div>
          <div className="cart-toast-copy">
            <div role="status" aria-atomic="true">
              <p className="cart-toast-confirm">
                <span aria-hidden="true">✓</span> Prenda agregada al carrito.
              </p>
              <p className="cart-toast-name">
                {productTitle(notice.product.name)}
              </p>
              <p>
                Talle {notice.variant.size} / {notice.variant.color} ·{" "}
                {notice.quantity}{" "}
                {notice.quantity === 1
                  ? "unidad agregada"
                  : "unidades agregadas"}
              </p>
            </div>
            <button className="cart-text-button" onClick={cart.openCart}>
              Ver carrito
            </button>
          </div>
          <button
            className="cart-toast-close"
            aria-label="Cerrar notificación"
            onClick={dismiss}
          >
            ×
          </button>
        </section>
      )}
      {cart.units > 0 && !suspendFloating && (
        <>
          <div className="cart-mobile-space" aria-hidden="true" />
          <button
            className="mobile-cart-bar"
            hidden={modalOpen || Boolean(notice)}
            onClick={cart.openCart}
            aria-label={`Ver carrito, ${cart.units} ${cart.units === 1 ? "unidad" : "unidades"}, ${cart.total === null ? "importe por confirmar" : formatARS(cart.total) + " ARS"}`}
            aria-haspopup="dialog"
            aria-controls="vanta-cart"
          >
            <Bag />
            <span>
              {cart.units} {cart.units === 1 ? "unidad" : "unidades"}
              <small>Ver carrito</small>
            </span>
            <strong>
              {cart.total === null ? "Por confirmar" : formatARS(cart.total)}
              <small>ARS</small>
            </strong>
          </button>
        </>
      )}
    </>
  );
}
