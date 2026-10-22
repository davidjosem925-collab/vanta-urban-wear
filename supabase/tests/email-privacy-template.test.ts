// @vitest-environment node
import { expect, it } from "vitest";
import {
  normalizeEmail,
  recipients,
  encryptionKey,
  seal,
  unseal,
  enrollEmail,
} from "../functions/_shared/demo-email/privacy";
import {
  emailTemplate,
  emailSnapshot,
} from "../functions/_shared/demo-email/template";
import { normalizeNotificationEmail } from "../../src/features/orders/notificationEmail";
import { emailSettings, recipient } from "./email-fixture";
const snapshot = {
  version: 1,
  reference: "20000000-0000-0000-0000-000000000001",
  event: "order_received",
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
      name: 'Essential <script>"&',
      size: "S",
      color: "Negro",
      quantity: 2,
      unit_price_cents: 2500050,
    },
  ],
};
it.each([
  "OWNER@example.test",
  "a+b@example.test",
  "a.b@example.test",
  "x@y.ar",
])("normalizes official API-compatible address %s in both runtimes", (raw) => {
  expect(normalizeEmail(raw)).toBe(normalizeNotificationEmail(raw));
});
it.each([
  "",
  "a..b@example.test",
  ".a@example.test",
  "a.@example.test",
  "a@b",
  "a@example..test",
  "a@example.test\r\nBcc:other@example.test",
  "a@example.test,other@example.test",
  "Name <a@example.test>",
  "a@-x.test",
  "a@x-.test",
  "á@example.test",
  "a@ejémplo.test",
  "x".repeat(65) + "@example.test",
])("rejects invalid/header-injected/unsupported addresses %#", (raw) => {
  expect(() => normalizeEmail(raw)).toThrow("INVALID_EMAIL");
  expect(() => normalizeNotificationEmail(raw)).toThrow("INVALID_EMAIL");
});
it("requires an explicit nonempty bounded allowlist; an address is not self-authorizing", async () => {
  expect(() => recipients("[]")).toThrow();
  expect(() => recipients("broken")).toThrow();
  expect(() => recipients(JSON.stringify(Array(21).fill(recipient)))).toThrow();
  await expect(
    enrollEmail("outsider@example.test", "context", {
      enabled: true,
      allowed: emailSettings.allowed,
      encryption: emailSettings.encryption,
    }),
  ).rejects.toThrow("EMAIL_RECIPIENT_UNAVAILABLE");
  await expect(
    enrollEmail(recipient, "context", {
      enabled: false,
      allowed: emailSettings.allowed,
      encryption: emailSettings.encryption,
    }),
  ).rejects.toThrow("EMAIL_DISABLED");
});
it("AES-256-GCM binds contacts to the original attempt, randomizes ciphertext, and rejects tampering/key rotation", async () => {
  const key = await encryptionKey(emailSettings.encryption);
  const a = await seal(recipient, key, "attempt-1"),
    b = await seal(recipient, key, "attempt-1");
  expect(a).not.toBe(b);
  expect(a).not.toContain(recipient);
  expect(await unseal(a, key, "attempt-1")).toBe(recipient);
  await expect(unseal(a, key, "attempt-2")).rejects.toThrow("KEY_UNAVAILABLE");
  const wrong = await encryptionKey(btoa("x".repeat(32)));
  await expect(unseal(a, wrong, "attempt-1")).rejects.toThrow();
  await expect(
    unseal(a.slice(0, -2) + "AA", key, "attempt-1"),
  ).rejects.toThrow();
  await expect(encryptionKey("short")).rejects.toThrow("EMAIL_NOT_CONFIGURED");
});
it("HTML/text include exact snapshots, variants, unit prices, shipping caveat and portfolio/non-fiscal disclosure; no external trackers", () => {
  const t = emailTemplate(snapshot);
  expect(t.html).toContain("&lt;script&gt;&quot;&amp;");
  expect(t.html).not.toContain("<script>");
  for (const v of [
    "Cantidad: 2",
    "Talle S / Negro",
    "Precio unitario:",
    "Total del pedido:",
    "No cotizado ni incluido",
    "comprobante fiscal",
    snapshot.reference,
  ]) {
    expect(t.html).toContain(v);
    expect(t.text).toContain(v);
  }
  expect(t.html).not.toMatch(/https?:|src=|onerror=|iframe|javascript:/);
  expect(t.subject).not.toMatch(/\r|\n/);
  expect(t.text).toContain("25.000,50");
  expect(t.text).toContain("50.001");
});
it("only validated server approval can render an approved email; late/review/cancellation never masquerade as approval", () => {
  expect(() =>
    emailTemplate({ ...snapshot, event: "payment_approved" }),
  ).toThrow("INVALID_DATA");
  expect(() =>
    emailTemplate({
      ...snapshot,
      event: "payment_approved",
      payment_status: "approved",
      order_status: "expired",
    }),
  ).toThrow();
  expect(
    emailTemplate({
      ...snapshot,
      event: "payment_approved",
      payment_status: "approved",
      order_status: "confirmed",
    }).text,
  ).toContain("servidor verificó");
  for (const event of [
    "payment_review",
    "reservation_expired",
    "order_cancelled",
  ]) {
    const t = emailTemplate({
      ...snapshot,
      event,
      order_status: "expired",
      payment_status: "approved",
    });
    expect(t.subject).not.toContain("Pago de prueba aprobado");
    expect(t.text).toContain("No vuelvas a pagar");
  }
});
it.each([
  { ...snapshot, total_cents: 1 },
  { ...snapshot, subtotal_cents: 1 },
  { ...snapshot, items: [] },
  { ...snapshot, items: [{ ...snapshot.items[0], quantity: 0 }] },
  { ...snapshot, items: [{ ...snapshot.items[0], unit_price_cents: 1.1 }] },
  { ...snapshot, reference: "spoof" },
])("rejects incomplete/forged monetary data %#", (s) =>
  expect(() => emailSnapshot(s)).toThrow("INVALID_DATA"),
);
