import type { Context, Settings } from "../functions/_shared/mp-orders/core";
export const settings: Settings = {
  enabled: true,
  mode: "test",
  token: "APP_USR-fixture-token-not-a-credential",
  seller: "123",
  application: "456",
  origin: "https://shop.example",
  actorSecret: "actor-fixture-only-".repeat(3),
  webhookSecret: "signature-fixture-only-".repeat(3),
  workerSecret: "worker-fixture-only-".repeat(3),
  supabaseUrl: "https://project.supabase.co",
  serviceRoleKey: "service-role-fixture-key-1234567890abcdef",
};
export const resource = "ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP9";
export const payment: Context = {
  payment_id: "10000000-0000-0000-0000-000000000001",
  reference: "20000000-0000-0000-0000-000000000001",
  order_status: "pending",
  expires_at: new Date(Date.now() + 3600000).toISOString(),
  amount_cents: 5000100,
  status: "pending",
  reconciliation: "unlinked",
  provider_order_id: null,
  checkout_url: null,
  request: {
    type: "online",
    processing_mode: "manual",
    total_amount: "50001.00",
    external_reference: "20000000-0000-0000-0000-000000000001",
    items: [
      { title: "Essential / S / Negro", quantity: 2, unit_price: "25000.50" },
    ],
  },
  idempotency_key: "30000000-0000-0000-0000-000000000001",
  cancel_key: "40000000-0000-0000-0000-000000000001",
  seller_id: "123",
  application_id: "456",
  attempts: 1,
};
export const identity = {
  id: 123,
  site_id: "MLA",
  country_id: "AR",
  tags: ["test_user"],
  status: { site_status: "active" },
};
export function remote(extra: Record<string, unknown> = {}) {
  return {
    id: resource,
    type: "online",
    processing_mode: "manual",
    country_code: "ARG",
    currency: "ARS",
    external_reference: payment.reference,
    user_id: 123,
    integration_data: { application_id: "456" },
    total_amount: "50001.00",
    total_paid_amount: "0.00",
    items: payment.request.items,
    status: "created",
    status_detail: "created",
    last_updated_date: new Date().toISOString(),
    checkout_url: `https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=${resource}`,
    ...extra,
  };
}
export async function signature(
  id = resource,
  ts = String(Date.now()),
  requestId = "fixture-request",
  secret = settings.webhookSecret,
) {
  const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const value = [
    ...new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  return { "x-signature": `ts=${ts},v1=${value}`, "x-request-id": requestId };
}
