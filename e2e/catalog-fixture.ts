import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { categories, product } from "../src/test/fixtures";

// Exercises the real Supabase client/service while preventing all remote traffic.
export async function catalog(page: Page) {
  const state = {
    price: product.price_cents,
    photos: [] as string[],
    signatures: 0,
    categoryId: product.category_id,
    offline: false,
    published: true,
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
        return route.fulfill({ json: state.published ? product.variants : [] });
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
