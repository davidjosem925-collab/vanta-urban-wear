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
async function begin(page: Page, manualChallenge = false) {
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
        body: `window.turnstile={render:(el,o)=>{if(o.size!=='compact')throw Error('Widget demasiado ancho');el.style.width='150px';el.textContent='Verificación de seguridad';${manualChallenge ? `const b=document.createElement('button');b.textContent='Verificar prueba';b.onclick=()=>o.callback('token-'+crypto.randomUUID());el.append(b);` : `o.callback('test-token');`}return 'fixture';},remove:()=>{}};`,
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
  await page.getByRole("button", { name: "Continuar al checkout" }).click();
  await expect(
    page.getByText(/La disponibilidad se verifica al confirmar el pedido/),
  ).toBeVisible();
  for (const [name, value] of [
    ["Nombre", "Lucía"],
    ["Apellido", "Pérez"],
    ["Correo electrónico", "lucia@example.com"],
    ["Teléfono de contacto", "1155551234"],
  ])
    await page.getByLabel(name, { exact: true }).fill(value);
  await page.getByRole("radio", { name: /Retiro en local/ }).click();
  await page.getByRole("radio", { name: /Efectivo/ }).click();
  await page.getByRole("button", { name: "Revisar pedido" }).click();
  const confirm = page.getByRole("button", { name: "Confirmar pedido" });
  if (manualChallenge) await expect(confirm).toBeDisabled();
  else await expect(confirm).toBeEnabled();
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
  await page.getByRole("button", { name: "Confirmar pedido" }).focus();
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
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "carrito permanece intacto",
  );
  await expect(page.getByText(result.reference)).toHaveCount(0);
  expect(
    JSON.parse(
      await page.evaluate(() => localStorage.getItem("vanta.cart.v1") ?? "{}"),
    ).lines,
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
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
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "No hay unidades suficientes",
  );
  await noOverflow(page);
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
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
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "carrito permanece intacto",
  );
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
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
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
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
  expect(bodies[1].action).toBe("recover");
  expect(bodies[1]).not.toHaveProperty("challenge");
  await noOverflow(page);
});

test("recuperación inexistente y token consumido retoman la misma selección sin duplicar el intento", async ({
  page,
}) => {
  const state = await begin(page, true);
  const bodies: Record<string, unknown>[] = [];
  let creates = 0;
  await page.route("**/functions/v1/demo-orders", async (route) => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    if (body.action === "recover") {
      expect(body).not.toHaveProperty("challenge");
      return route.fulfill({ json: { found: false } });
    }
    if (++creates === 1) return route.abort();
    if (creates === 2)
      return route.fulfill({
        status: 403,
        json: { error: "CHALLENGE_EXPIRED" },
      });
    return route.fulfill({ json: result });
  });
  const confirm = page.getByRole("button", { name: "Confirmar pedido" });
  await page.getByRole("button", { name: "Verificar prueba" }).click();
  await expect(confirm).toBeEnabled();
  await page.getByRole("link", { name: "Editar información" }).click();
  await page.getByRole("button", { name: "Revisar pedido" }).click();
  await expect(confirm).toBeDisabled();
  await page.getByRole("button", { name: "Verificar prueba" }).click();
  await confirm.click();
  await expect(page.getByRole("alert")).toContainText(
    "carrito permanece intacto",
  );
  await expect(confirm).toBeDisabled();
  await page
    .getByRole("button", { name: "Consultar confirmación pendiente" })
    .click();
  await expect(
    page.getByText(/Todavía no hay una confirmación registrada/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Consultar confirmación pendiente" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Volver a la revisión" }).click();
  await page.getByRole("button", { name: "Verificar prueba" }).click();
  await confirm.click();
  await expect(page.getByRole("alert")).toContainText("HTTP 403");
  await expect(confirm).toBeDisabled();
  await expect(page.getByText(result.reference)).toHaveCount(0);
  expect(
    JSON.parse(
      await page.evaluate(() => localStorage.getItem("vanta.cart.v1") ?? "{}"),
    ).lines,
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Verificar prueba" }).click();
  await confirm.click();
  await expect(
    page.getByRole("heading", { name: "Pedido demo registrado." }),
  ).toBeVisible();
  expect(bodies).toHaveLength(4);
  for (const body of bodies) {
    expect(body.idempotency_key).toBe(bodies[0].idempotency_key);
    expect(body.capability).toBe(bodies[0].capability);
    expect(body.payload).toEqual(bodies[0].payload);
  }
  const tokens = bodies
    .filter((b) => b.action === "create")
    .map((b) => b.challenge);
  expect(new Set(tokens).size).toBe(3);
  await noOverflow(page);
  expect(state.errors).toEqual([]);
  expect(state.writes).toEqual([]);
});
