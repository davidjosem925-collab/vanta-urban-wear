import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { productTitle, productDescription, imageCaption } from "./presentation";
const sources = ["catalog.demo.json", "catalog.demo.extension.json"].flatMap(
  (file) =>
    JSON.parse(readFileSync(`supabase/seeds/${file}`, "utf8")).products as {
      name: string;
      description: string;
      image: { alt: string };
      slug: string;
      price_cents: number;
    }[],
);
describe("Storefront presentation without modifying original catalog data", () => {
  it.each(sources)(
    "retains commercial description of $name and removes only known boilerplate",
    (product) => {
      const original = JSON.stringify(product);
      Object.freeze(product);
      expect(productTitle(product.name)).not.toMatch(/DEMO$/);
      expect(productDescription(product.description)).not.toMatch(
        /fictici|generada con IA|oferta comercial|Fotografía principal/,
      );
      expect(productDescription(product.description).length).toBeGreaterThan(
        30,
      );
      expect(imageCaption(product.image.alt)).not.toMatch(
        /generada con IA|demostración/,
      );
      expect(JSON.stringify(product)).toBe(original);
    },
  );
  it("preserves unknown copy and names, colours and technical-looking legitimate text", () => {
    expect(productTitle("Remera Democracy")).toBe("Remera Democracy");
    expect(productTitle("Diseño DEMO especial")).toBe("Diseño DEMO especial");
    expect(productTitle("Remera — Negro")).toBe("Remera — Negro");
    expect(
      productDescription("Corte de prueba de color, con acabado mate."),
    ).toBe("Corte de prueba de color, con acabado mate.");
    expect(imageCaption("Buzo, vista frontal en grafito")).toBe(
      "Buzo, vista frontal en grafito",
    );
  });
  it("is idempotent and keeps the image colour without generation disclaimers", () => {
    const clean = imageCaption(
      "Remera Oversize Hueso; fotografía ilustrativa original generada con IA en blanco hueso",
    );
    expect(clean).toBe("Remera Oversize Hueso, blanco hueso");
    expect(imageCaption(clean)).toBe(clean);
    expect(productTitle(productTitle("Remera Essential — DEMO"))).toBe(
      "Remera Essential",
    );
  });
});
