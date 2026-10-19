import { describe, expect, it } from "vitest";
import { parseRoute } from "../../app/router";
import { product } from "../../test/fixtures";
import { formatARS, orderedSizes, selectedVariant } from "./model";
describe("Rutas, precios y variantes", () => {
  it("ordena S/M/L/XL aunque Supabase devuelva L/M/S/XL y elimina duplicados", () => {
    const sizes = ["L", "M", "S", "XL", "M"];
    expect(orderedSizes(sizes)).toEqual(["S", "M", "L", "XL"]);
    expect(sizes).toEqual(["L", "M", "S", "XL", "M"]);
    expect(orderedSizes(["Único", "M", "XS", "S"])).toEqual(["S", "M", "Único", "XS"]);
  });
  it("formatea centavos en ARS sin perder decimales", () => {
    expect(formatARS(2500050)).toContain("25.000,50");
    expect(formatARS(0)).toContain("0,00");
  });
  it("rechaza combinaciones inexistentes o inactivas", () => {
    expect(selectedVariant(product.variants, "Negro", "M")?.sku).toBe(
      "ESS-BLK-M",
    );
    expect(selectedVariant(product.variants, "Negro", "L")).toBeUndefined();
    expect(
      selectedVariant(
        product.variants.map((v) => ({ ...v, active: false })),
        "Negro",
        "M",
      ),
    ).toBeUndefined();
  });
  it("reconoce enlaces individuales y rechaza rutas inválidas", () => {
    expect(parseRoute("#/producto/remera-essential")).toEqual({
      kind: "product",
      slug: "remera-essential",
    });
    expect(parseRoute("#/categoria/remeras")).toEqual({
      kind: "category",
      slug: "remeras",
    });
    for (const path of [
      "#/producto/%ZZ",
      "#/producto/a%2Fb",
      "#/otro",
      "#/producto/",
    ])
      expect(parseRoute(path)).toEqual({ kind: "missing" });
  });
});
