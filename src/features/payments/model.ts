import type { PaymentView } from "./service";
export function paymentHeading(p: PaymentView | null) {
  if (!p) return "Consultá tu operación.";
  if (p.reconciliation === "review") return "Pago en revisión.";
  if (
    p.payment_status === "approved" &&
    p.reconciliation === "settled" &&
    ["confirmed", "preparing", "delivered"].includes(p.order_status)
  )
    return "Pago aprobado.";
  if (p.order_status === "expired" || p.payment_status === "expired")
    return "La reserva venció.";
  if (p.order_status === "cancelled" || p.payment_status === "cancelled")
    return "Pago cancelado.";
  if (p.payment_status === "rejected") return "Pago rechazado.";
  if (p.payment_status === "refunded") return "Pago reintegrado.";
  return "Pago pendiente.";
}
