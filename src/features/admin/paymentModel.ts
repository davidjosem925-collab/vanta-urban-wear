import type { DemoOrder } from "./model";
export type AdminPayment = {
  id: string;
  method: string;
  status: string;
  amount_cents: number;
  currency: string;
  mp_test: boolean;
  operation_id: string | null;
  provider_status: string | null;
  provider_detail: string | null;
  reconciliation: string | null;
  created_at: string;
  updated_at: string;
  verified_at: string | null;
};
export type OrderPayments = {
  order_id: string;
  payments: AdminPayment[];
  events: {
    id: string;
    provider: string;
    status: string;
    received_at: string;
    processed_at: string | null;
    outcome: string | null;
  }[];
  actions: {
    action: string;
    expected_status: string;
    result: { order_status: string };
    created_at: string;
  }[];
  notifications: {
    event: string;
    state: string;
    delivery: string;
    error_code: string | null;
    created_at: string;
  }[];
};
export const emptyPayments = (order_id: string): OrderPayments => ({
  order_id,
  payments: [],
  events: [],
  actions: [],
  notifications: [],
});
export const paymentLabel = (status: string) =>
  ({
    pending: "Pendiente",
    approved: "Aprobado",
    rejected: "Rechazado",
    cancelled: "Cancelado",
    expired: "Vencido",
    refunded: "Reintegrado",
  })[status] ?? "Estado histórico no reconocido";
export function orderActions(
  order: DemoOrder,
  data: OrderPayments,
): { action: string; label: string }[] {
  const payment = data.payments.length === 1 ? data.payments[0] : null;
  if (!payment) return [];
  const result = [];
  if (order.status === "pending") {
    if (
      order.demo_payment === "transfer" &&
      payment.method === "bank_transfer" &&
      !payment.mp_test &&
      payment.status === "pending" &&
      payment.amount_cents === order.subtotal_cents
    )
      result.push({ action: "confirm", label: "Registrar transferencia demo" });
    result.push({ action: "cancel", label: "Cancelar reserva demo" });
  }
  const settled =
    payment.status === "approved" &&
    (payment.method === "bank_transfer" ||
      (payment.mp_test &&
        payment.reconciliation === "settled" &&
        payment.provider_status === "approved" &&
        payment.provider_detail === "accredited"));
  if (settled && order.status === "confirmed")
    result.push({ action: "prepare", label: "Marcar en preparación" });
  if (settled && order.status === "preparing")
    result.push({ action: "deliver", label: "Marcar entrega demo" });
  return result;
}
