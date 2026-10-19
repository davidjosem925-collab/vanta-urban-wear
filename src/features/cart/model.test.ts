import { describe, expect, it, vi } from "vitest";
import { fixtureService, product } from "../../test/fixtures";
import {
  addLine,
  cartTotals,
  changeQuantity,
  loadCartProduct,
  MAX_LINES,
  MAX_QUANTITY,
  readCart,
  removeLine,
  resolveCart,
  selection,
  validQuantity,
  writeCart,
  type CartEntry,
} from "./model";

const line = selection(product, "Negro", "M", 2);
const other = selection(product, "Grafito", "L", 1);
const signal = () => new AbortController().signal;
describe("Modelo seguro del carrito", () => {
  it("interrumpe una consulta pendiente al cancelar y no aplica una respuesta tardía", async () => {
    const controller = new AbortController();
    const service = fixtureService({ product: () => new Promise(() => {}) });
    const pending = loadCartProduct(service, product.slug, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow(/a tiempo/);
  });
  it("agrega, agrupa variantes iguales y separa talle/color diferentes", () => {
    const lines = addLine(addLine(addLine([], line), line), other);
    expect(lines).toEqual([{ ...line, quantity: 4 }, other]);
  });
  it.each([
    ["", ""],
    ["Negro", ""],
    ["", "M"],
    ["Negro", "L"],
  ])("exige una combinación publicada: %s/%s", (color, size) => {
    expect(() => selection(product, color, size, 1)).toThrow();
  });
  it("rechaza variantes inactivas o pertenecientes a otra prenda", () => {
    for (const patch of [{ active: false }, { product_id: "another" }]) {
      expect(() =>
        selection(
          { ...product, variants: [{ ...product.variants[0], ...patch }] },
          "Negro",
          "M",
          1,
        ),
      ).toThrow();
    }
  });
  it.each([0, -1, 1.5, MAX_QUANTITY + 1, NaN, Infinity, "2", null])(
    "rechaza cantidades inválidas: %s",
    (quantity) => {
      expect(validQuantity(quantity as number)).toBe(false);
      expect(() =>
        changeQuantity([line], line.variantId, quantity as number),
      ).toThrow();
    },
  );
  it("modifica cantidades y elimina sin mutar los originales", () => {
    const original = [line, other];
    const updated = changeQuantity(original, line.variantId, 5);
    expect(updated[0].quantity).toBe(5);
    expect(original[0].quantity).toBe(2);
    expect(removeLine(updated, line.variantId)).toEqual([other]);
    expect(removeLine([line], line.variantId)).toEqual([]);
  });
  it("limita acumulación y cantidad de variantes sin confundirlas con stock", () => {
    expect(() => addLine([{ ...line, quantity: MAX_QUANTITY }], line)).toThrow(
      /límite/,
    );
    const full = Array.from({ length: MAX_LINES }, (_, i) => ({
      ...line,
      variantId: `v-${i}`,
    }));
    expect(() => addLine(full, other)).toThrow(/30/);
    expect(() => addLine([{ ...line, productId: "other" }], line)).toThrow(
      /corresponde/,
    );
  });
  it.each([-1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER])(
    "rechaza precios inválidos: %s",
    (price_cents) => {
      expect(() =>
        selection({ ...product, price_cents }, "Negro", "M", 1),
      ).toThrow(/precio/);
    },
  );
  it("calcula en centavos, incluso con fracciones de pesos", async () => {
    const entries = await resolveCart(
      [line, other],
      fixtureService(),
      signal(),
    );
    expect(cartTotals(entries)).toEqual({ units: 3, total: 7_500_150 });
    const cents: CartEntry[] = [
      { ...entries[0], product: { ...product, price_cents: 101 } },
    ];
    expect(cartTotals(cents).total).toBe(202);
    expect(cartTotals([])).toEqual({ units: 0, total: 0 });
  });
  it("no presenta un total parcial como completo si una prenda no se verificó", async () => {
    const entries = await resolveCart(
      [line, other],
      fixtureService(),
      signal(),
    );
    for (const status of ["loading", "error", "unavailable"] as const) {
      expect(cartTotals([entries[0], { ...entries[1], status }])).toEqual({
        units: 3,
        total: null,
      });
    }
  });
  it("persiste solo identificadores y cantidades; ignora precio, stock e imágenes manipulados", () => {
    const raw = JSON.stringify({
      version: 1,
      lines: [
        {
          ...line,
          price_cents: 1,
          stock: 9999,
          images: [{ url: "https://evil.test/private" }],
          name: "fake",
        },
      ],
    });
    expect(readCart(raw).lines).toEqual([line]);
    expect(JSON.parse(writeCart(readCart(raw).lines))).toEqual({
      version: 1,
      lines: [line],
    });
    expect(readCart(writeCart([line, other])).lines).toEqual([line, other]);
  });
  it.each([
    "broken",
    "null",
    "[]",
    '{"version":2,"lines":[]}',
    '{"version":1,"lines":{}}',
    "x".repeat(30_001),
  ])("recupera almacenamiento corrupto o versiones desconocidas", (raw) => {
    expect(readCart(raw)).toEqual({ lines: [], warning: expect.any(String) });
    expect(readCart(raw).warning).not.toBe("");
  });
  it("descarta campos incompletos, slugs inválidos, cantidades no enteras y tipos manipulados", () => {
    const invalid = [
      {},
      { ...line, slug: "../p" },
      { ...line, productId: {} },
      { ...line, quantity: "2" },
      { ...line, quantity: 20 },
      null,
    ];
    const result = readCart(
      JSON.stringify({ version: 1, lines: [...invalid, line] }),
    );
    expect(result.lines).toEqual([line]);
    expect(result.warning).not.toBe("");
    expect(readCart(null)).toEqual({ lines: [], warning: "" });
  });
  it("sanea duplicados, conflictos y exceso de líneas al restaurar", () => {
    const result = readCart(
      JSON.stringify({
        version: 1,
        lines: [
          { ...line, quantity: 8 },
          line,
          line,
          { ...line, productId: "conflict" },
          other,
        ],
      }),
    );
    expect(result.lines).toEqual([{ ...line, quantity: MAX_QUANTITY }, other]);
    expect(
      readCart(
        JSON.stringify({
          version: 1,
          lines: Array.from({ length: 40 }, (_, i) => ({
            ...line,
            variantId: `v-${i}`,
          })),
        }),
      ).lines,
    ).toHaveLength(MAX_LINES);
  });
  it("consulta una vez por producto y usa el precio actual, no el guardado", async () => {
    const lookup = vi
      .fn()
      .mockResolvedValue({ ...product, price_cents: 3_000_099 });
    const entries = await resolveCart(
      [line, other],
      fixtureService({ product: lookup }),
      signal(),
    );
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(cartTotals(entries).total).toBe(9_000_297);
  });
  it("mantiene por verificar las prendas con error de red sin inventar importes", async () => {
    const entries = await resolveCart(
      [line],
      fixtureService({
        product: vi.fn().mockRejectedValue(new Error("network")),
      }),
      signal(),
    );
    expect(entries[0]).toEqual({ line, status: "error" });
    expect(cartTotals(entries).total).toBeNull();
  });
  it.each([
    null,
    { ...product, id: "wrong" },
    { ...product, slug: "wrong" },
    { ...product, active: false },
    { ...product, price_cents: -1 },
    { ...product, variants: [] },
  ])("no valida productos o variantes desactualizados", async (value) => {
    const entries = await resolveCart(
      [line],
      fixtureService({ product: async () => value }),
      signal(),
    );
    expect(entries[0].status).toBe("unavailable");
    expect(cartTotals(entries).total).toBeNull();
  });
});
