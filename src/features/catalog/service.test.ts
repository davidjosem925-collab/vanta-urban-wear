import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../lib/supabase/database.types";
import { categories, product } from "../../test/fixtures";
import { createCatalogService, PAGE_SIZE } from "./service";

let clientNumber = 0;
function setup(
  responder: (url: URL, init?: RequestInit) => unknown = () => [],
) {
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const value = responder(new URL(String(input)), init);
      if (value instanceof Response) return value;
      return new Response(JSON.stringify(value), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );
  const client = createClient<Database>(
    "https://example.supabase.co",
    "sb_publishable_test",
    {
      global: { fetch: fetcher },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        storageKey: `catalog-test-${clientNumber++}`,
      },
    },
  );
  return { service: createCatalogService(client), fetcher };
}
describe("Servicios públicos Supabase", () => {
  it("consulta solo categorías activas mediante GET", async () => {
    const { service, fetcher } = setup(() => categories);
    expect(await service.categories()).toEqual(categories);
    const [url, options] = fetcher.mock.calls[0];
    expect(new URL(String(url)).searchParams.get("active")).toBe("eq.true");
    expect(options?.method).toBe("GET");
  });
  it("filtra, pagina y carga imágenes privadas y variantes activas sin leer inventario", async () => {
    const { service, fetcher } = setup((url) => {
      if (url.pathname.endsWith("/products"))
        return Array.from({ length: PAGE_SIZE + 1 }, () => product);
      if (url.pathname.endsWith("/product_images")) return product.images;
      if (url.pathname.endsWith("/product_variants")) return product.variants;
      if (url.pathname.includes("/object/sign/"))
        return product.images.map((i) => ({
          path: i.storage_path,
          signedURL: `/object/sign/product-images/${i.storage_path}?token=test`,
        }));
      return [];
    });
    const page = await service.products("cat-tee", 1);
    expect(page.hasMore).toBe(true);
    expect(page.products).toHaveLength(PAGE_SIZE);
    expect(page.products[0].images[0].url).toContain(
      "/storage/v1/object/sign/product-images/",
    );
    expect(page.products[0].variants).toHaveLength(2);
    const calls = fetcher.mock.calls.map(([url, init]) => ({
      url: new URL(String(url)),
      init,
    }));
    const productsQuery = calls.find((c) =>
      c.url.pathname.endsWith("/products"),
    )!.url.searchParams;
    expect(productsQuery.get("active")).toBe("eq.true");
    expect(productsQuery.get("category_id")).toBe("eq.cat-tee");
    expect(productsQuery.get("offset")).toBe(String(PAGE_SIZE));
    expect(productsQuery.get("limit")).toBe(String(PAGE_SIZE + 1));
    expect(
      calls
        .find((c) => c.url.pathname.endsWith("/product_variants"))!
        .url.searchParams.get("active"),
    ).toBe("eq.true");
    expect(
      calls.some((c) => /inventory|orders|payments/.test(c.url.pathname)),
    ).toBe(false);
    expect(
      calls
        .filter((c) => c.url.pathname.includes("/rest/"))
        .every((c) => c.init?.method === "GET"),
    ).toBe(true);
    const signing = calls.find((c) =>
      c.url.pathname.includes("/object/sign/"),
    )!;
    expect(signing.init?.method).toBe("POST"); // URL signing only, no data writes.
  });
  it("resuelve un producto por slug y devuelve null si está oculto", async () => {
    const { service, fetcher } = setup(() => []);
    expect(await service.product("oculto")).toBeNull();
    const query = new URL(String(fetcher.mock.calls[0][0])).searchParams;
    expect(query.get("slug")).toBe("eq.oculto");
    expect(query.get("active")).toBe("eq.true");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("maneja falta de configuración y errores del servidor sin filtrar detalles internos", async () => {
    await expect(createCatalogService(null).categories()).rejects.toThrow();
    const { service } = setup(
      () =>
        new Response(JSON.stringify({ message: "private database failure" }), {
          status: 403,
        }),
    );
    await expect(service.products(undefined, 0)).rejects.toThrow(
      "No pudimos cargar la colección",
    );
  });
  it("rechaza precios inseguros y página inválida", async () => {
    const { service } = setup((url) =>
      url.pathname.endsWith("/products")
        ? [{ ...product, price_cents: -1 }]
        : [],
    );
    await expect(service.products(undefined, -1)).rejects.toThrow(
      "Página inválida",
    );
    await expect(service.products(undefined, 0)).rejects.toThrow(
      "precio inválido",
    );
  });
});
