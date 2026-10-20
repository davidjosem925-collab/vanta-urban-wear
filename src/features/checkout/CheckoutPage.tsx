import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Photo } from "../../components/Photo";
import { useCart } from "../cart/context";
import { formatARS, productHref } from "../catalog/model";
import {
  changeDelivery,
  paymentNames,
  provinces,
  shippingNotice,
  validateDraft,
  type CheckoutDraft,
  type Errors,
  type Field,
} from "./model";

export type CheckoutStep = "details" | "review" | "complete";
type Props = {
  step: CheckoutStep;
  draft: CheckoutDraft;
  setDraft: Dispatch<SetStateAction<CheckoutDraft>>;
  completed: boolean;
  onComplete(): void;
};
export function CheckoutPage({
  step,
  draft,
  setDraft,
  completed,
  onComplete,
}: Props) {
  const cart = useCart();
  const [errors, setErrors] = useState<Errors>({});
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const firstError = useRef<HTMLDivElement>(null);
  // Same provider/revalidation as the drawer; never hydrate a separate checkout cart.
  const { refresh } = cart;
  useEffect(() => {
    refresh();
  }, [step, refresh]);
  const valid = Object.keys(validateDraft(draft)).length === 0;
  const ready =
    cart.entries.length > 0 &&
    cart.total !== null &&
    cart.entries.every((e) => e.status === "ready");
  const finished = step === "complete" && completed;
  function submit(event: FormEvent) {
    event.preventDefault();
    const next = validateDraft(draft);
    setErrors(next);
    if (Object.keys(next).length) {
      requestAnimationFrame(() => {
        const first = Object.keys(next)[0];
        document.getElementById(`checkout-${first}`)?.focus();
        if (first === "payment" || first === "delivery")
          firstError.current?.focus();
      });
      return;
    }
    if (ready) window.location.hash = "/checkout/revision";
  }
  function field(
    name: Field,
    label: string,
    autoComplete: string,
    maxLength: number,
    type = "text",
    optional = false,
  ) {
    return (
      <div
        className={`checkout-field ${name === "email" || name === "instructions" ? "checkout-wide" : ""}`}
      >
        <label htmlFor={`checkout-${name}`}>
          {label}
          {optional && <span> (opcional)</span>}
        </label>
        <input
          id={`checkout-${name}`}
          name={name}
          type={type}
          autoComplete={autoComplete}
          maxLength={maxLength}
          required={!optional}
          value={draft[name]}
          inputMode={
            type === "tel" ? "tel" : name === "postalCode" ? "text" : undefined
          }
          aria-invalid={Boolean(errors[name])}
          aria-describedby={errors[name] ? `error-${name}` : undefined}
          onChange={(event) => {
            setDraft((d) => ({ ...d, [name]: event.target.value }));
            setErrors((e) => ({ ...e, [name]: undefined }));
          }}
        />
        {errors[name] && (
          <p className="checkout-error" id={`error-${name}`}>
            {errors[name]}
          </p>
        )}
      </div>
    );
  }
  function chooseDelivery(value: "shipping" | "pickup") {
    setDeliveryMessage(
      value === "shipping" && draft.payment === "cash"
        ? "Efectivo solo está disponible para retiro. Elegí otro método de pago simulado."
        : "",
    );
    setDraft((d) => changeDelivery(d, value));
    setErrors((e) => ({ ...e, delivery: undefined, payment: undefined }));
  }
  return (
    <section
      className="checkout section-shell"
      aria-labelledby="checkout-title"
    >
      <nav className="breadcrumb" aria-label="Ruta de navegación">
        <a href="#/">Inicio</a>
        <span aria-hidden="true">/</span>
        <a href="#/catalogo">Colección</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Checkout demo</span>
      </nav>
      <p className="eyebrow">VANTA / TU SELECCIÓN</p>
      <h1 id="checkout-title">
        {finished ? "Recorrido completado." : "Checkout de demostración"}
      </h1>
      <p className="checkout-intro">
        Una experiencia para explorar. Sin cobros, pedidos comerciales ni
        reservas de stock.
      </p>
      {finished ? (
        <div className="checkout-finished">
          <span className="checkout-check" aria-hidden="true">
            ✓
          </span>
          <h2>Recorrido de compra completado.</h2>
          <p>
            Esta es una demostración de VANTA Urban Wear. No se realizó ningún
            cobro ni se registró un pedido real.
          </p>
          <p>
            Tu selección sigue en el carrito. No se enviaron correos ni
            mensajes.
          </p>
          <div className="checkout-actions">
            <a className="button primary" href="#/catalogo">
              Volver a la colección
            </a>
            <button className="button secondary" onClick={cart.openCart}>
              Revisar selección
            </button>
          </div>
        </div>
      ) : cart.entries.length === 0 ? (
        <div className="checkout-empty">
          <h2>Tu selección está vacía.</h2>
          <p>Agregá una prenda para recorrer el checkout de demostración.</p>
          <a className="button primary" href="#/catalogo">
            Explorar la colección
          </a>
        </div>
      ) : (
        <>
          <ol className="checkout-steps" aria-label="Pasos del checkout">
            <li aria-current={step === "details" ? "step" : undefined}>
              <a href="#/checkout">01 · Tus datos</a>
            </li>
            <li aria-current={step === "review" ? "step" : undefined}>
              {valid ? (
                <a href="#/checkout/revision">02 · Revisión</a>
              ) : (
                <span>02 · Revisión</span>
              )}
            </li>
            <li>
              <span>03 · Finalización demo</span>
            </li>
          </ol>
          <div className="checkout-demo-note">
            <p>
              Usá datos ficticios. Los datos del formulario se conservan solo en
              memoria durante esta visita y se pierden al recargar.
            </p>
          </div>
          {step === "complete" && !completed && valid && (
            <div className="checkout-notice" role="status">
              <p>Revisá tu selección antes de finalizar la demostración.</p>
              <a className="button secondary" href="#/checkout/revision">
                Volver a la revisión
              </a>
            </div>
          )}
          {step !== "details" && !valid && (
            <div className="checkout-notice" role="status">
              <p>
                Completá tus datos, entrega y método simulado antes de revisar o
                finalizar.
              </p>
              <a className="button secondary" href="#/checkout">
                Volver a tus datos
              </a>
            </div>
          )}
          {!ready && (
            <div className="checkout-notice" role="status">
              <p>
                {cart.entries.some((e) => e.status === "loading")
                  ? "Verificando la selección y los precios del catálogo…"
                  : "No pudimos verificar toda la selección. Revisá las prendas o reintentá antes de continuar."}
              </p>
              <button className="cart-text-button" onClick={cart.refresh}>
                Reintentar verificación
              </button>
              <button className="cart-text-button" onClick={cart.openCart}>
                Revisar carrito
              </button>
            </div>
          )}
          <div className="checkout-grid">
            <div className="checkout-content">
              {step === "details" ? (
                <form id="checkout-details" onSubmit={submit} noValidate>
                  {Object.values(errors).some(Boolean) && (
                    <div
                      ref={firstError}
                      tabIndex={-1}
                      className="checkout-error-summary"
                      role="alert"
                    >
                      Revisá los campos señalados para continuar.
                    </div>
                  )}
                  <fieldset>
                    <legend>01 / Datos de contacto</legend>
                    <div className="checkout-fields">
                      {field("firstName", "Nombre", "given-name", 60)}
                      {field("lastName", "Apellido", "family-name", 60)}
                      {field(
                        "email",
                        "Correo electrónico",
                        "email",
                        254,
                        "email",
                      )}
                      {field("phone", "Teléfono de contacto", "tel", 40, "tel")}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend>02 / Entrega</legend>
                    <div className="checkout-choices">
                      <label
                        className={
                          draft.delivery === "shipping" ? "is-selected" : ""
                        }
                      >
                        <input
                          type="radio"
                          name="delivery"
                          checked={draft.delivery === "shipping"}
                          onChange={() => chooseDelivery("shipping")}
                        />
                        <span>
                          Envío a domicilio
                          <small>A coordinar · Sin tarifa cotizada</small>
                        </span>
                      </label>
                      <label
                        className={
                          draft.delivery === "pickup" ? "is-selected" : ""
                        }
                      >
                        <input
                          type="radio"
                          name="delivery"
                          checked={draft.delivery === "pickup"}
                          onChange={() => chooseDelivery("pickup")}
                        />
                        <span>
                          Retiro en local ficticio
                          <small>Demostración · Sin costo</small>
                        </span>
                      </label>
                    </div>
                    {draft.delivery === "shipping" ? (
                      <>
                        <p className="checkout-help">{shippingNotice}</p>
                        <div className="checkout-fields">
                          <div className="checkout-field">
                            <label htmlFor="checkout-province">Provincia</label>
                            <select
                              id="checkout-province"
                              autoComplete="address-level1"
                              value={draft.province}
                              required
                              aria-invalid={Boolean(errors.province)}
                              aria-describedby={
                                errors.province ? "error-province" : undefined
                              }
                              onChange={(event) => {
                                setDraft((d) => ({
                                  ...d,
                                  province: event.target.value,
                                }));
                                setErrors((e) => ({
                                  ...e,
                                  province: undefined,
                                }));
                              }}
                            >
                              <option value="">Seleccioná una provincia</option>
                              {provinces.map((p) => (
                                <option key={p}>{p}</option>
                              ))}
                            </select>
                            {errors.province && (
                              <p className="checkout-error" id="error-province">
                                {errors.province}
                              </p>
                            )}
                          </div>
                          {field("city", "Localidad", "address-level2", 80)}
                          {field(
                            "postalCode",
                            "Código postal",
                            "postal-code",
                            8,
                          )}
                          {field("street", "Calle", "address-line1", 100)}
                          {field("streetNumber", "Altura", "off", 7)}
                          {field(
                            "apartment",
                            "Piso/departamento",
                            "address-line2",
                            40,
                            "text",
                            true,
                          )}
                          <div className="checkout-field checkout-wide">
                            <label htmlFor="checkout-instructions">
                              Indicaciones para la entrega (opcional)
                            </label>
                            <textarea
                              id="checkout-instructions"
                              maxLength={300}
                              autoComplete="off"
                              value={draft.instructions}
                              aria-invalid={Boolean(errors.instructions)}
                              aria-describedby={
                                errors.instructions
                                  ? "error-instructions"
                                  : undefined
                              }
                              onChange={(event) => {
                                setDraft((d) => ({
                                  ...d,
                                  instructions: event.target.value,
                                }));
                                setErrors((e) => ({
                                  ...e,
                                  instructions: undefined,
                                }));
                              }}
                            />
                            {errors.instructions && (
                              <p
                                className="checkout-error"
                                id="error-instructions"
                              >
                                {errors.instructions}
                              </p>
                            )}
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="checkout-help">
                        Retiro sin costo en un local ficticio, exclusivamente de
                        demostración. No hay una dirección ni horarios
                        comerciales reales.
                      </p>
                    )}
                  </fieldset>
                  <fieldset
                    aria-describedby={
                      errors.payment
                        ? "error-payment payment-help"
                        : "payment-help"
                    }
                    aria-invalid={Boolean(errors.payment)}
                  >
                    <legend>03 / Pago simulado</legend>
                    <p className="checkout-help" id="payment-help">
                      Solo una selección visual. No se abrirán pasarelas, no se
                      solicitarán datos financieros ni comprobantes.
                    </p>
                    <div className="checkout-choices">
                      {(["mercado_pago", "transfer", "cash"] as const).map(
                        (method) => (
                          <label
                            key={method}
                            className={`${draft.payment === method ? "is-selected" : ""} ${method === "cash" && draft.delivery !== "pickup" ? "is-unavailable" : ""}`}
                          >
                            <input
                              type="radio"
                              name="payment"
                              value={method}
                              checked={draft.payment === method}
                              disabled={
                                method === "cash" && draft.delivery !== "pickup"
                              }
                              onChange={() => {
                                setDraft((d) => ({ ...d, payment: method }));
                                setDeliveryMessage("");
                                setErrors((e) => ({
                                  ...e,
                                  payment: undefined,
                                }));
                              }}
                            />
                            <span>
                              {paymentNames[method]}
                              <small>
                                {method === "cash"
                                  ? "Exclusivo para retiro en local ficticio"
                                  : "Simulado · Sin cobro"}
                              </small>
                            </span>
                          </label>
                        ),
                      )}
                    </div>
                    {deliveryMessage && (
                      <p role="status" className="checkout-help">
                        {deliveryMessage}
                      </p>
                    )}
                    {errors.payment && (
                      <p id="error-payment" className="checkout-error">
                        {errors.payment}
                      </p>
                    )}
                  </fieldset>
                </form>
              ) : valid && step === "review" ? (
                <div className="checkout-review">
                  <div className="checkout-section-heading">
                    <h2>Todo en su lugar.</h2>
                    <a className="cart-text-button" href="#/checkout">
                      Editar información
                    </a>
                  </div>
                  <section>
                    <h3>Contacto</h3>
                    <p>
                      {draft.firstName} {draft.lastName}
                    </p>
                    <p>{draft.email}</p>
                    <p>{draft.phone}</p>
                  </section>
                  <section>
                    <h3>Entrega</h3>
                    {draft.delivery === "pickup" ? (
                      <p>Retiro en local ficticio · Demostración · Sin costo</p>
                    ) : (
                      <>
                        <p>
                          {draft.street} {draft.streetNumber}
                          {draft.apartment.trim() && ` · ${draft.apartment}`}
                        </p>
                        <p>
                          {draft.postalCode} · {draft.city} · {draft.province}
                        </p>
                        {draft.instructions.trim() && (
                          <p>{draft.instructions}</p>
                        )}
                        <p>{shippingNotice}</p>
                      </>
                    )}
                  </section>
                  <section>
                    <h3>Método simulado</h3>
                    <p>{paymentNames[draft.payment]}</p>
                    <p>No se realizará ningún cobro.</p>
                  </section>
                </div>
              ) : null}
            </div>
            <aside
              className="checkout-summary"
              aria-label="Resumen de la selección"
            >
              <details open>
                <summary>
                  Tu selección{" "}
                  <span>
                    {cart.units} {cart.units === 1 ? "unidad" : "unidades"}
                  </span>
                </summary>
                <ul>
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
                <button className="cart-text-button" onClick={cart.openCart}>
                  Modificar carrito
                </button>
              </details>
              <div className="checkout-total">
                <span>
                  Subtotal <small>ARS</small>
                </span>
                <strong>
                  {cart.total === null
                    ? "Por confirmar"
                    : formatARS(cart.total)}
                </strong>
              </div>
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
          </div>
          <div className="checkout-actions">
            {step === "details" ? (
              <button
                className="button primary"
                form="checkout-details"
                type="submit"
                disabled={!ready}
              >
                Revisar demostración
              </button>
            ) : step === "review" && valid ? (
              <button
                className="button primary"
                disabled={!ready || !valid}
                onClick={() => {
                  if (!ready || !valid) return;
                  onComplete();
                  window.location.hash = "/checkout/finalizado";
                }}
              >
                Finalizar demostración
              </button>
            ) : null}
            <button className="button secondary" onClick={cart.openCart}>
              Volver al carrito
            </button>
            <a className="cart-text-button" href="#/catalogo">
              Seguir explorando
            </a>
          </div>
        </>
      )}
    </section>
  );
}
