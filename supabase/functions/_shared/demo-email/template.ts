/** v1 templates are frozen and encrypted before their first HTTP attempt. */
const kinds = [
  "order_received",
  "payment_pending",
  "payment_approved",
  "order_cancelled",
  "reservation_expired",
  "payment_review",
] as const;
export type EventKind = (typeof kinds)[number];
type Item = {
  name: string;
  size: string;
  color: string;
  quantity: number;
  unit_price_cents: number;
};
export type EmailSnapshot = {
  version: 1;
  reference: string;
  event: EventKind;
  event_at: string;
  order_status: string;
  payment_status: string;
  method: "mercado_pago" | "transfer" | "cash";
  delivery: "shipping" | "pickup";
  currency: "ARS";
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
  expires_at: string;
  items: Item[];
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function cents(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isSafeInteger(v) &&
    v >= 0 &&
    v <= 100000000000
  );
}
function text(v: unknown, n: number): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= n &&
    ![...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  );
}
export function emailSnapshot(raw: unknown): EmailSnapshot {
  const v = raw as EmailSnapshot;
  if (
    !v ||
    v.version !== 1 ||
    !uuid.test(v.reference) ||
    !kinds.includes(v.event) ||
    v.currency !== "ARS" ||
    !["mercado_pago", "transfer", "cash"].includes(v.method) ||
    !["shipping", "pickup"].includes(v.delivery) ||
    ![
      "pending",
      "confirmed",
      "preparing",
      "delivered",
      "cancelled",
      "expired",
    ].includes(v.order_status) ||
    ![
      "pending",
      "approved",
      "rejected",
      "cancelled",
      "expired",
      "refunded",
    ].includes(v.payment_status) ||
    !Number.isFinite(Date.parse(v.event_at)) ||
    !Number.isFinite(Date.parse(v.expires_at)) ||
    !cents(v.subtotal_cents) ||
    !cents(v.shipping_cents) ||
    !cents(v.total_cents) ||
    v.total_cents !== v.subtotal_cents + v.shipping_cents ||
    !Array.isArray(v.items) ||
    !v.items.length ||
    v.items.length > 12
  )
    throw Error("INVALID_DATA");
  let sum = 0,
    units = 0;
  for (const i of v.items) {
    if (
      !i ||
      !text(i.name, 200) ||
      !text(i.size, 30) ||
      !text(i.color, 60) ||
      !cents(i.unit_price_cents) ||
      !Number.isInteger(i.quantity) ||
      i.quantity < 1 ||
      i.quantity > 3
    )
      throw Error("INVALID_DATA");
    sum += i.unit_price_cents * i.quantity;
    units += i.quantity;
  }
  if (
    sum !== v.subtotal_cents ||
    units > 12 ||
    (v.event === "payment_approved" &&
      (v.method !== "mercado_pago" ||
        v.payment_status !== "approved" ||
        !["confirmed", "preparing", "delivered"].includes(v.order_status)))
  )
    throw Error("INVALID_DATA");
  return v;
}
const copy: Record<EventKind, { title: string; message: string }> = {
  order_received: {
    title: "Recibimos tu pedido de demostración",
    message:
      "Tu selección quedó registrada. Este mensaje no confirma un pago ni una compra comercial.",
  },
  payment_pending: {
    title: "Tu pago de demostración está pendiente",
    message:
      "Todavía no hay un pago de prueba aprobado. Si elegiste transferencia, no transfieras dinero: los datos de la tienda son ficticios.",
  },
  payment_approved: {
    title: "Pago de prueba aprobado",
    message:
      "El servidor verificó la aprobación de Mercado Pago en su entorno de pruebas y confirmó el pedido. No se realizó un cobro productivo.",
  },
  order_cancelled: {
    title: "Tu pedido de demostración fue cancelado",
    message:
      "El pedido ya no está activo. No vuelvas a pagar este pedido. Una eventual acreditación posterior requiere revisión y no lo reactiva automáticamente.",
  },
  reservation_expired: {
    title: "Venció la reserva de tu pedido demo",
    message:
      "La reserva de 60 minutos finalizó. No vuelvas a pagar este pedido. Una eventual acreditación tardía necesita revisión y no reactiva la reserva.",
  },
  payment_review: {
    title: "Tu pago de prueba requiere revisión",
    message:
      "La operación requiere revisión del administrador. Este mensaje no confirma el pedido ni reactiva reservas vencidas. No vuelvas a pagar.",
  },
};
const escape = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const ars = (c: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: c % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(c / 100);
export function emailTemplate(raw: unknown) {
  const s = emailSnapshot(raw),
    c = copy[s.event];
  const when = new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(s.event_at));
  const delivery =
    s.delivery === "pickup"
      ? "Retiro en local ficticio · Sin costo"
      : "Envío a coordinar · No cotizado ni incluido en el total";
  const method = {
    mercado_pago: "Mercado Pago · Pruebas",
    transfer: "Transferencia ficticia · No transfieras dinero",
    cash: "Efectivo ficticio · Demostración",
  }[s.method];
  const legal =
    "VANTA Urban Wear es una demostración de portfolio. No uses dinero ni tarjetas reales. Este correo no es una factura ni un comprobante fiscal. Refleja el evento indicado; el estado puede cambiar después.";
  const lines = s.items.map(
    (i) =>
      `${i.name} — Talle ${i.size} / ${i.color}\nCantidad: ${i.quantity} · Precio unitario: ${ars(i.unit_price_cents)} ARS · Subtotal: ${ars(i.unit_price_cents * i.quantity)} ARS`,
  );
  const plain = [
    "VANTA — URBAN WEAR",
    c.title,
    c.message,
    `Pedido: ${s.reference}`,
    `Evento registrado: ${when} (Argentina)`,
    ...lines,
    `Subtotal: ${ars(s.subtotal_cents)} ARS`,
    `Entrega: ${delivery}`,
    `Costo de envío registrado: ${ars(s.shipping_cents)} ARS`,
    `Total del pedido: ${ars(s.total_cents)} ARS`,
    `Método: ${method}`,
    legal,
  ].join("\n\n");
  const products = s.items
    .map(
      (i) =>
        `<tr><td style="padding:20px 0;border-bottom:1px solid #383838;overflow-wrap:anywhere"><strong style="font-size:16px;font-weight:500;color:#f2f0ed">${escape(i.name)}</strong><br><span style="color:#c3bfb8">Talle ${escape(i.size)} / ${escape(i.color)}<br>Cantidad: ${i.quantity}<br>Precio unitario: ${escape(ars(i.unit_price_cents))} ARS</span><br>Subtotal: ${escape(ars(i.unit_price_cents * i.quantity))} ARS</td></tr>`,
    )
    .join("");
  const html = `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>VANTA · Demostración</title></head><body style="margin:0;background:#090909;color:#f2f0ed;font-family:Arial,Helvetica,sans-serif;line-height:1.7"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#090909"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#121213;border:1px solid #383838"><tr><td style="padding:28px 20px"><div style="font-size:30px;font-weight:700;letter-spacing:-2px">VANTA<span style="font-size:12px;letter-spacing:1px"> ®</span></div><p style="color:#b7b4ae;font-size:11px;letter-spacing:2px">URBAN WEAR / DEMOSTRACIÓN</p><h1 style="font-size:26px;font-weight:400;line-height:1.3">${escape(c.title)}</h1><p>${escape(c.message)}</p><p style="font-size:12px;color:#c3bfb8;overflow-wrap:anywhere;word-break:break-word">Pedido: ${s.reference}<br>Evento registrado: ${escape(when)} (Argentina)</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${products}</table><p>Subtotal: ${escape(ars(s.subtotal_cents))} ARS<br>Entrega: ${escape(delivery)}<br>Costo de envío registrado: ${escape(ars(s.shipping_cents))} ARS</p><p style="font-size:20px">Total del pedido: <strong style="font-weight:500">${escape(ars(s.total_cents))} ARS</strong></p><p style="font-size:13px;color:#c3bfb8">${escape(method)}</p><p style="border-top:1px solid #383838;padding-top:20px;font-size:12px;color:#b7b4ae">${escape(legal)}</p></td></tr></table></td></tr></table></body></html>`;
  return {
    subject: `VANTA Demo · ${c.title} · ${s.reference}`,
    html,
    text: plain,
  };
}
