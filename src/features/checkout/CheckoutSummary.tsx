import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Photo } from "../../components/Photo";
import { useCart } from "../cart/context";
import { formatARS, productHref } from "../catalog/model";
import { paymentNames, shippingNotice, type CheckoutDraft } from "./model";

const mobileQuery = "(max-width: 767px)";
function subscribe(listener: () => void) {
  const media = window.matchMedia?.(mobileQuery);
  media?.addEventListener("change", listener);
  return () => media?.removeEventListener("change", listener);
}
function isMobile() {
  return window.matchMedia?.(mobileQuery).matches ?? false;
}

/** Only disclosure state lives here. Products, quantities and amounts stay in CartProvider. */
export function CheckoutSummary({ draft }: { draft: CheckoutDraft }) {
  const cart = useCart();
  const mobile = useSyncExternalStore(subscribe, isMobile, () => false);
  const [expanded, setExpanded] = useState(!mobile);
  const productsId = useId();
  useEffect(() => {
    setExpanded(!mobile);
  }, [mobile]);
  const units = (
    <span>
      {cart.units} {cart.units === 1 ? "unidad" : "unidades"}
    </span>
  );
  const modify = (
    <button className="cart-text-button" onClick={cart.openCart}>
      Modificar carrito
    </button>
  );
  const total = (
    <div className="checkout-total">
      <span>
        Subtotal <small>ARS</small>
      </span>
      <strong>
        {cart.total === null ? "Por confirmar" : formatARS(cart.total)}
      </strong>
    </div>
  );
  return (
    <aside className="checkout-summary" aria-label="Resumen de la selección">
      {mobile && (
        <div className="checkout-summary-heading">
          <h2>Tu selección</h2>
          {units}
        </div>
      )}
      {mobile && total}
      <details
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary aria-expanded={expanded} aria-controls={productsId}>
          {mobile ? (
            expanded ? (
              "Ocultar productos"
            ) : (
              "Ver productos"
            )
          ) : (
            <>Tu selección{units}</>
          )}
        </summary>
        <ul id={productsId}>
          {cart.entries.map((entry) => (
            <li key={entry.line.variantId}>
              <div className="checkout-photo">
                <Photo
                  image={entry.product?.images[0]}
                  profile="thumb"
                  service={cart.service}
                  allowRetry
                />
              </div>
              <div>
                <h3>
                  {entry.product ? (
                    <a href={productHref(entry.product.slug)}>
                      {entry.product.name}
                    </a>
                  ) : (
                    "Prenda por verificar"
                  )}
                </h3>
                <p>
                  {entry.variant
                    ? `Talle ${entry.variant.size} / ${entry.variant.color}`
                    : "Variante por verificar"}
                </p>
                <p>Cantidad: {entry.line.quantity}</p>
                <p>
                  {entry.status === "ready" && entry.product
                    ? `${formatARS(entry.product.price_cents)} ARS / unidad`
                    : "Precio por confirmar"}
                </p>
                <p className="checkout-line-subtotal">
                  Subtotal:{" "}
                  {entry.status === "ready" && entry.product
                    ? `${formatARS(entry.product.price_cents * entry.line.quantity)} ARS`
                    : "Por confirmar"}
                </p>
              </div>
            </li>
          ))}
        </ul>
        {!mobile && modify}
      </details>
      {mobile && modify}
      {!mobile && total}
      <dl className="checkout-summary-meta">
        <div>
          <dt>Entrega</dt>
          <dd>
            {draft.delivery === "pickup"
              ? "Retiro ficticio · Sin costo"
              : "Envío a coordinar"}
          </dd>
        </div>
        <div>
          <dt>Pago simulado</dt>
          <dd>{paymentNames[draft.payment]}</dd>
        </div>
      </dl>
      <p className="checkout-help">
        {draft.delivery === "shipping"
          ? shippingNotice
          : "Retiro en local ficticio sin costo."}
      </p>
      <p className="checkout-help">
        Stock por confirmar. No se reserva inventario. El subtotal es
        orientativo, no una cotización definitiva.
      </p>
    </aside>
  );
}
