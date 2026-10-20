import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { categories, product } from "../src/test/fixtures";

// Exercises the real Supabase client/service while preventing all remote traffic.
async function catalog(page: Page) {
  const state = {
    price: product.price_cents,
    photos: [] as string[],
    signatures: 0,
    categoryId: product.category_id,
    offline: false,
    errors: [] as string[],
    consoleErrors: [] as string[],
    writes: [] as string[],
    unexpected: [] as string[],
  };
  page.on("pageerror", (error) => state.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") state.consoleErrors.push(message.text());
  });
  const allCategories = [
    ...categories,
    {
      ...categories[0],
      id: "cat-pants",
      name: "Pantalones",
      slug: "pantalones",
    },
    { ...categories[0], id: "cat-sets", name: "Conjuntos", slug: "conjuntos" },
  ];
  const rows = [
    ...product.images,
    ...product.images.flatMap((image) =>
      ["thumb", "card", "detail"].map((profile, i) => ({
        ...image,
        id: `${image.id}-${profile}`,
        position: 10000 + i,
        storage_path: `${image.storage_path}.vanta-${profile}-v1.webp`,
      })),
    ),
  ];
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
        return route.fulfill({ json: allCategories });
      if (path.endsWith("/products"))
        return route.fulfill({
          json: [
            {
              ...product,
              category_id: state.categoryId,
              price_cents: state.price,
            },
          ],
        });
      if (path.endsWith("/product_variants"))
        return route.fulfill({ json: product.variants });
      if (path.endsWith("/product_images"))
        return route.fulfill({
          json: rows.map(({ id, product_id, storage_path, alt, position }) => ({
            id,
            product_id,
            storage_path,
            alt,
            position,
          })),
        });
    }
    if (path.startsWith("/storage/v1/object/sign/product-images")) {
      if (request.method() === "GET") {
        state.photos.push(path);
        return route.fulfill({ contentType: "image/webp", body: photo });
      }
      const body = request.postDataJSON();
      state.signatures++;
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
  await expect(page.getByRole("dialog")).toHaveCount(0);
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
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await add(page);
  await add(page);
  await add(page, "Grafito", "L");
  let dialog = await panel(page);
  await expect(dialog.getByRole("listitem")).toHaveCount(2);
  await expect(dialog.getByText("3 unidades")).toBeVisible();
  const qty = dialog.getByRole("group", { name: /Negro, M/ });
  const beforeChange = await qty.boundingBox();
  await qty.getByRole("button", { name: /^Aumentar/ }).click();
  await expect(dialog.getByText("4 unidades")).toBeVisible();
  expect(
    Math.abs((await qty.boundingBox())!.y - beforeChange!.y),
  ).toBeLessThanOrEqual(1);
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
  if (page.viewportSize()!.width <= 760) {
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
  expect(state.errors).toEqual([]);
  expect(state.consoleErrors).toEqual([]);
});
test("accesibilidad: foco modal, Escape, cierre exterior, menú y movimiento reducido", async ({
  page,
}) => {
  await catalog(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/catalogo");
  if (page.viewportSize()!.width <= 760) {
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
  if (page.viewportSize()!.width <= 760)
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
  if (page.viewportSize()!.width > 760) await page.mouse.click(10, 200);
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

test("notificación no interrumpe, se actualiza y permite abrir el carrito", async ({
  page,
}, testInfo) => {
  const state = await catalog(page);
  state.price = 2_700_000;
  await page.goto("/#/producto/remera-essential");
  await page.getByRole("button", { name: "Negro", exact: true }).click();
  await page.getByRole("button", { name: "M", exact: true }).click();
  await page.getByLabel("Cantidad", { exact: true }).fill("2");
  const button = page.getByRole("button", {
    name: "Agregar al carrito",
    exact: true,
  });
  await button.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  await button.click();
  const notice = page.getByRole("region", { name: "Producto agregado" });
  await expect(notice).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(notice.getByText(product.name)).toBeVisible();
  await expect(notice.getByText(/2 unidades agregadas/)).toBeVisible();
  await expect(notice.getByRole("img")).toHaveAttribute("loading", "eager");
  expect(await page.evaluate(() => scrollY)).toBe(before);
  await expect(button).toBeFocused();
  await page.getByLabel("Cantidad", { exact: true }).fill("1");
  await button.click();
  await expect(notice.getByText(/1 unidad agregada/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Abrir carrito, 3 unidades" }),
  ).toBeAttached();
  await expect(notice).toHaveCSS("opacity", "1");
  await page.screenshot({ path: testInfo.outputPath("notification.png") });
  await notice
    .getByRole("button", { name: "Ver carrito", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Tu carrito", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".cart-total strong")).toHaveText(/81\.000/);
  await expect(page.locator(".mobile-cart-bar")).not.toBeVisible();
  await dialog.getByRole("button", { name: "Cerrar carrito" }).click();
  await expect(
    page.getByRole("button", { name: "Abrir carrito, 3 unidades" }),
  ).toBeFocused();
  if (page.viewportSize()!.width <= 760) {
    const floating = page.locator(".mobile-cart-bar");
    await expect(floating).toBeVisible();
    await floating.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cerrar carrito" }).click();
    await expect(floating).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(floating).toBeFocused();
  } else await expect(page.locator(".mobile-cart-bar")).not.toBeVisible();
  await page.getByRole("link", { name: "VANTA, inicio" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Presencia",
  );
  await page.reload();
  await panel(page);
  await expect(dialog.getByText("3 unidades")).toBeVisible();
  expect(state.errors).toEqual([]);
  expect(state.consoleErrors).toEqual([]);
  expect(state.writes).toEqual([]);
});

test("guías por categoría: tablas, foco, cierres y móvil sin desbordes", async ({
  page,
}, testInfo) => {
  const state = await catalog(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [categoryId, name, count] of [
    ["cat-tee", "Remeras", 1],
    ["cat-hoodie", "Buzos", 1],
    ["cat-pants", "Pantalones", 1],
    ["cat-sets", "Conjuntos", 2],
  ] as const) {
    state.categoryId = categoryId;
    await page.goto("/#/producto/remera-essential");
    await page.reload();
    const trigger = page.getByRole("button", {
      name: "Guía de talles",
      exact: true,
    });
    await trigger.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);
    await trigger.click();
    const dialog = page.getByRole("dialog", {
      name: "Guía de talles",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(dialog.getByRole("table")).toHaveCount(count);
    await expect(
      dialog.getByText(/No son medidas oficiales verificadas/),
    ).toBeVisible();
    for (const table of await dialog.getByRole("table").all()) {
      await expect(table.getByRole("rowheader")).toHaveText([
        "S",
        "M",
        "L",
        "XL",
      ]);
      expect(await table.evaluate((t) => t.scrollWidth <= t.clientWidth)).toBe(
        true,
      );
    }
    if (name === "Remeras")
      await expect(dialog.getByRole("columnheader")).toHaveText([
        "Talle",
        "Ancho de pecho",
        "Largo",
      ]);
    if (name === "Buzos")
      await expect(dialog.getByRole("columnheader")).toHaveText([
        "Talle",
        "Ancho de pecho",
        "Largo",
        "Manga",
      ]);
    if (name === "Pantalones")
      await expect(dialog.getByRole("columnheader")).toHaveText([
        "Talle",
        "Cintura (contorno)",
        "Cadera (contorno)",
        "Largo",
      ]);
    if (name === "Conjuntos") {
      await expect(
        dialog.getByRole("table", { name: /Parte superior/ }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("table", { name: /Parte inferior/ }),
      ).toBeAttached();
    }
    await expect(
      dialog.getByRole("button", { name: "Cerrar guía de talles" }),
    ).toBeFocused();
    expect(await dialog.evaluate((d) => d.scrollWidth <= d.clientWidth)).toBe(
      true,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    expect(
      await dialog.evaluate((d) => getComputedStyle(d).animationName),
    ).toBe("none");
    for (const key of ["Tab", "Shift+Tab"]) {
      await page.keyboard.press(key);
      expect(
        await dialog.evaluate((d) => d.contains(document.activeElement)),
      ).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`guide-${name}.png`) });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    await trigger.click();
    await page.mouse.click(1, 1);
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog.getByRole("button", { name: "Cerrar guía de talles" }).click();
    await expect(dialog).not.toBeVisible();
  }
  expect(state.errors).toEqual([]);
  expect(state.consoleErrors).toEqual([]);
  expect(state.writes).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test("miniaturas privadas, caché al navegar y notificación temporal", async ({
  page,
}, testInfo) => {
  const state = await catalog(page);
  await page.goto("/#/catalogo");
  await page
    .getByRole("link", { name: "Ver Remera Essential", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: product.name, level: 1 }),
  ).toBeVisible();
  await add(page);
  const notice = page.getByRole("region", { name: "Producto agregado" });
  await expect(notice.getByRole("img")).toHaveAttribute(
    "src",
    /vanta-thumb-v1\.webp/,
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Keep pointer and keyboard focus away: the four-second passive timeout must run.
  await page.mouse.move(0, 0);
  await expect(notice).not.toBeVisible({ timeout: 6500 });
  const floating = page.locator(".mobile-cart-bar");
  if (page.viewportSize()!.width <= 760) {
    await expect(floating).toBeVisible();
    await page
      .getByRole("button", { name: "Guía de talles", exact: true })
      .click();
    await expect(floating).not.toBeVisible();
    await page.getByRole("button", { name: "Cerrar guía de talles" }).click();
    await expect(floating).toBeVisible();
    const addButton = page.getByRole("button", { name: "Agregar al carrito", exact: true });
    await addButton.evaluate((element) => element.scrollIntoView({ block: "end", behavior: "instant" }));
    const actionBounds = await addButton.boundingBox();
    const barBounds = await floating.boundingBox();
    expect(actionBounds!.y + actionBounds!.height).toBeLessThanOrEqual(barBounds!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("mobile-cart-bar.png") });
  } else await expect(floating).not.toBeVisible();
  const panelElement = await panel(page);
  await expect(panelElement.getByRole("img")).toHaveAttribute(
    "src",
    /vanta-thumb-v1\.webp/,
  );
  await panelElement.getByRole("button", { name: "Cerrar carrito" }).click();
  await page.getByRole("link", { name: "VANTA, inicio" }).click();
  await page
    .getByRole("link", { name: "Ver Remera Essential", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: product.name, level: 1 }),
  ).toBeVisible();
  expect(state.signatures).toBe(1);
  expect(state.photos.some((path) => path.includes("vanta-card-v1.webp"))).toBe(
    true,
  );
  expect(
    state.photos.some((path) => path.includes("vanta-detail-v1.webp")),
  ).toBe(true);
  expect(
    state.photos.some((path) => path.includes("vanta-thumb-v1.webp")),
  ).toBe(true);
  expect(state.errors).toEqual([]);
  expect(state.consoleErrors).toEqual([]);
  expect(state.writes).toEqual([]);
});
