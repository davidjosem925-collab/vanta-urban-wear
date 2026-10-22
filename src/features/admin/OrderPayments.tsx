import { useEffect, useRef, useState } from "react";
import { rpc } from "./client";
import { type DemoOrder, money, date } from "./model";
import {
  type OrderPayments as Data,
  orderActions,
  paymentLabel,
} from "./orderPayments";
import { Confirm } from "./Confirm";
import { friendly } from "./ux";
const notices: Record<string, string> = {
  order_received: "Pedido recibido",
  payment_pending: "Pago pendiente",
  payment_approved: "Pago de prueba aprobado",
  order_cancelled: "Pedido cancelado",
  reservation_expired: "Reserva vencida",
  payment_review: "Pago en revisión",
};
const delivery: Record<string, string> = {
  queued: "En cola",
  sending: "Procesando",
  accepted: "Aceptado por Resend",
  failed: "Falló el envío",
  review: "Requiere revisión",
  suppressed: "No se enviará",
  unknown: "Entrega sin confirmar",
  sent: "Enviado",
  delayed: "Demorado",
  delivered: "Entregado al servidor de correo",
  bounced: "Rebotado",
  complained: "Queja",
  pending: "Pendiente",
};
type Attempt = {
  p_id: string;
  p_action: string;
  p_key: string;
  p_expected_status: string;
};
export function OrderPayments({
  order,
  data,
  refresh,
}: {
  order: DemoOrder;
  data: Data;
  refresh(): Promise<void>;
}) {
  const [confirmation, setConfirmation] = useState<{
      action: string;
      label: string;
    } | null>(null),
    [attempt, setAttempt] = useState<Attempt | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (
      attempt &&
      (attempt.p_id !== order.id || attempt.p_expected_status !== order.status)
    ) {
      setAttempt(null);
      setError("");
    }
  }, [order.id, order.status, attempt]);
  const sending = useRef(false);
  async function execute(value: Attempt) {
    if (sending.current) return;
    sending.current = true;
    setConfirmation(null);
    setAttempt(value);
    setBusy(true);
    setError("");
    try {
      await rpc("admin_demo_order_action", value);
      setAttempt(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="admin-payment-detail" aria-label="Pagos y seguimiento">
      <h4>Estado del pago</h4>
      {!data.payments.length && (
        <p>
          Sin operación de pago registrada. Puede ser un pedido demo anterior o
          una operación aún no iniciada.
        </p>
      )}
      {data.payments.map((p) => (
        <article className="admin-line" key={p.id}>
          <dl className="admin-facts">
            <div>
              <dt>Método</dt>
              <dd>
                {p.method === "mercado_pago"
                  ? "Mercado Pago · Pruebas"
                  : p.method === "bank_transfer"
                    ? "Transferencia ficticia"
                    : "Pago demo anterior"}
              </dd>
            </div>
            <div>
              <dt>Pago</dt>
              <dd>
                {paymentLabel(p.status)}
                {p.method === "bank_transfer" && p.status === "approved"
                  ? " · Registro administrativo demo"
                  : ""}
              </dd>
            </div>
            <div>
              <dt>Importe</dt>
              <dd>
                {money(p.amount_cents)} {p.currency}
              </dd>
            </div>
            <div>
              <dt>Operación interna</dt>
              <dd>{p.id}</dd>
            </div>
            <div>
              <dt>Operación del proveedor</dt>
              <dd>{p.operation_id ?? "Todavía no vinculada"}</dd>
            </div>
            <div>
              <dt>Conciliación</dt>
              <dd>
                {{
                  settled: "Conciliado",
                  review: "Requiere revisión manual",
                  awaiting: "Esperando al proveedor",
                  unlinked: "Sin vincular",
                  closed: "Cerrada",
                }[p.reconciliation ?? ""] ?? "No aplica"}
              </dd>
            </div>
            <div>
              <dt>Creación del pago</dt>
              <dd>{date(p.created_at)}</dd>
            </div>
            <div>
              <dt>Actualización del pago</dt>
              <dd>{date(p.updated_at)}</dd>
            </div>
            <div>
              <dt>Última verificación del proveedor</dt>
              <dd>
                {p.verified_at ? date(p.verified_at) : "Sin verificación"}
              </dd>
            </div>
          </dl>
          {p.method === "mercado_pago" && (
            <p className="admin-muted">
              El pago se verifica en el servidor. No puede aprobarse
              manualmente. Cancelar una reserva no equivale a un reintegro del
              proveedor.
            </p>
          )}
          {p.method === "bank_transfer" && (
            <p className="admin-muted">
              Transferencia exclusivamente ficticia. No solicitar ni transferir
              dinero. Su registro administrativo no acredita un pago bancario
              real.
            </p>
          )}
        </article>
      ))}
      <div className="admin-actions">
        {orderActions(order, data).map((a) => (
          <button
            className="button secondary"
            key={a.action}
            disabled={busy || !!attempt}
            onClick={() => setConfirmation(a)}
          >
            {a.label}
          </button>
        ))}
        {attempt && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void execute(attempt)}
          >
            Reintentar misma acción
          </button>
        )}
      </div>
      {busy && <p role="status">Registrando cambio…</p>}
      {error && (
        <p role="alert" className="admin-alert">
          {error} Actualizá el pedido antes de intentar otra acción. Si
          reintentás, se conservará la misma operación.
        </p>
      )}
      {confirmation && (
        <Confirm
          text={`${confirmation.label}. Esta acción de demostración quedará auditada y puede resolver la reserva. No registra cobros reales.`}
          onCancel={() => setConfirmation(null)}
          onConfirm={() =>
            void execute({
              p_id: order.id,
              p_action: confirmation.action,
              p_key: crypto.randomUUID(),
              p_expected_status: order.status,
            })
          }
        />
      )}
      <h4>Eventos de pago</h4>
      {!data.events.length && (
        <p className="admin-muted">Sin eventos registrados.</p>
      )}
      {data.events.map((e) => (
        <p key={e.id}>
          {date(e.received_at)} ·{" "}
          {e.provider === "mercado_pago" ? "Mercado Pago" : "Registro manual"} ·{" "}
          {e.status === "processed"
            ? "Procesado"
            : e.status === "failed"
              ? "Requiere revisión"
              : "Recibido"}
          {e.outcome === "review" ? " · Pago en revisión" : ""}
        </p>
      ))}
      <h4>Acciones administrativas</h4>
      {!data.actions.length && (
        <p className="admin-muted">Sin acciones registradas.</p>
      )}
      {data.actions.map((a, i) => (
        <p key={i}>
          {date(a.created_at)} ·{" "}
          {{
            confirm: "Confirmación demo",
            cancel: "Cancelación demo",
            prepare: "Preparación",
            deliver: "Entrega demo",
          }[a.action] ?? "Acción registrada"}{" "}
          · {friendly(a.result.order_status)}
        </p>
      ))}
      <h4>Notificaciones</h4>
      {!data.notifications.length && (
        <p className="admin-muted">
          Sin correos solicitados para este pedido. No se inscriben compras
          anteriores retroactivamente.
        </p>
      )}
      {data.notifications.map((e) => (
        <p key={e.event}>
          {notices[e.event] ?? "Notificación"} ·{" "}
          {delivery[e.state] ?? "Estado desconocido"} ·{" "}
          {delivery[e.delivery] ?? "Entrega sin confirmar"}
          {e.error_code ? " · Consultar diagnóstico seguro del worker" : ""}
        </p>
      ))}
      <p className="admin-muted">
        Los fallos de correo no cambian el pedido, su pago ni el stock. Un
        correo aceptado no garantiza su recepción en la bandeja principal.
      </p>
    </section>
  );
}
