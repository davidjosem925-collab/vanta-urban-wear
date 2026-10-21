import { test, expect } from "@playwright/test";
import { fixture, id, noOverflow } from "./admin.fixture";
test("admin: login, MFA step-up, logout and denial without data access", async ({
  page,
}) => {
  const state = await fixture(page, { aal: "aal1", logged: false });
  await expect(
    page.getByRole("heading", { name: "Ingresá a VANTA" }),
  ).toBeVisible();
  await page.getByLabel("Correo administrativo").fill("admin@example.invalid");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("Local-Fixture-Only-123!");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Verificación en dos pasos" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Productos", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Continuar con MFA" }).click();
  await page.getByLabel("Código de seis dígitos").fill("123456");
  await page.getByRole("button", { name: "Verificar MFA" }).click();
  await expect(
    page.getByRole("heading", { name: "Productos", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Ver tienda", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "La colección." }),
  ).toBeVisible();
  await page.goto("/#/admin");
  await expect(
    page.getByRole("heading", { name: "Productos", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(
    page.getByRole("heading", { name: "Ingresá a VANTA" }),
  ).toBeVisible();
  await expect(page.getByText("Essential", { exact: true })).toHaveCount(0);
  await noOverflow(page);
  expect(state.errors).toEqual([]);
});
test("admin: common user cannot enter or invoke management through the UI", async ({
  page,
}) => {
  const state = await fixture(page, { member: false });
  await expect(
    page.getByRole("heading", { name: "Acceso no autorizado" }),
  ).toBeVisible();
  expect(state.writes).toEqual([]);
  await noOverflow(page);
  expect(state.errors).toEqual([]);
});
test("admin: email recovery exchanges PKCE once and updates password only after authorized MFA session", async ({
  page,
}) => {
  const state = await fixture(page);
  let exchanges = 0;
  await page.route("**/auth/v1/token?grant_type=pkce", async (route) => {
    exchanges++;
    const b = route.request().postDataJSON();
    expect(b.auth_code).toBe("fixture-code");
    expect(b.code_verifier).toBe("fixture-verifier");
    return route.fallback();
  });
  await page.evaluate(() => {
    localStorage.setItem(
      "vanta.admin.auth.v1-flow-fixtureflow-code-verifier",
      JSON.stringify("fixture-verifier/recovery"),
    );
    // A second pending email flow must never replace this callback's verifier.
    localStorage.setItem(
      "vanta.admin.auth.v1-code-verifier",
      JSON.stringify("another-verifier/recovery"),
    );
  });
  await page.goto(
    "/?code=fixture-code&admin_recovery=1&sb_flow_id=fixtureflow#/admin",
  );
  await expect(
    page.getByRole("heading", { name: "Nueva contraseña" }),
  ).toBeVisible();
  expect(exchanges).toBe(1);
  expect(page.url()).not.toContain("fixture-code");
  await page
    .getByLabel("Nueva contraseña", { exact: true })
    .fill("New-Fixture-Password-123!");
  await page.getByLabel("Repetir contraseña").fill("New-Fixture-Password-123!");
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByText("Contraseña actualizada.")).toBeVisible();
  await noOverflow(page);
  expect(state.errors).toEqual([]);
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
  "base64",
);
async function section(page: import("@playwright/test").Page, name: string) {
  await page
    .getByRole("navigation", { name: "Secciones del producto" })
    .getByRole("link", { name: new RegExp(name) })
    .click();
}
async function edit(page: import("@playwright/test").Page) {
  await page
    .getByRole("link", { name: "Editar Essential", exact: true })
    .click();
  await expect(page.getByLabel("Nombre del producto")).toHaveValue("Essential");
}
async function upload(page: import("@playwright/test").Page, alt: string) {
  await page
    .getByLabel("Elegí una fotografía")
    .setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: png });
  await page.getByLabel("Descripción de la imagen", { exact: true }).fill(alt);
  await page
    .getByRole("button", { name: "Subir fotografía", exact: true })
    .click();
  await expect(
    page.getByText(
      "Fotografías guardadas correctamente. Los archivos originales se conservan.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Subir fotografía", exact: true }),
  ).toBeEnabled();
}
test("admin UX: creates a draft, generates its address and publishes only after guided completion", async ({
  page,
}, info) => {
  const state = await fixture(page, { empty: true });
  await page.getByRole("link", { name: "Agregar producto" }).click();
  await page.getByLabel("Nombre del producto").fill("Remera Órbita Hueso");
  await page
    .getByRole("combobox", { name: "Categoría", exact: true })
    .selectOption(id);
  await page
    .getByRole("textbox", { name: "Descripción", exact: true })
    .fill("Algodón de corte amplio.");
  await page.getByLabel("Precio en ARS").fill("32000,50");
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(
    page.getByText("Producto guardado correctamente."),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/productos/${id}/general`));
  expect(state.getProduct().slug).toBe("remera-orbita-hueso");
  expect(state.getProduct().active).toBe(false);
  await section(page, "Revisar y publicar");
  await expect(
    page.getByRole("button", { name: "Publicar producto", exact: true }),
  ).toBeDisabled();
  await section(page, "Fotografías");
  await upload(page, "Remera órbita de frente");
  await section(page, "Talles y colores");
  await page.getByLabel("Color de la prenda").fill("Hueso");
  await page.getByRole("checkbox", { name: "S", exact: true }).check();
  await page.getByRole("button", { name: "Revisar combinaciones" }).click();
  await page
    .getByRole("button", { name: "Crear 1 combinación", exact: true })
    .click();
  await expect(
    page.getByText(/1 combinación guardada correctamente/),
  ).toBeVisible();
  expect(state.getVariants()).toHaveLength(1);
  await section(page, "Control de stock");
  await page
    .getByRole("button", { name: "Actualizar stock Hueso talle S" })
    .click();
  await page.getByLabel("Cantidad de unidades").fill("6");
  await page.getByLabel("Motivo del cambio").fill("Stock inicial demo");
  await page.getByRole("button", { name: "Revisar cambio de stock" }).click();
  await page
    .getByRole("button", { name: "Confirmar cambio", exact: true })
    .click();
  await expect(
    page.getByText("Stock actualizado correctamente.", { exact: true }),
  ).toBeVisible();
  await section(page, "Revisar y publicar");
  await page
    .getByRole("button", { name: "Publicar producto", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirmar cambio", exact: true })
    .click();
  await expect(
    page.getByText("Producto publicado correctamente."),
  ).toBeVisible();
  expect(state.getProduct().active).toBe(true);
  await noOverflow(page);
  expect(state.errors).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("admin-review.png"),
    fullPage: true,
  });
});
test("admin UX: edits ordinary fields, preserves the existing address and separates a confirmed save from refresh failure", async ({
  page,
}, info) => {
  const state = await fixture(page);
  await edit(page);
  await page.getByLabel("Nombre del producto").fill("Essential Hueso");
  await page
    .getByRole("textbox", { name: "Descripción", exact: true })
    .fill("Nueva descripción");
  await page.getByLabel("Precio en ARS").fill("28000,50");
  await page
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  await expect(
    page.getByText("Producto guardado correctamente."),
  ).toBeVisible();
  expect(state.getProduct().slug).toBe("essential");
  expect(state.getProduct().price_cents).toBe(2800050);
  expect(state.getProduct().description).toBe("Nueva descripción");
  await expect(page.getByLabel("Dirección del producto")).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("admin-general.png"),
    fullPage: true,
  });
  await section(page, "Fotografías");
  state.failures.afterImageSave = "product_images";
  await upload(page, "Foto principal");
  await expect(
    page.getByText(/No se pudieron actualizar los datos/),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(state.writes.filter((w) => w === "admin_save_images")).toHaveLength(1);
  await page
    .getByRole("button", { name: "Reintentar consulta", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "Foto principal", exact: true }),
  ).toBeVisible();
  expect(state.writes.filter((w) => w === "admin_save_images")).toHaveLength(1);
  expect(state.errors).toEqual([]);
});
test("admin UX: confirmed creation remains a success if the following product query fails", async ({
  page,
}) => {
  const state = await fixture(page, { empty: true });
  state.failures.afterProductSave = "products";
  await page.getByRole("link", { name: "Agregar producto" }).click();
  await page.getByLabel("Nombre del producto").fill("Borrador Seguro");
  await page
    .getByRole("combobox", { name: "Categoría", exact: true })
    .selectOption(id);
  await page.getByLabel("Precio en ARS").fill("27000");
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(
    page.getByText("Producto guardado correctamente."),
  ).toBeVisible();
  await expect(
    page.getByText(/No se pudieron actualizar los datos/),
  ).toBeVisible();
  expect(state.writes.filter((w) => w === "admin_save_product")).toHaveLength(
    1,
  );
  await page
    .getByRole("button", { name: "Reintentar consulta", exact: true })
    .click();
  await expect(page.getByLabel("Nombre del producto")).toHaveValue(
    "Borrador Seguro",
  );
  expect(state.writes.filter((w) => w === "admin_save_product")).toHaveLength(
    1,
  );
});
test("admin UX: gallery upload, principal ordering, alt edits and unlink preserve originals", async ({
  page,
}, info) => {
  const state = await fixture(page);
  await edit(page);
  await section(page, "Fotografías");
  await upload(page, "Primera foto");
  await upload(page, "Segunda foto");
  await expect(
    page.getByRole("img", { name: "Segunda foto", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mover foto 2 antes" }).click();
  await expect(
    page.getByLabel("Descripción de foto 1", { exact: true }),
  ).toHaveValue("Segunda foto");
  await page
    .getByLabel("Descripción de foto 1", { exact: true })
    .fill("Nueva principal");
  await page
    .getByRole("button", { name: "Guardar descripción", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("img", { name: "Nueva principal", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Retirar foto 2", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Retirar foto 2", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Retirar foto 2", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirmar cambio", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "Primera foto", exact: true }),
  ).toHaveCount(0);
  expect(state.getImages()).toHaveLength(4);
  expect(state.uploads).toHaveLength(8);
  expect(state.writes.every((w) => !w.includes("/storage/"))).toBe(true);
  await noOverflow(page);
  expect(state.errors).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("admin-photos.png"),
    fullPage: true,
  });
});
test("admin UX: guided combinations skip duplicates and preserve historical size, color and code", async ({
  page,
}) => {
  const state = await fixture(page);
  await edit(page);
  await section(page, "Talles y colores");
  await page.getByLabel("Color de la prenda").fill(" negro ");
  await page.getByRole("checkbox", { name: "M", exact: true }).check();
  await page.getByRole("checkbox", { name: "L", exact: true }).check();
  await page.getByRole("button", { name: "Revisar combinaciones" }).click();
  await expect(page.getByText("Ya existe · se conserva")).toBeVisible();
  await page
    .getByRole("button", { name: "Crear 1 combinación", exact: true })
    .click();
  await expect(
    page.getByText(/1 combinación guardada correctamente/),
  ).toBeVisible();
  expect(state.getVariants()).toHaveLength(2);
  await page
    .getByRole("button", { name: "Editar talle M", exact: true })
    .click();
  await expect(page.getByLabel("Código interno", { exact: true })).toHaveValue(
    "ESS-M-N",
  );
  await page
    .getByRole("checkbox", { name: "Disponible para la venta", exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Guardar talle", exact: true })
    .click();
  await expect(
    page.getByText("Talle y color guardados correctamente."),
  ).toBeVisible();
  const existing = state.getVariants().find((v) => v.size === "M")!;
  expect(existing.color).toBe("Negro");
  expect(existing.sku).toBe("ESS-M-N");
  expect(existing.active).toBe(false);
  await noOverflow(page);
  expect(state.errors).toEqual([]);
});
test("admin UX: stock add/remove, reservation protection and movement history", async ({
  page,
}, info) => {
  const state = await fixture(page);
  await page.getByRole("link", { name: "Stock", exact: true }).click();
  await page
    .getByRole("link", { name: "Ver stock de Essential", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Actualizar stock Negro talle M" })
    .click();
  await page.getByLabel("Cantidad de unidades").fill("2");
  await page.getByLabel("Motivo del cambio").fill("Ingreso de prendas");
  await page.getByRole("button", { name: "Revisar cambio de stock" }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Revisar cambio de stock" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Revisar cambio de stock" }).click();
  await page
    .getByRole("button", { name: "Confirmar cambio", exact: true })
    .click();
  await expect(
    page.getByText("Stock actualizado correctamente.", { exact: true }),
  ).toBeVisible();
  expect(state.getStock()[0]).toMatchObject({ on_hand: 8, reserved: 1 });
  await page.getByLabel("Qué querés hacer").selectOption("remove");
  await page.getByLabel("Cantidad de unidades").fill("8");
  await expect(
    page.getByText("No podés quitar unidades reservadas. Reducí la cantidad."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Revisar cambio de stock" }),
  ).toBeDisabled();
  await page.getByLabel("Cantidad de unidades").fill("2");
  await page.getByLabel("Motivo del cambio").fill("Recuento de depósito");
  await page.getByRole("button", { name: "Revisar cambio de stock" }).click();
  await page
    .getByRole("button", { name: "Confirmar cambio", exact: true })
    .click();
  await page.locator("details.admin-history > summary").click();
  await expect(
    page.getByText("Recuento de depósito", { exact: true }),
  ).toBeVisible();
  await page.locator("details.admin-history > summary").click();
  expect(state.getStock()[0]).toMatchObject({ on_hand: 6, reserved: 1 });
  expect(state.getMovements()).toHaveLength(2);
  await noOverflow(page);
  expect(state.errors).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("admin-stock.png"),
    fullPage: true,
  });
});
test("admin UX: view and drafts survive focus, valid SIGNED_IN and token renewal; navigation warns before discard", async ({
  page,
  context,
}) => {
  const state = await fixture(page);
  await edit(page);
  await page.getByLabel("Nombre del producto").fill("Cambio sin guardar");
  await section(page, "Fotografías");
  await section(page, "Información general");
  await expect(page.getByLabel("Nombre del producto")).toHaveValue(
    "Cambio sin guardar",
  );
  const other = await context.newPage();
  await other.goto("about:blank");
  await other.bringToFront();
  await page.bringToFront();
  await other.close();
  await page.evaluate(async (s) => {
    const { adminClient } = await import("/src/features/admin/client.ts");
    await adminClient!.auth.setSession({
      access_token: s.access_token,
      refresh_token: s.refresh_token,
    });
    await adminClient!.auth.refreshSession();
    window.dispatchEvent(new Event("focus"));
  }, state.session());
  await expect(page.getByLabel("Nombre del producto")).toHaveValue(
    "Cambio sin guardar",
  );
  await expect(page).toHaveURL(/\/general$/);
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("link", { name: "Stock", exact: true }).click();
  await expect(page.getByLabel("Nombre del producto")).toHaveValue(
    "Cambio sin guardar",
  );
  await page.goBack();
  await expect(page).toHaveURL(/\/fotos$/);
  await page.goForward();
  await expect(page.getByLabel("Nombre del producto")).toHaveValue(
    "Cambio sin guardar",
  );
  page.once("dialog", (d) => d.dismiss());
  await page.evaluate(() => history.go(-3));
  await expect(page).toHaveURL(/\/general$/);
  await expect(page.getByLabel("Nombre del producto")).toHaveValue(
    "Cambio sin guardar",
  );
  await page.goBack();
  await expect(page).toHaveURL(/\/fotos$/);
  await page.goForward();
  await expect(page.getByLabel("Nombre del producto")).toHaveValue(
    "Cambio sin guardar",
  );
  page.once("dialog", (d) => d.accept());
  await page.getByRole("link", { name: "Stock", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/stock$/);
  await page.goto(`/#/admin/productos/${id}/fotos`);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Fotografías", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Nombre del producto")).toBeHidden();
  expect(state.errors).toEqual([]);
});
test("admin UX: lost stock response recovers the same applied intent once after reload", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`/#/admin/stock/${id}`);
  await page
    .getByRole("button", { name: "Actualizar stock Negro talle M" })
    .click();
  await page.getByLabel("Cantidad de unidades").fill("2");
  await page.getByLabel("Motivo del cambio").fill("Recuento local");
  state.failures.loseStockResponse = true;
  await page.getByRole("button", { name: "Revisar cambio de stock" }).click();
  await page
    .getByRole("button", { name: "Confirmar cambio", exact: true })
    .click();
  await expect(
    page.getByText("Un cambio de stock necesita confirmación"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Consultar o reintentar el mismo ajuste" })
    .click();
  await expect(
    page.getByText(
      /Stock actualizado correctamente. El cambio se aplicó una sola vez/,
    ),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(state.adjustKeys).toHaveLength(1);
  // Repeat with another deliberate intent, this time recovering after reload.
  await page.getByLabel("Cantidad de unidades").fill("1");
  await page.getByLabel("Motivo del cambio").fill("Segundo recuento local");
  state.failures.loseStockResponse = true;
  await page.getByRole("button", { name: "Revisar cambio de stock" }).click();
  await page
    .getByRole("button", { name: "Confirmar cambio", exact: true })
    .click();
  await expect(
    page.getByText("Un cambio de stock necesita confirmación"),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.reload();
  await page
    .getByRole("button", { name: "Consultar o reintentar el mismo ajuste" })
    .click();
  await expect(
    page.getByText(
      /Stock actualizado correctamente. El cambio se aplicó una sola vez/,
    ),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(state.adjustKeys).toHaveLength(2);
  expect(new Set(state.adjustKeys).size).toBe(2);
  expect(state.getStock()[0]).toMatchObject({ on_hand: 9, reserved: 1 });
  expect(state.getMovements()).toHaveLength(2);
});
test("admin UX: demo orders use friendly statuses, URL restoration and no private contact fields", async ({
  page,
}, info) => {
  const state = await fixture(page);
  await page
    .getByRole("link", { name: "Pedidos de demostración", exact: true })
    .click();
  await expect(page.getByText(/Pendiente ·/)).toBeVisible();
  await page.getByRole("button", { name: "Ver detalle", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/pedidos/${id}`));
  await expect(
    page.getByText("Snapshot Essential", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Vigente", { exact: false })).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Snapshot Essential", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Confirmar pedido|Pagar|Cancelar pedido/,
    }),
  ).toHaveCount(0);
  expect(state.writes).toEqual([]);
  await noOverflow(page);
  expect(state.errors).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("admin-order.png"),
    fullPage: true,
  });
});
test("admin UX: compact product list includes private thumbnail, category, price and restorable filters", async ({
  page,
}, info) => {
  const state = await fixture(page, { withPhoto: true });
  await expect(
    page.getByRole("img", { name: "Remera Essential, vista frontal" }),
  ).toBeVisible();
  await expect(page.getByText("Remeras", { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("admin-products.png"),
    fullPage: true,
  });
  await page.getByLabel("Buscar producto").fill("Nada");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByText("No encontramos prendas")).toBeVisible();
  await expect(page).toHaveURL(/buscar=Nada/);
  await page.getByLabel("Buscar producto").fill("Essential");
  await page
    .getByRole("combobox", { name: "Publicación", exact: true })
    .selectOption("published");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await edit(page);
  await page
    .getByRole("link", { name: "Volver a productos", exact: false })
    .click();
  await expect(page).toHaveURL(/buscar=Essential/);
  await page.reload();
  await expect(page.getByLabel("Buscar producto")).toHaveValue("Essential");
  await noOverflow(page);
  expect(state.errors).toEqual([]);
});
test("admin UX: a duplicate address offers a deliberate alternative and preserves the existing product", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.getByRole("link", { name: "Agregar producto" }).click();
  await page.getByLabel("Nombre del producto").fill("Essential");
  await page
    .getByRole("combobox", { name: "Categoría", exact: true })
    .selectOption(id);
  await page.getByLabel("Precio en ARS").fill("29000");
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page.getByText(/Esa dirección ya está usada/)).toBeVisible();
  expect(state.getProduct().price_cents).toBe(2700050);
  await page
    .getByLabel("Dirección del producto", { exact: true })
    .fill("essential-hueso");
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(
    page.getByText("Producto guardado correctamente."),
  ).toBeVisible();
  expect(state.getProduct().slug).toBe("essential-hueso");
});
test("admin UX: an uncertain draft creation is queried before any new write", async ({
  page,
}) => {
  const state = await fixture(page, { empty: true });
  state.failures.loseProductResponse = true;
  await page.getByRole("link", { name: "Agregar producto" }).click();
  await page.getByLabel("Nombre del producto").fill("Prenda segura");
  await page
    .getByRole("combobox", { name: "Categoría", exact: true })
    .selectOption(id);
  await page.getByLabel("Precio en ARS").fill("25000");
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(
    page.getByRole("button", { name: "Guardar borrador" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Buscar el borrador guardado" })
    .click();
  await expect(
    page.getByText(
      "Encontramos el producto. Revisá sus datos antes de continuar.",
    ),
  ).toBeVisible();
  expect(state.writes.filter((w) => w === "admin_save_product")).toHaveLength(
    1,
  );
  await expect(page).toHaveURL(new RegExp(`/productos/${id}/general`));
});
test("admin UX: concurrent product changes are reviewed instead of silently overwritten", async ({
  page,
}) => {
  const state = await fixture(page);
  await edit(page);
  await page.getByLabel("Nombre del producto").fill("Mi edición");
  state.getProduct().name = "Edición de otra persona";
  state.getProduct().updated_at = "2026-10-20T02:00:00Z";
  await page
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  await expect(
    page.getByText(/La información cambió desde que comenzaste/),
  ).toBeVisible();
  await expect(page.getByLabel("Nombre del producto")).toHaveValue(
    "Mi edición",
  );
  expect(state.getProduct().name).toBe("Edición de otra persona");
  await page
    .getByRole("button", { name: "Consultar cambios guardados" })
    .click();
  await expect(
    page.getByText("Nombre guardado", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Usar versión guardada" }).click();
  await expect(page.getByLabel("Nombre del producto")).toHaveValue(
    "Edición de otra persona",
  );
  expect(state.writes.filter((w) => w === "admin_save_product")).toHaveLength(
    1,
  );
});
