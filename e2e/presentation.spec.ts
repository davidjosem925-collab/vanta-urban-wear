import { expect, test } from "@playwright/test";
import { catalog } from "./catalog-fixture";
test("storefront copy is consistent from catalog to checkout without changing stored identities", async ({
  page,
}, info) => {
  const state = await catalog(page);
  state.name = "Remera Essential — DEMO";
  state.slug = "vanta-demo-remera-essential";
  state.description =
    "Remera de algodón de corte amplio, cuello redondo y terminaciones limpias. Producto y precio ficticios para revisión de VANTA. Fotografía original generada con IA; ilustrativa del modelo y no de todas las variantes de color. No constituye una oferta comercial.";
  state.imageAlt =
    "Remera Essential; imagen ilustrativa original generada con IA para demostración";
  await page.goto("/#/catalogo");
  const banner = page.getByText(
    "PROYECTO FICTICIO / PORTFOLIO — NO SE REALIZAN COMPRAS REALES",
    { exact: true },
  );
  await expect(banner).toBeVisible();
  await expect(page.getByText("COMPRAS PRÓXIMAMENTE")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Remera Essential", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Variantes publicadas · Stock por confirmar", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "Ver Remera Essential", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/producto\/vanta-demo-remera-essential$/);
  await expect(
    page.getByRole("heading", { name: "Remera Essential", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Remera de algodón de corte amplio, cuello redondo y terminaciones limpias.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(await page.locator("main").innerText()).not.toMatch(
    /— DEMO|Producto y precio ficticios|generada con IA|Stock por confirmar|descuento publicado/,
  );
  await page.getByRole("button", { name: "Negro", exact: true }).click();
  await page.getByRole("button", { name: "M", exact: true }).click();
  await page
    .getByRole("button", { name: "Agregar al carrito", exact: true })
    .click();
  const toast = page.getByRole("region", { name: "Producto agregado" });
  await expect(toast).toContainText("Remera Essential");
  await expect(toast).not.toContainText("DEMO");
  await toast.getByRole("button", { name: "Ver carrito" }).click();
  const cart = page.getByRole("dialog", { name: "Tu carrito" });
  await expect(
    cart.getByRole("link", { name: "Remera Essential", exact: true }),
  ).toBeVisible();
  await expect(cart).not.toContainText("DEMO");
  await expect(cart).not.toContainText("Stock por confirmar");
  await cart
    .getByRole("button", { name: "Continuar al checkout", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Finalizar compra", exact: true }),
  ).toBeVisible();
  if (info.project.name.includes("mobile"))
    await page.getByText("Ver productos", { exact: true }).click();
  const summary = page.getByRole("complementary", {
    name: "Resumen de la selección",
  });
  await expect(
    summary.getByRole("link", { name: "Remera Essential", exact: true }),
  ).toHaveAttribute("href", "#/producto/vanta-demo-remera-essential");
  await page.getByRole("radio", { name: /Retiro en local/ }).click();
  await expect(summary).toContainText("Retiro en local · Sin costo");
  await expect(
    page.getByText("Calle Imaginaria 000, Buenos Aires"),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(state.errors).toEqual([]);
  expect(state.writes).toEqual([]);
  expect(state.unexpected).toEqual([]);
  await page.screenshot({
    path: info.outputPath("storefront-copy.png"),
    fullPage: true,
  });
});
