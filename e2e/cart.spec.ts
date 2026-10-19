import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { categories, product } from "../src/test/fixtures";

// Exercises the real Supabase client/service while preventing all remote traffic.
async function catalog(page: Page) {
  const state = {
    price: product.price_cents,
    offline: false,
    writes: [] as string[],
    unexpected: [] as string[],
  };
  const photo = await readFile("public/images/vanta-editorial.webp");
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === "http://127.0.0.1:4175") return route.continue();
    if (url.hostname !== "vanta-cart-fixture.supabase.co") {
      state.unexpected.push(request.url());
      return route.abort();
    }
    const path = url.pathname;
    if (path.startsWith("/rest/v1/")) {
      if (request.method() !== "GET") {
        state.writes.push(path);
        return route.abort();
      }
      if (state.offline)
        return route.fulfill({
          status: 403,
          json: { message: "offline fixture" },
        });
      if (path.endsWith("/categories"))
        return route.fulfill({ json: categories });
      if (path.endsWith("/products"))
        return route.fulfill({
          json: [{ ...product, price_cents: state.price }],
        });
      if (path.endsWith("/product_variants"))
        return route.fulfill({ json: product.variants });
      if (path.endsWith("/product_images"))
        return route.fulfill({
          json: product.images.map(
            ({ id, product_id, storage_path, alt, position }) => ({
              id,
              product_id,
              storage_path,
              alt,
              position,
            }),
          ),
        });
    }
    if (path.startsWith("/storage/v1/object/sign/product-images")) {
      if (request.method() === "GET")
        return route.fulfill({ contentType: "image/webp", body: photo });
      const body = request.postDataJSON();
      if (request.method() === "POST" && Array.isArray(body.paths))
        return route.fulfill({
          json: body.paths.map((path: string) => ({
            path,
            signedURL: `/object/sign/product-images/${path}?token=fixture`,
          })),
        });
      if (request.method() === "POST" && typeof body.expiresIn === "number")
        return route.fulfill({
          json: {
            signedURL: `/object/sign/product-images/fixture?token=renewed`,
          },
        });
    }
    state.unexpected.push(path);
    return route.abort();
  });
  return state;
}
async function add(page: Page, color = "Negro", size = "M") {
  await page.getByRole("button", { name: color, exact: true }).click();
  await page.getByRole("button", { name: size, exact: true }).click();
  await page
    .getByRole("button", { name: "Agregar al carrito", exact: true })
    .click();
  await expect(page.getByText("Prenda agregada al carrito.")).toBeVisible();
}
async function panel(page: Page) {
  // The page can be scrolled to the quantity field on a phone; return to the header.
  await page.getByRole("button", { name: /^Abrir carrito/ }).click();
  const dialog = page.getByRole("dialog", { name: "Tu carrito", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Verificando prenda y precio…")).toHaveCount(0);
  return dialog;
}
test("responsive: selección, variantes, cantidades, persistencia y vaciado", async ({
  page,
}, testInfo) => {
  const state = await catalog(page);
  await page.goto("/#/producto/remera-essential");
  await page
    .getByRole("button", { name: "Agregar al carrito", exact: true })
    .click();
  await expect(
    page.getByText("Seleccioná talle y color antes de agregar la prenda."),
  ).toBeVisible();
  await add(page);
  await add(page);
  await add(page, "Grafito", "L");
  let dialog = await panel(page);
  await expect(dialog.getByRole("listitem")).toHaveCount(2);
  await expect(dialog.getByText("3 unidades")).toBeVisible();
  const qty = dialog.getByRole("group", { name: /Negro, M/ });
  await qty.getByRole("button", { name: /^Aumentar/ }).click();
  await expect(dialog.getByText("4 unidades")).toBeVisible();
  await qty.getByRole("button", { name: /^Disminuir/ }).click();
  await expect(dialog.getByText("3 unidades")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /Continuar compra/ }),
  ).toBeDisabled();
  expect(
    await page.locator("body").evaluate((body) => body.style.overflow),
  ).toBe("hidden");
  expect(await dialog.evaluate((d) => d.scrollWidth <= d.clientWidth)).toBe(
    true,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const button of await dialog
    .locator(".cart-quantity button, .cart-close")
    .all()) {
    const box = await button.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  if (testInfo.project.name !== "desktop") {
    expect(
      await dialog
        .locator(".cart-scroll")
        .evaluate((element) => element.scrollHeight > element.clientHeight),
    ).toBe(true);
    await dialog.locator(".cart-scroll").evaluate((element) => {
      element.scrollTop = 200;
    });
    expect(
      await dialog
        .locator(".cart-scroll")
        .evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(0);
  }
  await page.screenshot({ path: testInfo.outputPath("cart.png") });
  await dialog.getByRole("button", { name: "Cerrar carrito" }).click();
  await page.reload();
  dialog = await panel(page);
  await expect(dialog.getByText("3 unidades")).toBeVisible();
  const stored = await page.evaluate(() =>
    localStorage.getItem("vanta.cart.v1"),
  );
  expect(stored).not.toMatch(/price|stock|url|token/);
  await dialog
    .getByRole("button", { name: "Vaciar carrito", exact: true })
    .click();
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog.getByRole("listitem")).toHaveCount(2);
  await dialog.getByRole("button", { name: /^Eliminar.*Grafito/ }).click();
  await expect(dialog.getByRole("listitem")).toHaveCount(1);
  await dialog
    .getByRole("button", { name: "Vaciar carrito", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Sí, vaciar" }).click();
  await expect(
    dialog.getByText("Todavía no agregaste prendas a tu carrito."),
  ).toBeVisible();
  expect(state.writes).toEqual([]);
  expect(state.unexpected).toEqual([]);
});
test("accesibilidad: foco modal, Escape, cierre exterior, menú y movimiento reducido", async ({
  page,
}, testInfo) => {
  await catalog(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/catalogo");
  if (testInfo.project.name !== "desktop") {
    await page.getByRole("button", { name: "Abrir menú" }).click();
    await expect(
      page
        .getByRole("navigation", { name: "Navegación principal" })
        .getByRole("link", { name: "Inicio", exact: true }),
    ).toBeVisible();
  }
  const trigger = page.getByRole("button", { name: /^Abrir carrito/ });
  const dialog = await panel(page);
  await expect(
    dialog.getByRole("button", { name: "Cerrar carrito" }),
  ).toBeFocused();
  expect(await dialog.evaluate((d) => getComputedStyle(d).animationName)).toBe(
    "none",
  );
  if (testInfo.project.name !== "desktop")
    await expect(page.locator("#menu-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((d) => d.contains(document.activeElement)),
    ).toBe(true);
  }
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(
      await dialog.evaluate((d) => d.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await panel(page);
  if (testInfo.project.name === "desktop") await page.mouse.click(10, 200);
  else await dialog.getByRole("button", { name: "Cerrar carrito" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(
    await page.locator("body").evaluate((body) => body.style.overflow),
  ).toBe("");
});
test("precios actuales, error de red y datos locales manipulados", async ({
  page,
}) => {
  const state = await catalog(page);
  await page.goto("/#/producto/remera-essential");
  await add(page);
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem("vanta.cart.v1")!);
    data.lines[0].price_cents = 1;
    data.lines[0].stock = 999;
    localStorage.setItem("vanta.cart.v1", JSON.stringify(data));
  });
  state.price = 8_000_099;
  await page.reload();
  const dialog = await panel(page);
  await expect(dialog.locator(".cart-total strong")).toHaveText(/80\.000,99/);
  await dialog.getByRole("button", { name: "Cerrar carrito" }).click();
  state.offline = true;
  await panel(page);
  await expect(dialog.locator(".cart-total strong")).toHaveText(
    "Por confirmar",
  );
  await expect(dialog.locator(".cart-subtotal")).toHaveCount(0);
  state.offline = false;
  await dialog
    .getByRole("button", { name: "Volver a verificar catálogo" })
    .click();
  await expect(dialog.locator(".cart-total strong")).toHaveText(/80\.000,99/);
  await dialog.getByRole("button", { name: "Cerrar carrito" }).click();
  await page.evaluate(() => localStorage.setItem("vanta.cart.v1", "corrupt"));
  await page.reload();
  await panel(page);
  await expect(dialog.getByRole("alert")).toContainText("descartamos");
  await expect(dialog.getByText("0 unidades")).toBeVisible();
  expect(state.writes).toEqual([]);
  expect(state.unexpected).toEqual([]);
});
