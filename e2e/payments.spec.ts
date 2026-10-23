import { expect, test, type Page } from "@playwright/test";
import { catalog } from "./catalog-fixture";
const reference = "20000000-0000-0000-0000-000000000001";
const variant = "10000000-0000-0000-0000-000000000001";
const checkout =
  "https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP9";
function payment(extra: Record<string, unknown> = {}) {
  return {
    reference,
    order_status: "pending",
    payment_status: "pending",
    reconciliation: "awaiting",
    amount_cents: 5000100,
    currency: "ARS",
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    checkout_url: null,
    demo: true,
    ...extra,
  };
}
async function begin(
  page: Page,
  method: "mercado_pago" | "transfer" = "mercado_pago",
) {
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
        body: "window.turnstile={render:(el,o)=>{el.textContent='Seguridad de prueba';o.callback('fixture-token');return 'fixture';},remove:()=>{}};",
      }),
  );
  const orders: Record<string, unknown>[] = [],
    transfers: Record<string, unknown>[] = [];
  await page.route("**/functions/v1/demo-orders", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "transfer") {
      transfers.push(body);
      return route.fulfill({ json: payment() });
    }
    orders.push(body);
    const created = new Date();
    return route.fulfill({
      json: {
        reference,
        status: "pending",
        subtotal_cents: 5000100,
        created_at: created.toISOString(),
        expires_at: new Date(+created + 3600000).toISOString(),
        demo: true,
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
  await page.getByRole("button", { name: "Continuar al checkout" }).click();
  for (const [name, value] of [
    ["Nombre", "Lucía"],
    ["Apellido", "Pérez"],
    ["Correo electrónico", "lucia@example.com"],
    ["Teléfono de contacto", "1155551234"],
  ])
    await page.getByLabel(name, { exact: true }).fill(value);
  await page.getByRole("radio", { name: /Retiro en local/ }).click();
  if (method === "transfer")
    await page.getByRole("radio", { name: /Transferencia bancaria/ }).click();
  else
    await expect(
      page.getByRole("radio", { name: /Mercado Pago/ }),
    ).toBeChecked();
  await expect(page.getByRole("radio", { name: /Efectivo/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Revisar pedido" }).click();
  const confirm = page.getByRole("button", {
    name: method === "transfer" ? "Confirmar pedido" : "Ir a Mercado Pago",
  });
  await expect(confirm).toBeEnabled();
  const notice = page.getByRole("note", { name: "Compra de demostración" });
  if (method === "mercado_pago") {
    await expect(notice).toBeVisible();
    await notice.screenshot({
      path: test.info().outputPath("payment-notice.png"),
    });
    await expect(notice).toContainText(
      "VANTA es un proyecto ficticio de portfolio. Estás por ingresar al entorno de pruebas de Mercado Pago. No se realizará ningún cobro real. Utilizá únicamente cuentas y tarjetas de prueba.",
    );
    expect(
      await notice.evaluate(
        (node) =>
          !!(
            node.compareDocumentPosition(
              document.querySelector(".checkout-actions .button.primary")!,
            ) & Node.DOCUMENT_POSITION_FOLLOWING
          ),
      ),
    ).toBe(true);
  } else await expect(notice).toHaveCount(0);
  return { state, orders, transfers, confirm };
}
async function overflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
test("checkout externo, retorno no autoritativo, recuperación al recargar y aprobación del servidor", async ({
  page,
}, info) => {
  const { state, orders, confirm } = await begin(page);
  const bodies: Record<string, unknown>[] = [];
  let approved = false;
  await page.route("**/functions/v1/mp-checkout", (route) => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    expect(Object.keys(body).sort()).toEqual([
      "action",
      "capability",
      "reference",
    ]);
    return route.fulfill({
      json: payment(
        body.action === "create"
          ? { checkout_url: checkout }
          : approved
            ? {
                payment_status: "approved",
                order_status: "confirmed",
                reconciliation: "settled",
              }
            : {},
      ),
    });
  });
  await page.route(checkout, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<h1>Checkout externo simulado</h1><a href="http://127.0.0.1:4176/?status=approved&collection_status=approved#/checkout/pago">Volver a VANTA</a>',
    }),
  );
  await confirm.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(checkout);
  expect(orders).toHaveLength(1);
  expect(bodies).toHaveLength(1);
  await page.getByRole("link", { name: "Volver a VANTA" }).click();
  await expect(
    page.getByRole("heading", { name: "Pago pendiente.", exact: true }),
  ).toBeVisible();
  expect(bodies[1].action).toBe("recover");
  await overflow(page);
  await page.screenshot({
    path: `work/payment-pending-${info.project.name}.png`,
    fullPage: true,
  });
  approved = true;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Pago de prueba aprobado." }),
  ).toBeVisible();
  expect(orders).toHaveLength(1);
  for (const b of bodies) {
    expect(b.reference).toBe(reference);
    expect(b.capability).toBe(bodies[0].capability);
  }
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("vanta.cart.v1") ?? "{}").lines,
    ),
  ).toEqual([]);
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});
test("transferencia ficticia pendiente persiste sin abrir Mercado Pago ni confirmar desde el navegador", async ({
  page,
}, info) => {
  const { state, orders, transfers, confirm } = await begin(page, "transfer");
  let mp = 0;
  await page.route("**/functions/v1/mp-checkout", (route) => {
    mp++;
    return route.abort();
  });
  await confirm.click();
  await expect(
    page.getByText("No transfieras dinero.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Pago pendiente.", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Pagué|Comprobante|Continuar en Mercado Pago/,
    }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText("No transfieras dinero.", { exact: true }),
  ).toBeVisible();
  expect(orders).toHaveLength(1);
  expect(transfers).toHaveLength(2);
  expect(mp).toBe(0);
  expect(Object.keys(transfers[0]).sort()).toEqual([
    "action",
    "capability",
    "reference",
  ]);
  await overflow(page);
  await page.screenshot({
    path: `work/transfer-${info.project.name}.png`,
    fullPage: true,
  });
  expect(state.errors).toEqual([]);
  expect(state.writes).toEqual([]);
});
test("respuesta perdida no repite creación ni borra recuperación; reserva vencida y pago tardío requieren revisión", async ({
  page,
}) => {
  const { orders, confirm } = await begin(page);
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/functions/v1/mp-checkout", (route) => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    if (body.action === "create") return route.abort();
    return route.fulfill({
      json: payment({
        order_status: "expired",
        payment_status: "approved",
        reconciliation: "review",
      }),
    });
  });
  await confirm.click();
  await expect(page.getByRole("alert")).toContainText("incierto");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Pago en revisión." }),
  ).toBeVisible();
  await expect(
    page.getByText(/Una acreditación tardía no reactiva/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Continuar en Mercado Pago|Preparar otra selección/,
    }),
  ).toHaveCount(0);
  expect(orders).toHaveLength(1);
  expect(bodies.map((b) => b.action)).toEqual(["create", "recover"]);
  await overflow(page);
});
test("retorno sin capacidad privada y parámetros falsos no consulta ni acredita pagos", async ({
  page,
}) => {
  const state = await catalog(page);
  let calls = 0;
  await page.route("**/functions/v1/mp-checkout", (route) => {
    calls++;
    return route.abort();
  });
  await page.goto(
    "/?status=approved#/checkout/pago?payment_status=approved&reference=" +
      reference,
  );
  await expect(
    page.getByRole("heading", { name: /No encontramos el acceso/ }),
  ).toBeVisible();
  expect(calls).toBe(0);
  expect(state.errors).toEqual([]);
  await overflow(page);
});

