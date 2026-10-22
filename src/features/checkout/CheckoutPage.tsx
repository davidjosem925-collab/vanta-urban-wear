import {
  useEffect,
  useRef,
  useCallback,
  useState,
  type FormEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import { normalizeNotificationEmail } from "../orders/notificationEmail";
import { CheckoutSummary } from "./CheckoutSummary";
import { useCart } from "../cart/context";
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

import { OrderChallenge } from "../orders/OrderChallenge";
import { formatARS } from "../catalog/model";
import type { OrderService, Receipt, OrderPayload } from "../orders/service";
import type { useDemoOrder } from "../orders/useDemoOrder";

export type CheckoutStep = "details" | "review" | "complete";
type Props = {
  paymentsEnabled?: boolean;
  paymentSession?: boolean;
  step: CheckoutStep;
  draft: CheckoutDraft;
  setDraft: Dispatch<SetStateAction<CheckoutDraft>>;
  completed: boolean;
  onComplete(): void;
  orders: OrderService;
  orderFlow: ReturnType<typeof useDemoOrder>;
  orderReceipt: Receipt | null;
};
export function CheckoutPage({
  paymentsEnabled = false,
  paymentSession = false,
  step,
  draft,
  setDraft,
  completed,
  onComplete,
  orders,
  orderFlow,
  orderReceipt,
}: Props) {
  const cart = useCart();
  const [challenge, setChallenge] = useState("");
  const [challengeRevision, setChallengeRevision] = useState(0);
  const acceptToken = useCallback((token: string) => setChallenge(token), []);
  const payload = (): OrderPayload => ({
    items: cart.entries
      .map((e) => ({
        variant_id: e.line.variantId,
        quantity: e.line.quantity,
        expected_price_cents: e.product!.price_cents,
      }))
      .sort((a, b) => a.variant_id.localeCompare(b.variant_id)),
    delivery: draft.delivery,
    payment: draft.payment as OrderPayload["payment"],
  });
  const [errors, setErrors] = useState<Errors>({});
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const firstError = useRef<HTMLDivElement>(null);
  // Same provider/revalidation as the drawer; never hydrate a separate checkout cart.
  const { refresh } = cart;
  useEffect(() => {
    refresh();
  }, [step, refresh]);
  let emailValid = true;
  if (orders.notificationsEnabled) {
    try {
      normalizeNotificationEmail(draft.email);
    } catch {
      emailValid = false;
    }
  }
  const valid = Object.keys(validateDraft(draft)).length === 0 && emailValid;
  const ready =
    cart.entries.length > 0 &&
    cart.total !== null &&
    cart.entries.every((e) => e.status === "ready");
  const finished = step === "complete" && completed;
  function submit(event: FormEvent) {
    event.preventDefault();
    const next = validateDraft(draft);
    if (orders.notificationsEnabled) {
      try {
        normalizeNotificationEmail(draft.email);
      } catch {
        next.email =
          "Ingresá un correo válido para las notificaciones de prueba.";
      }
    }
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
      aria-busy={orderFlow.pending}
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
        {orders.enabled
          ? "Demostración sin cobros ni pedidos comerciales. Las reservas de stock de demo duran 60 minutos."
          : "Una experiencia para explorar. Sin cobros, pedidos comerciales ni reservas de stock."}
      </p>
      {paymentsEnabled && paymentSession && (
        <div className="checkout-notice">
          <p>
            Ya hay un pedido de esta pestaña. Consultá su pago antes de crear
            otra reserva.
          </p>
          <a className="button secondary" href="#/checkout/pago">
            Consultar mi pago
          </a>
        </div>
      )}
      {orders.enabled && !finished && orderFlow.error && (
        <div className="checkout-notice" role="alert">
          <p>{orderFlow.error}</p>
          <button
            className="cart-text-button"
            onClick={() => {
              cart.refresh();
              cart.openCart();
            }}
          >
            Revisar carrito
          </button>
        </div>
      )}
      {orders.enabled && !finished && orderFlow.notice && (
        <div className="checkout-notice" role="status">
          <p>{orderFlow.notice}</p>
          <a
            className="cart-text-button"
            href={valid ? "#/checkout/revision" : "#/checkout"}
          >
            Volver a la revisión
          </a>
        </div>
      )}
      {orders.enabled && !finished && orderFlow.recoverable && (
        <div className="checkout-notice">
          <p>
            Hay un intento pendiente de consultar. Recuperá su resultado antes
            de confirmar otra selección.
          </p>
          <button
            className="button secondary"
            disabled={orderFlow.pending}
            onClick={() => void orderFlow.recover()}
          >
            Consultar confirmación pendiente
          </button>
        </div>
      )}
      {orderFlow.pending && (
        <p role="status">
          Confirmando con el servidor… No cierres esta pestaña.
        </p>
      )}
      {finished ? (
        <div className="checkout-finished">
          <span className="checkout-check" aria-hidden="true">
            ✓
          </span>
          <h2>
            {orderReceipt
              ? "Pedido demo registrado."
              : "Recorrido de compra completado."}
          </h2>
          {orderReceipt && (
            <div role="status">
              <p>
                Referencia:{" "}
                <strong style={{ overflowWrap: "anywhere" }}>
                  {orderReceipt.reference}
                </strong>
              </p>
              <p>Subtotal: {formatARS(orderReceipt.subtotal_cents)} ARS</p>
              <p>
                Reserva de demostración por 60 minutos desde la creación en el
                servidor. Vence:{" "}
                {new Date(orderReceipt.expires_at).toLocaleString("es-AR")}.
              </p>
              <p>
                {orderReceipt.email_requested
                  ? "Se guardaron el detalle del pedido y tu correo cifrado para sus notificaciones."
                  : "Solo los datos anonimizados de este pedido se guardaron."}{" "}
                Las prendas registradas se retiraron del carrito.
              </p>
            </div>
          )}
          <p>
            {orderReceipt
              ? "Este pedido de demostración quedó registrado. No es una operación comercial y no se realizó ningún cobro."
              : "Esta es una demostración de VANTA Urban Wear. No se realizó ningún cobro ni se registró un pedido real."}
          </p>
          <p>
            {orderReceipt
              ? orderReceipt.email_requested
                ? "Solicitamos el envío de las novedades por correo. La entrega puede demorar; no es una confirmación de pago ni un comprobante fiscal."
                : "No se enviaron correos ni mensajes. No se realizó ningún cobro."
              : "Tu selección sigue en el carrito. No se enviaron correos ni mensajes."}
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
              {orders.notificationsEnabled
                ? "Usá datos de contacto y entrega ficticios, excepto una dirección de correo real autorizada para esta prueba."
                : "Usá datos ficticios."}{" "}
              Los datos del formulario se conservan solo en memoria durante esta
              visita y se pierden al recargar.{" "}
              {orders.notificationsEnabled
                ? "Al confirmar, solo tu correo se enviará al servidor para las novedades del pedido. Se conservará cifrado hasta 30 días; no se enviarán tu nombre, teléfono ni domicilio. Solo se admiten destinatarios de prueba autorizados."
                : orders.enabled &&
                  "El servidor no recibe tus datos de contacto ni domicilio: guarda un comprador anonimizado, prendas, entrega y método simulado."}
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
                    <legend>
                      {paymentsEnabled
                        ? "03 / Pago de prueba"
                        : "03 / Pago simulado"}
                    </legend>
                    <p className="checkout-help" id="payment-help">
                      {paymentsEnabled
                        ? "Mercado Pago abre su checkout de pruebas fuera de VANTA. Usá solo usuarios y tarjetas de prueba. La transferencia es ficticia: no transfieras dinero. VANTA no solicita tarjetas ni datos bancarios."
                        : "Solo una selección visual. No se abrirán pasarelas, no se solicitarán datos financieros ni comprobantes."}
                    </p>
                    <div className="checkout-choices">
                      {(paymentsEnabled
                        ? (["mercado_pago", "transfer"] as const)
                        : (["mercado_pago", "transfer", "cash"] as const)
                      ).map((method) => (
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
                            {paymentsEnabled && method === "mercado_pago"
                              ? "Mercado Pago — Pruebas"
                              : paymentNames[method]}
                            <small>
                              {method === "cash"
                                ? "Exclusivo para retiro en local ficticio"
                                : paymentsEnabled && method === "mercado_pago"
                                  ? "Checkout Pro · Solo entorno de pruebas"
                                  : paymentsEnabled
                                    ? "Datos ficticios · No transfieras dinero"
                                    : "Simulado · Sin cobro"}
                            </small>
                          </span>
                        </label>
                      ))}
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
                    <h3>
                      {paymentsEnabled
                        ? "Método de pago de prueba"
                        : "Método simulado"}
                    </h3>
                    <p>{paymentNames[draft.payment]}</p>
                    <p>
                      {paymentsEnabled && draft.payment === "mercado_pago"
                        ? "Se abrirá Mercado Pago en modo de pruebas. No uses tarjetas ni dinero reales."
                        : "No se realizará ningún cobro."}
                    </p>
                  </section>
                </div>
              ) : null}
            </div>
            <CheckoutSummary draft={draft} reservesOnConfirm={orders.enabled} />
          </div>
          {step === "review" && orders.enabled && valid && (
            <div className="checkout-demo-note">
              <p>
                Confirmar registra un pedido ficticio y reserva stock de
                demostración durante 60 minutos. Máximo 12 unidades por pedido y
                3 por variante. No hay cobros.
              </p>
              <p>
                Si una respuesta se pierde, reintentar consulta el mismo
                intento, incluso si después modificaste el carrito. No repitas
                desde otra pestaña.
              </p>
              <OrderChallenge
                key={challengeRevision}
                siteKey={orders.siteKey}
                onToken={acceptToken}
              />
            </div>
          )}
          {step === "review" &&
            orders.enabled &&
            !challenge &&
            !orderFlow.pending && (
              <p className="checkout-help" role="status">
                Completá la verificación de seguridad para habilitar «Confirmar
                pedido demo» o continuar al pago de prueba.
              </p>
            )}
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
                disabled={
                  !ready ||
                  !valid ||
                  (paymentsEnabled && paymentSession) ||
                  orderFlow.pending ||
                  (orders.enabled && !challenge)
                }
                onClick={() => {
                  if (!ready || !valid || (paymentsEnabled && paymentSession))
                    return;
                  if (orders.enabled) {
                    // A token is single-use. Remove it immediately, not after the request.
                    const token = challenge;
                    setChallenge("");
                    void orderFlow
                      .confirm(
                        payload(),
                        token,
                        orders.notificationsEnabled
                          ? normalizeNotificationEmail(draft.email)
                          : undefined,
                      )
                      .finally(() => {
                        setChallenge("");
                        setChallengeRevision((v) => v + 1);
                      });
                  } else {
                    onComplete();
                    window.location.hash = "/checkout/finalizado";
                  }
                }}
              >
                {orders.enabled
                  ? orderFlow.pending
                    ? "Confirmando…"
                    : paymentsEnabled
                      ? draft.payment === "mercado_pago"
                        ? "Ir a Mercado Pago de prueba"
                        : "Crear pedido con transferencia demo"
                      : "Confirmar pedido demo"
                  : "Finalizar demostración"}
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
