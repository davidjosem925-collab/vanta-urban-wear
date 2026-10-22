import { useEffect, useRef } from "react";
import { formatARS } from "../catalog/model";
import type { usePayment } from "./usePayment";
import { paymentHeading } from "./model";

export function PaymentPage({
  flow,
  notificationsEnabled = false,
}: {
  flow: ReturnType<typeof usePayment>;
  notificationsEnabled?: boolean;
}) {
  const started = useRef(false);
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      if (flow.enabled && flow.session && !flow.pending && !flow.queried)
        void flow.recover();
    }
  }, [flow]);
  const { session, view, pending } = flow;
  const transfer = session?.attempt.payload.payment === "transfer";
  const canContinue =
    view &&
    view.checkout_url &&
    view.order_status === "pending" &&
    view.payment_status === "pending" &&
    ["awaiting", "unlinked"].includes(view.reconciliation) &&
    Date.parse(view.expires_at) > Date.now();
  return (
    <section
      className="checkout section-shell"
      aria-labelledby="payment-title"
      aria-busy={pending}
    >
      <nav className="breadcrumb" aria-label="Ruta de navegación">
        <a href="#/">Inicio</a>
        <span aria-hidden="true">/</span>
        <a href="#/catalogo">Colección</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Pago de prueba</span>
      </nav>
      <p className="eyebrow">VANTA / DEMOSTRACIÓN</p>
      <h1 id="payment-title">
        {pending ? "Consultando con el servidor…" : paymentHeading(view)}
      </h1>
      <p className="checkout-intro">
        Entorno de pruebas. No uses dinero real ni datos de tarjetas reales.{" "}
        {notificationsEnabled
          ? "Las novedades de los pedidos registrados con correo se envían según el estado verificado del servidor. No son comprobantes fiscales."
          : "No se envían correos en esta fase."}
      </p>
      {!flow.enabled && (
        <p className="checkout-notice">
          Los pagos de prueba todavía no están habilitados en este entorno.
        </p>
      )}
      {flow.error && (
        <div className="checkout-notice" role="alert">
          {flow.error}
        </div>
      )}
      {!session ? (
        <div className="checkout-finished">
          <h2>No encontramos el acceso a tu pedido.</h2>
          <p>
            Volvé a la misma pestaña y navegador donde lo creaste. Una URL de
            retorno no confirma un pago ni permite consultar un pedido por sí
            sola. No repitas la compra para comprobar el resultado.
          </p>
          <a className="button secondary" href="#/checkout">
            Consultar intento original
          </a>
        </div>
      ) : (
        <div className="checkout-finished payment-receipt">
          <h2>
            {transfer
              ? "Transferencia bancaria de demostración"
              : "Mercado Pago · Checkout Pro de prueba"}
          </h2>
          <p>
            Referencia: <strong>{session.reference}</strong>
          </p>
          <p className="checkout-help">
            {transfer
              ? "Este pedido queda pendiente. No se acredita ningún pago desde esta pantalla."
              : "Volver desde Mercado Pago no confirma el pago. Consultamos su estado con el servidor."}
          </p>
          {pending && (
            <p role="status">
              Verificando la misma operación. No se crea otra reserva.
            </p>
          )}
          {view && (
            <div role="status" aria-label="Estado verificado del pago">
              <p>
                Importe del pedido:{" "}
                <strong>{formatARS(view.amount_cents)} ARS</strong>
              </p>
              <p>
                Estado del pago:{" "}
                <strong>
                  {
                    {
                      pending: "Pendiente",
                      approved: "Aprobado por el servidor",
                      rejected: "Rechazado",
                      cancelled: "Cancelado",
                      expired: "Vencido",
                      refunded: "Reintegrado",
                    }[view.payment_status]
                  }
                </strong>
              </p>
              <p>
                Estado del pedido:{" "}
                <strong>
                  {
                    {
                      pending: "Pendiente",
                      confirmed: "Confirmado",
                      preparing: "En preparación",
                      delivered: "Entregado",
                      cancelled: "Cancelado",
                      expired: "Vencido",
                    }[view.order_status]
                  }
                </strong>
              </p>
              <p>
                Vencimiento de la reserva:{" "}
                {new Date(view.expires_at).toLocaleString("es-AR")}.
              </p>
              {view.reconciliation === "review" && (
                <p>
                  Requiere revisión del administrador. Una acreditación tardía
                  no reactiva un pedido ni consume stock liberado. No vuelvas a
                  pagar.
                </p>
              )}
              {["expired", "cancelled"].includes(view.order_status) && (
                <p>
                  La reserva ya no está activa. No reintentes el pago de este
                  pedido.
                </p>
              )}
              {view.payment_status === "rejected" && (
                <p>
                  No damos el pago por aprobado. Consultá nuevamente antes de
                  intentar otra compra.
                </p>
              )}
            </div>
          )}
          {transfer &&
            view &&
            view.payment_status === "pending" &&
            view.order_status === "pending" && (
              <div className="payment-transfer">
                <h3>Datos exclusivamente ilustrativos</h3>
                <p>
                  Banco: Banco ficticio VANTA · Titular: Tienda ficticia VANTA.
                </p>
                <p>
                  Identificador de muestra: NO-TRANSFERIR-DEMO (no es un alias
                  bancario).
                </p>
                <p>
                  <strong>No transfieras dinero.</strong> No hay CBU, CVU ni
                  cuenta real. La selección no acredita un pago; solo una
                  operación administrativa autorizada podrá gestionar su
                  evolución en una fase posterior.
                </p>
              </div>
            )}
          {flow.absent && (
            <p role="status">
              El pedido existe, pero todavía no hay una operación de pago
              registrada. Podés iniciar el pago sobre el mismo pedido sin
              duplicar la reserva.
            </p>
          )}
          <div className="checkout-actions">
            <button
              className="button secondary"
              disabled={pending || !flow.enabled}
              onClick={() => void flow.recover()}
            >
              Consultar estado
            </button>
            {!transfer && (canContinue || flow.absent) && (
              <button
                className="button primary"
                disabled={pending || !flow.enabled}
                onClick={() => void flow.resume()}
              >
                {flow.absent
                  ? "Iniciar pago de prueba"
                  : "Continuar en Mercado Pago"}
              </button>
            )}
            {view &&
              view.reconciliation !== "review" &&
              [
                "confirmed",
                "preparing",
                "delivered",
                "expired",
                "cancelled",
              ].includes(view.order_status) && (
                <button
                  className="cart-text-button"
                  disabled={pending}
                  onClick={flow.finish}
                >
                  Preparar otra selección
                </button>
              )}
            <a className="cart-text-button" href="#/catalogo">
              Volver a la colección
            </a>
          </div>
          <p className="checkout-help">
            La sesión de recuperación se conserva en esta pestaña, sin datos de
            contacto. No compartas su almacenamiento. Las consultas tienen
            límites: esperá entre consultas; no es necesario recargar ni crear
            otro pedido.
          </p>
        </div>
      )}
    </section>
  );
}