test("rechazo y cancelación provienen del servidor; rutas antiguas y navegación recuperan el mismo pedido", async ({
  page,
}) => {
  const { state, orders, confirm } = await begin(page);
  let cancelled = false;
  await page.route("**/functions/v1/mp-checkout", (route) =>
    route.fulfill({
      json: payment(
        cancelled
          ? {
              payment_status: "cancelled",
              order_status: "cancelled",
              reconciliation: "closed",
            }
          : { payment_status: "rejected" },
      ),
    }),
  );
  // Two synchronous clicks exercise the lock before React can render the disabled state.
  await confirm.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(
    page.getByRole("heading", { name: "Pago de prueba rechazado." }),
  ).toBeVisible();
  expect(orders).toHaveLength(1);
  await page
    .getByRole("link", { name: "Volver a la colección", exact: true })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "Pedido en curso" })
      .getByRole("link", { name: "Consultar mi pago" }),
  ).toBeVisible();
  cancelled = true;
  await page.goto("/?status=approved#/checkout/finalizado");
  await expect(page).toHaveURL(/#\/checkout\/pago$/);
  await expect(
    page.getByRole("heading", { name: "Operación cancelada." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continuar en Mercado Pago" }),
  ).toHaveCount(0);
  expect(orders).toHaveLength(1);
  expect(state.errors).toEqual([]);
  await overflow(page);
});
