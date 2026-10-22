// Offline preview only. Synthetic receipt; never reads credentials or connects to a service.
import { mkdir, writeFile } from "node:fs/promises";
import { emailTemplate } from "../supabase/functions/_shared/demo-email/template.ts";
const directory = new URL("../work/email-preview/", import.meta.url);
await mkdir(directory, { recursive: true });
const base = {
  version: 1,
  reference: "20000000-0000-0000-0000-000000000001",
  event_at: "2026-10-22T20:00:00Z",
  order_status: "pending",
  payment_status: "pending",
  method: "mercado_pago",
  delivery: "shipping",
  currency: "ARS",
  subtotal_cents: 5000100,
  shipping_cents: 0,
  total_cents: 5000100,
  expires_at: "2026-10-22T21:00:00Z",
  items: [
    {
      name: "Prenda ficticia de prueba",
      size: "M",
      color: "Negro",
      quantity: 2,
      unit_price_cents: 2500050,
    },
  ],
};
for (const event of [
  "order_received",
  "payment_pending",
  "payment_approved",
  "order_cancelled",
  "reservation_expired",
  "payment_review",
]) {
  const snapshot = {
    ...base,
    event,
    ...(event === "payment_approved"
      ? { order_status: "confirmed", payment_status: "approved" }
      : {}),
    ...(event === "order_cancelled" ? { order_status: "cancelled" } : {}),
    ...(event === "reservation_expired" || event === "payment_review"
      ? { order_status: "expired" }
      : {}),
  };
  const template = emailTemplate(snapshot);
  await writeFile(new URL(`${event}.html`, directory), template.html);
  await writeFile(new URL(`${event}.txt`, directory), template.text);
}
console.log(
  "OK offline: seis plantillas HTML/texto en work/email-preview/. Sin envíos ni datos reales.",
);
