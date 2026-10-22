import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createDemoDb } from "./demo-fixture";
import { hash } from "../functions/_shared/mp-orders/core";
import { enrollEmail } from "../functions/_shared/demo-email/privacy";
import type { EmailSettings } from "../functions/_shared/demo-email/worker";
export const variant = "10000000-0000-0000-0000-000000000001",
  capability = "c".repeat(64),
  recipient = "owner@example.test";
// Synthetic encryption/API/worker values used only in tests. No environment secrets are read.
export const emailSettings: EmailSettings = {
  enabled: true,
  mode: "portfolio_demo",
  token: "re_fixture_only_not_a_real_key",
  from: "onboarding@resend.dev",
  workerSecret: "email-fixture-worker-" + "x".repeat(32),
  allowed: JSON.stringify([recipient]),
  encryption: btoa("e".repeat(32)),
};
export const payload = {
  items: [{ variant_id: variant, quantity: 2, expected_price_cents: 2500050 }],
  delivery: "pickup",
  payment: "mercado_pago",
};
export async function createEmailDb() {
  const db = await createDemoDb();
  await db.exec(
    "create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;",
  );
  for (const name of [
    "202610200001_demo_orders.sql",
    "202610200002_admin_panel.sql",
    "202610230001_mp_test_backend.sql",
    "202610230002_checkout_payments.sql",
    "202610230003_transactional_email.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  await db.exec(`insert into public.categories(id,name,slug,active) values('${variant}','Remeras','remeras',true);
 insert into public.products(id,category_id,name,description,slug,price_cents,active) values('${variant}','${variant}','Essential & <VANTA>','Original','essential',2500050,true);
 insert into public.product_variants(id,product_id,sku,size,color,active) values('${variant}','${variant}','A','S','Negro',true);
 insert into public.inventory(variant_id,on_hand) values('${variant}',8);
 update public.mp_test_config set enabled=true,seller_id='123',application_id='456';`);
  const scalar = async (sql: string, args: unknown[] = []) =>
    (await db.query<{ v: unknown }>(sql, args)).rows[0]?.v;
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const keys = Object.keys(args);
    await db.exec("set role service_role");
    try {
      return await scalar(
        `select public.${name}(${keys.map((key, i) => `${key}=>$${i + 1}`).join(",")}) v`,
        Object.values(args),
      );
    } finally {
      await db.exec("reset role");
    }
  };
  async function order(
    method = "mercado_pago",
    notified = true,
    key = randomUUID(),
  ) {
    const p = { ...payload, payment: method };
    const enrollment = notified
      ? await enrollEmail(recipient, key, {
          enabled: true,
          allowed: emailSettings.allowed,
          encryption: emailSettings.encryption,
        })
      : null;
    const args = {
      p_key: key,
      p_owner: await hash(capability),
      p_payload: p,
      ...(enrollment
        ? {
            p_recipient_hash: enrollment.recipient_hash,
            p_ciphertext: enrollment.ciphertext,
          }
        : {}),
    };
    return (await rpc(
      enrollment ? "demo_email_create_order" : "demo_create_order",
      args,
    )) as { reference: string; email_requested?: boolean };
  }
  async function prepare(reference: string) {
    return (await rpc("mp_test_prepare", {
      p_reference: reference,
      p_owner: await hash(capability),
      p_create: true,
      p_return_origin: "https://store.example",
    })) as Record<string, unknown>;
  }
  async function apply(
    p: Record<string, unknown>,
    state = "pending",
    detail = "pending",
  ) {
    const resource = "ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP9";
    return (await rpc("mp_test_apply", {
      p_id: p.payment_id,
      p_resource: resource,
      p_url: `https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=${resource}`,
      p_snapshot: {
        reference: p.reference,
        seller_id: "123",
        application_id: "456",
        currency: "ARS",
        amount_cents: 5000100,
        paid_cents: state === "approved" ? 5000100 : 0,
        updated_at: new Date().toISOString(),
        state,
        detail,
      },
    })) as Record<string, unknown>;
  }
  const reset = () =>
    db.exec(`reset role;delete from public.demo_email_outbox;delete from public.demo_email_contacts;delete from public.demo_email_budget;delete from public.demo_email_suppressions;
 delete from public.payment_events;delete from public.payments;delete from public.inventory_movements;delete from public.stock_reservations;delete from public.order_items;delete from public.orders;delete from public.demo_request_limits;
 update public.inventory set on_hand=8,reserved=0;update public.demo_email_config set enabled=true,daily_attempt_limit=50;`);
  return { db, scalar, rpc, order, prepare, apply, reset };
}
