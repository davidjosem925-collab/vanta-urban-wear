import { describe, expect, it } from "vitest";
import {
  productSlug,
  combinationPlan,
  stockResult,
  readiness,
  friendly,
} from "./ux";
import { adminView } from "./navigation";
import type { AdminImage, AdminVariant } from "./model";
const v: AdminVariant = {
  id: "one",
  product_id: "p",
  sku: "KEEP-001",
  size: "M",
  color: "Negro",
  active: true,
};
describe("owner-facing catalog helpers preserve database contracts", () => {
  it("generates safe product addresses from names, accents and punctuation", () => {
    expect(productSlug("  Buzó Oversize / Hueso & Negro! ")).toBe(
      "buzo-oversize-hueso-negro",
    );
    expect(productSlug("!!!")).toBe("");
    expect(productSlug("a".repeat(200))).toHaveLength(140);
  });
  it("plans only new size/color combinations, treating case and whitespace consistently", () => {
    const original = { ...v };
    expect(combinationPlan([v], " negro ", ["M", " m ", "S", " s "])).toEqual([
      { size: "m", exists: true },
      { size: "s", exists: false },
    ]);
    expect(v).toEqual(original);
  });
  it("calculates stock preview while protecting reserved units and reasonable limits", () => {
    const i = { variant_id: "one", on_hand: 10, reserved: 2 };
    expect(stockResult(i, "add", 3)).toEqual({
      delta: 3,
      physical: 13,
      available: 11,
    });
    expect(stockResult(i, "remove", 8)).toEqual({
      delta: -8,
      physical: 2,
      available: 0,
    });
    for (const n of [0, -1, 9, 1.5, 1001, NaN])
      expect(stockResult(i, "remove", n)).toBeNull();
    expect(stockResult(i, "unknown", 1)).toBeNull();
    expect(stockResult({ ...i, on_hand: 1000000000 }, "add", 1)).toBeNull();
  });
  it("does not count inactive combinations, reserved stock or derivative-only photos as ready", () => {
    const images = [
      { storage_path: "x.png.vanta-thumb-v1.webp" },
    ] as AdminImage[];
    expect(
      readiness(
        images,
        [{ ...v, active: false }],
        [{ variant_id: v.id, on_hand: 6, reserved: 6 }],
      ).map((s) => s.done),
    ).toEqual([false, false, false]);
    expect(
      readiness(
        [{ storage_path: "x.png" }] as AdminImage[],
        [v],
        [{ variant_id: v.id, on_hand: 6, reserved: 2 }],
      ).every((s) => s.done),
    ).toBe(true);
  });
  it("translates display values without changing persisted status keys", () => {
    expect(friendly("pending")).toBe("Pendiente");
    expect(friendly("expired")).toBe("Vencido");
    expect(friendly("active")).toBe("Vigente");
    expect(friendly("mercado_pago")).toBe("Mercado Pago simulado");
    expect(friendly("unexpected")).toBe("No informado");
  });
});
describe("administrative route restoration", () => {
  const id = "10000000-0000-0000-0000-000000000001";
  it("restores a product section and never accepts arbitrary ids", () => {
    expect(adminView(`#/admin/productos/${id}/fotos`).section).toBe("fotos");
    expect(adminView(`#/admin/productos/${id}/fotos`).id).toBe(id);
    expect(adminView("#/admin/productos/<script>/fotos").id).toBeUndefined();
  });
  it("restores stock and order details, drafts and bounded known sections", () => {
    expect(adminView(`#/admin/stock/${id}`).section).toBe("stock");
    expect(adminView(`#/admin/pedidos/${id}`).id).toBe(id);
    expect(adminView("#/admin/productos/nuevo/general").id).toBe("nuevo");
    expect(adminView(`#/admin/productos/${id}/anything`).section).toBe(
      "general",
    );
  });
  it("preserves list filter parameters and the original admin entry", () => {
    expect(adminView("#/admin").area).toBe("productos");
    expect(
      adminView(
        "#/admin/productos?buscar=Hueso&estado=draft&pagina=2",
      ).query.get("buscar"),
    ).toBe("Hueso");
  });
});
