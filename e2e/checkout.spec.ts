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
    .getByRole("button", { name: "Continuar al checkout" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Finalizar compra", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".mobile-cart-bar")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Revisar pedido" }),
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
      page.getByRole("button", { name: "Confirmar selección" }),
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
  await page.getByRole("radio", { name: /Retiro en local/ }).check();
  await page.getByRole("radio", { name: /Efectivo/ }).check();
  await page.getByRole("button", { name: "Revisar pedido" }).click();
  await expect(
    page.getByRole("heading", { name: "Todo en su lugar." }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(/Completá tus datos, entrega y método/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirmar selección" }),
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
  await page.getByRole("button", { name: "Revisar pedido" }).click();
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
  await page.getByRole("radio", { name: /Retiro en local/ }).check();
  await expect(page.getByLabel("Provincia", { exact: true })).toHaveCount(0);
  await page.getByRole("radio", { name: /Efectivo/ }).check();
  await noOverflow(page);
  await capture(page, testInfo.outputPath("checkout-pickup.png"));
  await page.getByRole("button", { name: "Revisar pedido" }).click();
  await expect(
    page.getByText("lucia@example.com", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Editar información" }).click();
  await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue("Lucía");
  await expect(
    page.getByRole("radio", { name: /Efectivo/ }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Volver al carrito" }).click();
  const dialog = page.getByRole("dialog", { name: "Tu carrito", exact: true });
  await dialog.getByRole("button", { name: /^Aumentar/ }).click();
  await expect(dialog.getByText("3 unidades", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cerrar carrito" }).click();
  if (page.viewportSize()!.width <= 767)
    await page.getByText("Ver productos", { exact: true }).click();
  await expect(
    page.getByRole("complementary").getByText("Cantidad: 3"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Revisar pedido" }).click();
  await expect(page.locator(".checkout-total strong")).toHaveText(/75\.001,50/);
  if (page.viewportSize()!.width <= 767)
    await page.getByText("Ver productos", { exact: true }).click();
  await expect(
    page.getByRole("complementary").getByRole("img"),
  ).toHaveAttribute("src", /vanta-thumb-v1\.webp/);
  await noOverflow(page);
  await capture(page, testInfo.outputPath("checkout-review.png"));
  await page.getByRole("button", { name: "Confirmar selección" }).click();
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
  await page.getByRole("radio", { name: /Retiro en local/ }).check();
  await page.getByRole("radio", { name: /Efectivo/ }).check();
  await page.getByRole("radio", { name: /Envío a domicilio/ }).check();
  await expect(
    page.getByRole("radio", { name: /Efectivo/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("radio", { name: /Efectivo/ }),
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
    .getByRole("radio", { name: /Transferencia bancaria/ })
    .check();
  await expect(page.getByText(/Efectivo solo está disponible/)).toHaveCount(0);
  await noOverflow(page);
  await capture(page, testInfo.outputPath("checkout-shipping.png"));
  await page.getByRole("button", { name: "Revisar pedido" }).click();
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
    page.getByRole("button", { name: "Confirmar selección" }),
  ).toBeDisabled();
  await expect(
    page.getByText(/No pudimos verificar toda la selección/),
  ).toBeVisible();
  state.published = true;
  await page.getByRole("button", { name: "Reintentar verificación" }).click();
  await expect(
    page.getByRole("button", { name: "Confirmar selección" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Confirmar selección" }).click();
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

test("resumen responsive con ocho prendas: contraer, teclado y datos compartidos", async ({
  page,
}, testInfo) => {
  const state = await catalog(page);
  // Eight fixture-only variants exercise a long selection without remote catalog changes.
  const variants = ["Negro", "Grafito"].flatMap((color, c) =>
    ["S", "M", "L", "XL"].map((size, s) => ({
      ...state.variants[0],
      id: `demo-variant-${c}-${s}`,
      sku: `DEMO-${c}-${s}`,
      color,
      size,
    })),
  );
  state.variants = variants;
  await page.addInitScript(
    (rows) =>
      localStorage.setItem(
        "vanta.cart.v1",
        JSON.stringify({
          version: 1,
          lines: rows.map((variant) => ({
            slug: "remera-essential",
            productId: variant.product_id,
            variantId: variant.id,
            quantity: 2,
          })),
        }),
      ),
    variants,
  );
  await page.goto("/#/checkout");
  await expect(
    page.getByRole("button", { name: "Revisar pedido" }),
  ).toBeEnabled();
  await contact(page);
  await page.getByRole("radio", { name: /Retiro en local/ }).check();
  await page.getByRole("radio", { name: /Efectivo/ }).check();
  const summary = page.getByRole("complementary", {
    name: "Resumen de la selección",
  });
  const mobile = page.viewportSize()!.width <= 767;
  const control = summary.locator("summary");
  await expect(summary.getByText("16 unidades", { exact: true })).toBeVisible();
  await expect(summary.locator(".checkout-total strong")).toHaveText(
    /400\.008/,
  );
  await expect(summary.getByText("Retiro en local · Sin costo")).toBeVisible();
  await expect(
    summary.getByText("Efectivo", { exact: true }),
  ).toBeVisible();
  await expect(
    summary.getByRole("button", { name: "Modificar carrito" }),
  ).toBeVisible();
  if (mobile) {
    await expect(control).toHaveText("Ver productos");
    await expect(control).toHaveAccessibleName("Ver productos");
    await expect(control).toHaveAttribute("aria-expanded", "false");
    await expect(summary.getByRole("listitem")).toHaveCount(0);
    await expect(control).toHaveAttribute("aria-controls", /.+/);
    expect((await summary.boundingBox())!.height).toBeLessThan(650);
    await capture(page, testInfo.outputPath("summary-collapsed.png"));
    await control.focus();
    await page.keyboard.press("Enter");
    await expect(control).toHaveText("Ocultar productos");
    await expect(control).toHaveAccessibleName("Ocultar productos");
    await expect(control).toHaveAttribute("aria-expanded", "true");
    await expect(control).toBeFocused();
  } else {
    await expect(control).toHaveAttribute("aria-expanded", "true");
    await expect(control).toContainText("Tu selección");
  }
  await expect(summary.getByRole("listitem")).toHaveCount(8);
  await expect(summary.getByRole("img")).toHaveCount(8);
  await expect(
    summary.getByText("Talle S / Negro", { exact: true }),
  ).toBeVisible();
  if (mobile) {
    // The full page scrolls; neither the list nor its summary becomes a nested scroller.
    expect(
      await summary.evaluate((el) =>
        [el, el.querySelector("ul")!].every(
          (node) =>
            !["auto", "scroll"].includes(getComputedStyle(node).overflowY),
        ),
      ),
    ).toBe(true);
    await capture(page, testInfo.outputPath("summary-expanded.png"));
    await control.focus();
    await page.keyboard.press("Space");
    await expect(control).toHaveText("Ver productos");
    await expect(control).toHaveAttribute("aria-expanded", "false");
    await expect(control).toBeFocused();
    await expect(summary.getByRole("listitem")).toHaveCount(0);
    await expect(summary.locator(".checkout-total strong")).toHaveText(
      /400\.008/,
    );
  }
  await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue("Lucía");
  await expect(
    page.getByRole("radio", { name: /Efectivo/ }),
  ).toBeChecked();
  await summary.getByRole("button", { name: "Modificar carrito" }).click();
  const dialog = page.getByRole("dialog", { name: "Tu carrito", exact: true });
  await expect(dialog.getByRole("listitem")).toHaveCount(8);
  await dialog.getByRole("button", { name: "Cerrar carrito" }).click();
  await expect(
    summary.getByRole("button", { name: "Modificar carrito" }),
  ).toBeFocused();
  if (page.viewportSize()!.width === 393) {
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 820, height: 1180 });
    await expect(control).toHaveAttribute("aria-expanded", "true");
    await expect(control).toContainText("Tu selección");
    await page.setViewportSize(viewport);
    await expect(control).toHaveText("Ver productos");
    await expect(control).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue(
      "Lucía",
    );
  }
  await page.getByRole("button", { name: "Revisar pedido" }).click();
  await expect(
    page.getByRole("heading", { name: "Todo en su lugar." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirmar selección" }),
  ).toBeEnabled();
  if (mobile)
    await expect(
      page.getByText("Ver productos", { exact: true }),
    ).toBeVisible();
  await noOverflow(page);
  expect(state.errors).toEqual([]);
  expect(state.consoleErrors).toEqual([]);
  expect(state.writes).toEqual([]);
  expect(state.unexpected).toEqual([]);
});
