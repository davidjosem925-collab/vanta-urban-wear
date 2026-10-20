import { test, expect, type Page } from "@playwright/test";
import { catalog } from "./catalog-fixture";

async function begin(page: Page) {
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
    page.getByRole("heading", { name: "Checkout de demostración", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".mobile-cart-bar")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Revisar demostración" }),
  ).toBeEnabled();
}
async function contact(page: Page) {
  await page.getByLabel("Nombre", { exact: true }).fill("Lucía");
  await page.getByLabel("Apellido", { exact: true }).fill("Pérez");
  await page
    .getByLabel("Correo electrónico", { exact: true })
    .fill("lucia@example.com");
  await page
    .getByLabel("Teléfono de contacto", { exact: true })
    .fill("+54 9 11 5555-1234");
}
async function capture(page: Page, path: string) {
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path, fullPage: true });
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function onlyCartStored(page: Page) {
  const storage = await page.evaluate(() => ({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }));
  expect(JSON.stringify(storage)).not.toMatch(
    /lucia|Lucía|Pérez|email|phone|Calle de prueba/,
  );
  expect(Object.keys(storage.local)).toEqual(["vanta.cart.v1"]);
  expect(storage.session).toEqual({});
}

test("checkout vacío, recarga y acceso directo no simulan una finalización", async ({
  page,
}) => {
  const state = await catalog(page);
  for (const path of ["checkout", "checkout/revision", "checkout/finalizado"]) {
    await page.goto(`/#/${path}`);
    await expect(
      page.getByRole("heading", { name: "Tu selección está vacía." }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Finalizar demostración" }),
    ).toHaveCount(0);
    await noOverflow(page);
  }
  await begin(page);
  await page.getByLabel("Nombre", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Apellido", { exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByLabel("Nombre", { exact: true })).toBeFocused();
  await contact(page);
  await page.getByRole("radio", { name: /Retiro en local ficticio/ }).check();
  await page.getByRole("radio", { name: /Efectivo — Demo/ }).check();
  await page.getByRole("button", { name: "Revisar demostración" }).click();
  await expect(
    page.getByRole("heading", { name: "Todo en su lugar." }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(/Completá tus datos, entrega y método/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Finalizar demostración" }),
  ).toHaveCount(0);
  await page.goto("/#/checkout/finalizado");
  await expect(
    page.getByRole("heading", { name: "Recorrido de compra completado." }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Abrir carrito, 2 unidades" }),
  ).toBeVisible();
  await onlyCartStored(page);
  expect(state.errors).toEqual([]);
  expect(state.consoleErrors).toEqual([]);
  expect(state.writes).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test("checkout de retiro: validación accesible, edición, carrito compartido y finalización demo", async ({
  page,
}, testInfo) => {
  const state = await catalog(page);
  await begin(page);
  await page.getByRole("button", { name: "Revisar demostración" }).click();
  await expect(page.getByRole("alert")).toContainText("Revisá los campos");
  await expect(page.getByLabel("Nombre", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Nombre", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(
    page.getByLabel("Nombre", { exact: true }),
  ).toHaveAccessibleDescription(/Ingresá tu nombre/);
  await contact(page);
  await page.getByRole("radio", { name: /Retiro en local ficticio/ }).check();
  await expect(page.getByLabel("Provincia", { exact: true })).toHaveCount(0);
  await page.getByRole("radio", { name: /Efectivo — Demo/ }).check();
  await noOverflow(page);
  await capture(page, testInfo.outputPath("checkout-pickup.png"));
  await page.getByRole("button", { name: "Revisar demostración" }).click();
  await expect(
    page.getByText("lucia@example.com", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Editar información" }).click();
  await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue("Lucía");
  await expect(
    page.getByRole("radio", { name: /Efectivo — Demo/ }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Volver al carrito" }).click();
  const dialog = page.getByRole("dialog", { name: "Tu carrito", exact: true });
  await dialog.getByRole("button", { name: /^Aumentar/ }).click();
  await expect(dialog.getByText("3 unidades", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cerrar carrito" }).click();
  await expect(
    page.getByRole("complementary").getByText("Cantidad: 3"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Revisar demostración" }).click();
  await expect(page.locator(".checkout-total strong")).toHaveText(/75\.001,50/);
  await expect(
    page.getByRole("complementary").getByRole("img"),
  ).toHaveAttribute("src", /vanta-thumb-v1\.webp/);
  await noOverflow(page);
  await capture(page, testInfo.outputPath("checkout-review.png"));
  await page.getByRole("button", { name: "Finalizar demostración" }).click();
  await expect(
    page.getByRole("heading", { name: "Recorrido de compra completado." }),
  ).toBeVisible();
  await expect(
    page.getByText(/No se realizó ningún cobro ni se registró un pedido real/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Abrir carrito, 3 unidades" }),
  ).toBeVisible();
  await onlyCartStored(page);
  await noOverflow(page);
  await capture(page, testInfo.outputPath("checkout-complete.png"));
  await page.getByRole("link", { name: "Volver a la colección" }).click();
  await expect(
    page.getByRole("heading", { name: /Toda la colección/ }),
  ).toBeVisible();
  expect(state.errors).toEqual([]);
  expect(state.consoleErrors).toEqual([]);
  expect(state.writes).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test("checkout de envío: dirección, efectivo incompatible y revalidación de precios/variantes", async ({
  page,
}, testInfo) => {
  const state = await catalog(page);
  await begin(page);
  await contact(page);
  await page.getByRole("radio", { name: /Retiro en local ficticio/ }).check();
  await page.getByRole("radio", { name: /Efectivo — Demo/ }).check();
  await page.getByRole("radio", { name: /Envío a domicilio/ }).check();
  await expect(
    page.getByRole("radio", { name: /Efectivo — Demo/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("radio", { name: /Efectivo — Demo/ }),
  ).not.toBeChecked();
  await expect(page.getByText(/Efectivo solo está disponible/)).toBeVisible();
  await page
    .getByLabel("Provincia", { exact: true })
    .selectOption("Buenos Aires");
  for (const [name, value] of [
    ["Localidad", "La Plata"],
    ["Código postal", "1900"],
    ["Calle", "Calle de prueba"],
    ["Altura", "123"],
    ["Piso/departamento (opcional)", "2 B"],
    [
      "Indicaciones para la entrega (opcional)",
      "Datos ficticios para portfolio.",
    ],
  ])
    await page.getByLabel(name, { exact: true }).fill(value);
  await page
    .getByRole("radio", { name: /Transferencia bancaria — Demo/ })
    .check();
  await expect(page.getByText(/Efectivo solo está disponible/)).toHaveCount(0);
  await noOverflow(page);
  await capture(page, testInfo.outputPath("checkout-shipping.png"));
  await page.getByRole("button", { name: "Revisar demostración" }).click();
  await expect(
    page.getByText("Calle de prueba 123 · 2 B", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByText(
        "Envío a coordinar. El costo de envío no está incluido en el subtotal.",
      )
      .first(),
  ).toBeVisible();
  state.price = 2700000;
  await page.evaluate(() => dispatchEvent(new Event("focus")));
  await expect(page.locator(".checkout-total strong")).toHaveText(/54\.000/);
  state.published = false;
  await page.evaluate(() => dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("button", { name: "Finalizar demostración" }),
  ).toBeDisabled();
  await expect(
    page.getByText(/No pudimos verificar toda la selección/),
  ).toBeVisible();
  state.published = true;
  await page.getByRole("button", { name: "Reintentar verificación" }).click();
  await expect(
    page.getByRole("button", { name: "Finalizar demostración" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Finalizar demostración" }).click();
  await expect(
    page.getByRole("heading", { name: "Recorrido de compra completado." }),
  ).toBeVisible();
  await onlyCartStored(page);
  await noOverflow(page);
  expect(state.errors).toEqual([]);
  expect(state.consoleErrors).toEqual([]);
  expect(state.writes).toEqual([]);
  expect(state.unexpected).toEqual([]);
});
