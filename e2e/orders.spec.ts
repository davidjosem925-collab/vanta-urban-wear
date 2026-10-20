import { expect, test, type Page } from "@playwright/test";
import { catalog } from "./catalog-fixture";
const variant = "10000000-0000-0000-0000-000000000001";
const result = {
  reference: "20000000-0000-0000-0000-000000000001",
  status: "pending",
  subtotal_cents: 5000100,
  created_at: "2026-10-20T00:00:00Z",
  expires_at: "2026-10-20T01:00:00Z",
  demo: true,
};
async function begin(page: Page) {
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
        body: `window.turnstile={render:(el,o)=>{if(o.size!=='compact')throw Error('Widget demasiado ancho');el.style.width='150px';el.textContent='Verificación de seguridad';o.callback('test-token');return 'fixture';},remove:()=>{}};`,
      }),
  );
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
    page.getByText(/Stock por confirmar. La disponibilidad y la reserva demo/),
  ).toBeVisible();
  for (const [name, value] of [
    ["Nombre", "Lucía"],
    ["Apellido", "Pérez"],
    ["Correo electrónico", "lucia@example.com"],
    ["Teléfono de contacto", "1155551234"],
  ])
    await page.getByLabel(name, { exact: true }).fill(value);
  await page.getByRole("radio", { name: /Retiro en local ficticio/ }).click();
  await page.getByRole("radio", { name: /Efectivo — Demo/ }).click();
  await page.getByRole("button", { name: "Revisar demostración" }).click();
  await expect(
    page.getByRole("button", { name: "Confirmar pedido demo" }),
  ).toBeEnabled();
  return state;
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
test("pedido auténticamente confirmado, carga, privacidad y vaciado solo tras respuesta", async ({
  page,
}, info) => {
  const state = await begin(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let calls = 0;
  await page.route("**/functions/v1/demo-orders", async (route) => {
    calls++;
    const b = route.request().postDataJSON();
    expect(b.payload.items).toEqual([
      { variant_id: variant, quantity: 2, expected_price_cents: 2500050 },
    ]);
    expect(JSON.stringify(b)).not.toMatch(
      /Lucía|Pérez|lucia@example|phone|email|street/,
    );
    await gate;
    await route.fulfill({ json: result });
  });
  await page.getByRole("button", { name: "Confirmar pedido demo" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Confirmando…" }),
  ).toBeDisabled();
  expect(calls).toBe(1);
  expect(
    JSON.parse(
      await page.evaluate(() => localStorage.getItem("vanta.cart.v1") ?? "{}"),
    ).lines,
  ).toHaveLength(1);
  await noOverflow(page);
  release();
  await expect(
    page.getByRole("heading", { name: "Pedido demo registrado." }),
  ).toBeVisible();
  await expect(page.getByText(result.reference, { exact: true })).toBeVisible();
  await expect(page.locator("#contenido")).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("vanta.cart.v1") ?? "{}").lines
            .length,
      ),
    )
    .toBe(0);
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("order-receipt.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Volver a la colección" }).click();
  await expect(
    page.getByRole("heading", { name: "La colección." }),
  ).toBeVisible();
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
  expect(state.writes).toEqual([]);
});
test("error de red y reintento reutilizan la misma clave y no inventan confirmación", async ({
  page,
}) => {
  await begin(page);
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/functions/v1/demo-orders", async (route) => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) return route.abort();
    return route.fulfill({ json: result });
  });
  await page.getByRole("button", { name: "Confirmar pedido demo" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "carrito permanece intacto",
  );
  await expect(page.getByText(result.reference)).toHaveCount(0);
  expect(
    JSON.parse(
      await page.evaluate(() => localStorage.getItem("vanta.cart.v1") ?? "{}"),
    ).lines,
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Confirmar pedido demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Pedido demo registrado." }),
  ).toBeVisible();
  expect(bodies[1].idempotency_key).toBe(bodies[0].idempotency_key);
  expect(bodies[1].capability).toBe(bodies[0].capability);
});
test("stock y precio rechazados conservan selección y permiten revisar el carrito", async ({
  page,
}) => {
  const state = await begin(page);
  let calls = 0;
  await page.route("**/functions/v1/demo-orders", (route) =>
    route.fulfill({
      status: 409,
      json: { error: ++calls === 1 ? "INSUFFICIENT_STOCK" : "PRICE_CHANGED" },
    }),
  );
  await page.getByRole("button", { name: "Confirmar pedido demo" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "No hay unidades suficientes",
  );
  await noOverflow(page);
  await page.getByRole("button", { name: "Confirmar pedido demo" }).click();
  await expect(page.getByRole("alert")).toContainText("Cambió un precio");
  await page
    .getByRole("alert")
    .getByRole("button", { name: "Revisar carrito" })
    .click();
  await expect(page.getByRole("dialog", { name: "Tu carrito" })).toBeVisible();
  expect(state.errors).toEqual([]);
});
test("navegar durante la confirmación preserva unidades nuevas; respuesta inválida no vacía", async ({
  page,
}) => {
  const state = await begin(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let calls = 0;
  await page.route("**/functions/v1/demo-orders", async (route) => {
    if (++calls === 1)
      return route.fulfill({ json: { ...result, reference: "inventada" } });
    await gate;
    return route.fulfill({ json: result });
  });
  await page.getByRole("button", { name: "Confirmar pedido demo" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "carrito permanece intacto",
  );
  await page.getByRole("button", { name: "Confirmar pedido demo" }).click();
  await expect(
    page.getByRole("button", { name: "Confirmando…" }),
  ).toBeDisabled();
  await page.evaluate(() => {
    window.location.hash = "/producto/remera-essential";
  });
  await page.getByRole("button", { name: "Negro", exact: true }).click();
  await page.getByRole("button", { name: "M", exact: true }).click();
  await page
    .getByRole("button", { name: "Agregar al carrito", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Producto agregado" }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("heading", { name: "Pedido demo registrado." }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("vanta.cart.v1") ?? "{}").lines[0]
            ?.quantity,
      ),
    )
    .toBe(1);
  await noOverflow(page);
  expect(state.errors).toEqual([]);
});
test("recuperación tras recargar con carrito vacío no exige repetir formulario ni crea otra clave", async ({
  page,
}) => {
  await begin(page);
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/functions/v1/demo-orders", async (route) => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) return route.abort();
    return route.fulfill({ json: result });
  });
  await page.getByRole("button", { name: "Confirmar pedido demo" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "carrito permanece intacto",
  );
  await page.evaluate(() =>
    localStorage.setItem(
      "vanta.cart.v1",
      JSON.stringify({ version: 1, lines: [] }),
    ),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Tu selección está vacía." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Consultar confirmación pendiente" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Pedido demo registrado." }),
  ).toBeVisible();
  expect(bodies[1].idempotency_key).toBe(bodies[0].idempotency_key);
  expect(bodies[1].challenge).toBe("");
  await noOverflow(page);
});
