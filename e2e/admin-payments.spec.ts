import { expect, test, type Page } from "@playwright/test";
import { fixture, id, variant } from "./admin.fixture";
async function setup(page: Page, mp = false, lose = false) {
  const state = await fixture(page);
  const keys: string[] = [];
  let audit = 0;
  const order = {
    id,
    public_reference: variant,
    status: "pending",
    created_at: "2026-10-22T10:00:00Z",
    reservation_expires_at: new Date(Date.now() + 3600000).toISOString(),
    reservation_resolved_at: null as string | null,
    subtotal_cents: 2700050,
    delivery: "pickup",
    demo_payment: mp ? "mercado_pago" : "transfer",
  };
  const payment = {
    id: variant,
    method: mp ? "mercado_pago" : "bank_transfer",
    status: "pending",
    amount_cents: 2700050,
    currency: "ARS",
    mp_test: mp,
    operation_id: mp ? "ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP9" : null,
    provider_status: mp ? "pending" : null,
    provider_detail: null,
    reconciliation: mp ? "awaiting" : null,
    created_at: order.created_at,
    updated_at: order.created_at,
    verified_at: null,
  };
  await page.route("**/rest/v1/orders?**", (r) => r.fulfill({ json: [order] }));
  await page.route("**/rest/v1/rpc/admin_demo_order_payments", (r) =>
    r.fulfill({
      json: [
        {
          order_id: id,
          payments: [payment],
          events: [],
          actions: audit
            ? [
                {
                  action: "confirm",
                  expected_status: "pending",
                  created_at: order.created_at,
                  result: { order_status: order.status },
                },
              ]
            : [],
          notifications: [
            {
              event: "order_received",
              state: "accepted",
              delivery: "unknown",
              error_code: null,
              created_at: order.created_at,
            },
          ],
        },
      ],
    }),
  );
  await page.route("**/rest/v1/stock_reservations?**", (r) =>
    r.fulfill({
      json: [
        {
          id,
          variant_id: variant,
          quantity: 1,
          status: order.status === "confirmed" ? "consumed" : "active",
          expires_at: order.reservation_expires_at,
        },
      ],
    }),
  );
  await page.route("**/rest/v1/rpc/admin_demo_order_action", (r) => {
    const b = r.request().postDataJSON();
    expect(Object.keys(b).sort()).toEqual([
      "p_action",
      "p_expected_status",
      "p_id",
      "p_key",
    ]);
    expect(b.p_id).toBe(id);
    keys.push(b.p_key);
    if (!audit) {
      audit++;
      order.status = "confirmed";
      order.reservation_resolved_at = new Date().toISOString();
      payment.updated_at = order.reservation_resolved_at;
      payment.status = "approved";
    }
    if (lose && keys.length === 1)
      return r.fulfill({
        status: 503,
        json: { code: "P0001", message: "fixture lost acknowledgement" },
      });
    return r.fulfill({
      json: {
        changed: true,
        order_id: id,
        order_status: order.status,
        payment_status: payment.status,
        demo: true,
      },
    });
  });
  await page
    .getByRole("link", { name: "Pedidos de demostración", exact: true })
    .click();
  await page.getByRole("button", { name: "Ver detalle", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Estado del pago", exact: true }),
  ).toBeVisible();
  return { state, keys, getAudit: () => audit };
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
test("transferencia: estados separados, confirmación accesible y acción auditada sin exponer claves", async ({
  page,
}, info) => {
  const s = await setup(page);
  await expect(
    page.getByText("Estado del pedido", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Transferencia ficticia", { exact: true }),
  ).toBeVisible();
  const button = page.getByRole("button", {
    name: "Registrar transferencia demo",
  });
  await button.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(button).toBeFocused();
  expect(s.keys).toHaveLength(0);
  await button.click();
  await page
    .getByRole("button", { name: "Confirmar cambio", exact: true })
    .click();
  await expect(
    page.getByText("Aprobado · Registro administrativo demo", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Utilizada/)).toBeVisible();
  expect(s.getAudit()).toBe(1);
  expect(s.keys).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "Registrar transferencia demo" }),
  ).toHaveCount(0);
  await expect(page.getByText(/Aceptado por Resend/)).toBeVisible();
  await noOverflow(page);
  expect(s.state.errors).toEqual([]);
  expect(s.state.writes).toEqual([]);
  await page.screenshot({
    path: info.outputPath("admin-payment.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByText("Aprobado · Registro administrativo demo", { exact: true }),
  ).toBeVisible();
  expect(s.keys).toHaveLength(1);
});
test("respuesta perdida: reintenta la misma acción sin duplicar aprobación ni auditoría", async ({
  page,
}) => {
  const s = await setup(page, false, true);
  await page
    .getByRole("button", { name: "Registrar transferencia demo" })
    .click();
  await page
    .getByRole("button", { name: "Confirmar cambio", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancelar reserva demo" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Reintentar misma acción" }).click();
  await expect(
    page.getByText("Aprobado · Registro administrativo demo", { exact: true }),
  ).toBeVisible();
  expect(s.keys).toHaveLength(2);
  expect(new Set(s.keys).size).toBe(1);
  expect(s.getAudit()).toBe(1);
  await noOverflow(page);
});
test("Mercado Pago: consulta privada de operación y ninguna aprobación manual", async ({
  page,
}) => {
  const s = await setup(page, true);
  await expect(
    page.getByText("Mercado Pago · Pruebas", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP9", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/No puede aprobarse manualmente/)).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Registrar transferencia|Confirmar pago|Aprobar pago/,
    }),
  ).toHaveCount(0);
  expect(s.keys).toEqual([]);
  await noOverflow(page);
  expect(s.state.errors).toEqual([]);
});
