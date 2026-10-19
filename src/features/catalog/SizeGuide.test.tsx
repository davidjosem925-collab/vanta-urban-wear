import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { fixtureService, product } from "../../test/fixtures";
import { SizeGuide } from "./SizeGuide";
import { sizeGuides } from "./sizeGuides";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});
describe("Guías orientativas por categoría", () => {
  it.each([
    ["remeras", "Remeras", 1, ["Talle", "Ancho de pecho", "Largo"]],
    ["buzos", "Buzos", 1, ["Talle", "Ancho de pecho", "Largo", "Manga"]],
    [
      "pantalones",
      "Pantalones",
      1,
      ["Talle", "Cintura (contorno)", "Cadera (contorno)", "Largo"],
    ],
    [
      "conjuntos",
      "Conjuntos",
      2,
      ["Talle", "Ancho de pecho", "Largo", "Manga"],
    ],
  ] as const)(
    "muestra las tablas correctas para %s y maneja foco/cierre",
    async (slug, name, count, columns) => {
      const categories = vi
        .fn()
        .mockResolvedValue([
          { id: "category-current", slug, name, active: true },
        ]);
      render(
        <SizeGuide
          categoryId="category-current"
          service={fixtureService({ categories })}
        />,
      );
      const trigger = screen.getByRole("button", { name: "Guía de talles" });
      expect(categories).not.toHaveBeenCalled();
      trigger.focus();
      fireEvent.click(trigger);
      const panel = screen.getByRole("dialog", { name: "Guía de talles" });
      expect(
        within(panel).getByRole("button", { name: "Cerrar guía de talles" }),
      ).toHaveFocus();
      await within(panel).findByRole("heading", { name });
      expect(
        within(panel).getByText(/No son medidas oficiales verificadas/),
      ).toBeVisible();
      const tables = within(panel).getAllByRole("table");
      expect(tables).toHaveLength(count);
      expect(
        within(tables[0])
          .getAllByRole("columnheader")
          .map((node) => node.textContent),
      ).toEqual(columns);
      for (const table of tables)
        expect(
          within(table)
            .getAllByRole("rowheader")
            .map((node) => node.textContent),
        ).toEqual(["S", "M", "L", "XL"]);
      if (slug === "conjuntos")
        expect(
          within(tables[1])
            .getAllByRole("columnheader")
            .map((node) => node.textContent),
        ).toEqual([
          "Talle",
          "Cintura (contorno)",
          "Cadera (contorno)",
          "Largo",
        ]);
      expect(
        within(panel).getByRole("heading", { name: "Cómo medir" }),
      ).toBeVisible();
      expect(
        within(panel).getByText(/no tomes estas medidas sobre el cuerpo/),
      ).toBeVisible();
      fireEvent.click(
        within(panel).getByRole("button", { name: "Cerrar guía de talles" }),
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      fireEvent.click(trigger);
      fireEvent(
        panel,
        new Event("cancel", { bubbles: true, cancelable: true }),
      );
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(trigger);
      fireEvent.click(panel, { clientX: -1, clientY: 0 });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      expect(document.body.style.overflow).toBe("");
    },
  );
  it("usa referencias amplias y contornos coherentes, con aumento progresivo por talle", () => {
    for (const guide of Object.values(sizeGuides))
      for (const table of guide.tables) {
        for (let c = 1; c < table.columns.length; c++) {
          const values = table.rows.map((row) => Number(row[c]));
          expect(
            values.every(
              (value, i) =>
                Number.isFinite(value) &&
                value > 0 &&
                (!i || value > values[i - 1]),
            ),
          ).toBe(true);
        }
      }
    expect(sizeGuides.remeras.tables[0].rows[0]).toEqual(["S", 56, 70]);
    expect(sizeGuides.pantalones.tables[0].rows[0]).toEqual([
      "S",
      76,
      110,
      100,
    ]);
    expect(sizeGuides.remeras.instructions.join(" ")).toMatch(
      /ancho, no un contorno/,
    );
    expect(sizeGuides.pantalones.instructions.join(" ")).toMatch(
      /multiplicalo por dos/,
    );
  });
  it("permite reintentar un error de categoría sin mostrar una tabla incorrecta", async () => {
    const categories = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue([{ id: "cat-tee", slug: "remeras", active: true }]);
    render(
      <SizeGuide
        categoryId="cat-tee"
        service={fixtureService({ categories })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Guía de talles" }));
    const panel = screen.getByRole("dialog");
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      /Revisá tu conexión/,
    );
    expect(within(panel).queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(
      within(panel).getByRole("button", { name: "Reintentar guía" }),
    );
    expect(await within(panel).findByRole("table")).toBeVisible();
  });
  it.each(["desconocida", "constructor"])(
    "no adivina medidas si no hay guía para %s",
    async (slug) => {
      render(
        <SizeGuide
          categoryId="cat-x"
          service={fixtureService({
            categories: async () => [
              { id: "cat-x", slug, name: slug, active: true, created_at: "" },
            ],
          })}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Guía de talles" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "No hay una guía orientativa",
      );
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    },
  );
  it("ofrece la guía al lado del talle incluso sin variantes publicadas", async () => {
    window.history.replaceState(null, "", "/#/producto/remera-essential");
    render(
      <App
        service={fixtureService({
          product: async () => ({ ...product, variants: [] }),
        })}
      />,
    );
    const trigger = await screen.findByRole("button", {
      name: "Guía de talles",
    });
    expect(trigger.closest("legend")).toHaveTextContent("Talle");
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("table")).toBeVisible());
    expect(screen.getByRole("dialog")).toHaveTextContent("Remeras");
  });
});
