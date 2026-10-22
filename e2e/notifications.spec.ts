import { expect, test } from "@playwright/test";
import { catalog } from "./catalog-fixture";
import { emailTemplate } from "../supabase/functions/_shared/demo-email/template";
const variant = "10000000-0000-0000-0000-000000000001",
  reference = "20000000-0000-0000-0000-000000000001";
const snapshot = {
  version: 1,
  reference,
  event: "payment_approved",
  event_at: "2026-10-22T20:00:00Z",
  order_status: "confirmed",
  payment_status: "approved",
  method: "mercado_pago",
  delivery: "shipping",
  currency: "ARS",
  subtotal_cents: 5000100,
  shipping_cents: 0,
  total_cents: 5000100,
  expires_at: "2026-10-22T21:00:00Z",
  items: [
    {
      name: "Prenda ficticia de prueba & VANTA",
      size: "M",
      color: "Negro",
      quantity: 2,
      unit_price_cents: 2500050,
    },
  ],
};
test("plantilla offline Dark Luxury responsive sin recursos externos ni desbordes", async ({
  page,
}, info) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.setContent(emailTemplate(snapshot).html);
  await expect(
    page.getByRole("heading", { name: "Pago de prueba aprobado" }),
  ).toBeVisible();
  await expect(
    page.getByText(/no es una factura ni un comprobante fiscal/),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(requests).toEqual([]);
  await page.screenshot({
    path: `work/email-preview-${info.project.name}.png`,
    fullPage: true,
  });
});
test("correo de comprador solo viaja al crear, nunca queda en storage ni se envía desde el navegador a Resend", async ({
  page,
}) => {
  const state = await catalog(page);
  state.variants = state.variants.map((v, i) => ({
    ...v,
    id: i === 0 ? variant : "10000000-0000-0000-0000-000000000002",
  }));
  await page.route(
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "window.turnstile={render:(el,o)=>{o.callback('fixture-token');return 'fixture';},remove:()=>{}};",
      }),
  );
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/functions/v1/demo-orders", (route) => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    if (body.action === "transfer")
      return route.fulfill({
        json: {
          reference,
          order_status: "pending",
          payment_status: "pending",
          reconciliation: "awaiting",
          amount_cents: 5000100,
          currency: "ARS",
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          checkout_url: null,
          demo: true,
        },
      });
    const created = Date.now();
    return route.fulfill({
      json: {
        reference,
        status: "pending",
        subtotal_cents: 5000100,
        created_at: new Date(created).toISOString(),
        expires_at: new Date(created + 3600000).toISOString(),
        demo: true,
        email_requested: true,
      },
    });
  });
  await page.goto("/#/producto/remera-essential");
  await page.getByRole("button", { name: "Negro", exact: true }).click();
  await page.getByRole("button", { name: "M", exact: true }).click();
  await page.getByLabel("Cantidad", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Agregar al carrito", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Producto agregado" })
    .getByRole("button", { name: "Ver carrito", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Continuar al checkout demo" })
    .click();
  await expect(
    page.getByText(/solo tu correo se enviará al servidor/),
  ).toBeVisible();
  for (const [name, value] of [
    ["Nombre", "Lucía"],
    ["Apellido", "Pérez"],
    ["Correo electrónico", "owner@example.test"],
    ["Teléfono de contacto", "1155551234"],
  ])
    await page.getByLabel(name, { exact: true }).fill(value);
  await page.getByRole("radio", { name: /Retiro en local ficticio/ }).click();
  await page.getByRole("radio", { name: /Transferencia bancaria/ }).click();
  await page.getByRole("button", { name: "Revisar demostración" }).click();
  await page
    .getByRole("button", { name: "Crear pedido con transferencia demo" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Pago pendiente.", exact: true }),
  ).toBeVisible();
  expect(bodies[0].notification_email).toBe("owner@example.test");
  expect(JSON.stringify(bodies[0].payload)).not.toMatch(/email|owner@example/);
  expect(JSON.stringify(bodies[0])).not.toMatch(/Lucía|Pérez|phone|street/);
  const persisted = await page.evaluate(() =>
    JSON.stringify({ ...sessionStorage, ...localStorage }),
  );
  expect(persisted).not.toMatch(/owner@example|Lucía|notification_email/);
  await expect(
    page.getByText(/Las novedades de los pedidos registrados con correo/),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Pago pendiente.", exact: true }),
  ).toBeVisible();
  expect(bodies.filter((b) => b.action === "create")).toHaveLength(1);
  for (const b of bodies.filter((b) => b.action !== "create"))
    expect(b).not.toHaveProperty("notification_email");
  expect(state.errors).toEqual([]);
  expect(state.writes).toEqual([]);
  expect(state.unexpected).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
