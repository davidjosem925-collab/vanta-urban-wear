import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureService, product } from "../test/fixtures";
import { App } from "./App";

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});
function at(hash: string) {
  window.history.replaceState(null, "", `/${hash}`);
}
describe("Tienda VANTA", () => {
  it("ofrece Inicio antes de Colección y conserva el enlace del logo", () => {
    render(<App service={fixtureService()} />);
    const navigation = screen.getByRole("navigation", { name: "Navegación principal" });
    const links = within(navigation).getAllByRole("link");
    expect(links.slice(0, 2).map((link) => link.textContent)).toEqual(["Inicio", "Colección"]);
    expect(links[0]).toHaveAttribute("href", "#/");
    expect(links[0]).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "VANTA, inicio" })).toHaveAttribute("href", "#/");
    expect(screen.queryByRole("navigation", { name: "Ruta de navegación" })).not.toBeInTheDocument();
  });
  it.each([
    ["#/catalogo", ["Inicio", "Colección"]],
    ["#/categoria/remeras", ["Inicio", "Colección", "Remeras"]],
    ["#/producto/remera-essential", ["Inicio", "Colección", product.name]],
  ])("permite volver desde los breadcrumbs de %s", async (hash, labels) => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    at(hash);
    render(<App service={fixtureService()} />);
    const breadcrumb = await screen.findByRole("navigation", { name: "Ruta de navegación" });
    expect(breadcrumb.textContent).toBe(labels.join("/"));
    expect(breadcrumb.querySelector('[aria-current="page"]')).toHaveTextContent(labels.at(-1)!);
    if (labels.length > 2) {
      expect(within(breadcrumb).getByRole("link", { name: "Colección" })).toHaveAttribute("href", "#/catalogo");
    }
    fireEvent.click(within(breadcrumb).getByRole("link", { name: "Inicio" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Presencia"));
    expect(window.location.hash).toBe("#/");
  });
  it("regresa a la portada y cierra el menú móvil al elegir Inicio", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    at("#/catalogo");
    render(<App service={fixtureService()} />);
    const toggle = screen.getByRole("button", { name: "Abrir menú" });
    fireEvent.click(toggle);
    const navigation = screen.getByRole("navigation", { name: "Navegación principal" });
    fireEvent.click(within(navigation).getByRole("link", { name: "Inicio" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Presencia"));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("main")).toHaveFocus();
  });
  it("presenta identidad, categorías y catálogo de solo lectura", async () => {
    render(<App service={fixtureService()} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Presencia",
    );
    expect(
      screen.getByRole("navigation", { name: "Navegación principal" }),
    ).toHaveTextContent("Conjuntos");
    expect(
      await screen.findByRole("heading", { name: product.name }),
    ).toBeVisible();
    expect(screen.getByText(/No acepta compras/)).toBeVisible();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /comprar|carrito|registr/i }),
    ).not.toBeInTheDocument();
  });
  it("abre y cierra navegación móvil con Escape", () => {
    render(<App service={fixtureService()} />);
    const toggle = screen.getByRole("button", { name: "Abrir menú" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });
  it("filtra por la categoría solicitada y no consulta toda la colección si no existe", async () => {
    at("#/categoria/remeras");
    const products = vi
      .fn()
      .mockResolvedValue({ products: [product], hasMore: false });
    render(<App service={fixtureService({ products })} />);
    expect(
      await screen.findByRole("heading", { name: product.name }),
    ).toBeVisible();
    expect(products).toHaveBeenCalledWith(
      "cat-tee",
      0,
      expect.any(AbortSignal),
    );
  });
  it("permite galería y combinaciones válidas sin inventar stock o descuento", async () => {
    at("#/producto/remera-essential");
    render(<App service={fixtureService()} />);
    expect(
      await screen.findByRole("heading", { name: product.name }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Ver imagen 2 de Remera Essential" }),
    );
    expect(
      screen.getByRole("button", { name: "Ver imagen 2 de Remera Essential" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Negro" }));
    expect(screen.getByRole("button", { name: "L" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Negro / M: variante publicada. Stock por confirmar.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Grafito" }));
    expect(screen.getByRole("button", { name: "M" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText(/No hay un descuento publicado/)).toBeVisible();
    expect(screen.getByText(/25\.000,50/)).toBeVisible();
  });
  it("presenta los talles ordenados y conserva combinaciones de color claro", async () => {
    at("#/producto/remera-oversize-hueso");
    const demo = {
      ...product,
      slug: "remera-oversize-hueso",
      variants: ["Blanco Hueso", "Negro"].flatMap((color) =>
        ["L", "M", "S", "XL"].map((size) => ({
          ...product.variants[0], id: `${color}-${size}`, size, color,
        })),
      ),
    };
    render(<App service={fixtureService({ product: async () => demo })} />);
    await screen.findByRole("heading", { name: product.name });
    const sizes = screen.getByRole("group", { name: /Talle/ });
    expect(within(sizes).getAllByRole("button").map((button) => button.textContent)).toEqual(["S", "M", "L", "XL"]);
    fireEvent.click(screen.getByRole("button", { name: "Blanco Hueso" }));
    fireEvent.click(within(sizes).getByRole("button", { name: "XL" }));
    expect(screen.getByRole("status")).toHaveTextContent("Blanco Hueso / XL: variante publicada. Stock por confirmar.");
    expect(screen.getByText(/No hay un descuento publicado/)).toBeVisible();
  });
  it("muestra errores con reintento y después un catálogo vacío", async () => {
    at("#/catalogo");
    const products = vi
      .fn()
      .mockRejectedValueOnce(new Error("Conexión interrumpida"))
      .mockResolvedValue({ products: [], hasMore: false });
    render(<App service={fixtureService({ products })} />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando colección");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Conexión interrumpida",
    );
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(
      await screen.findByRole("heading", {
        name: "Lo próximo está por llegar",
      }),
    ).toBeVisible();
  });
  it("no consulta productos si la categoría está oculta o no existe", async () => {
    at("#/categoria/conjuntos");
    const products = vi.fn();
    render(<App service={fixtureService({ products })} />);
    expect(
      await screen.findByText("Esta categoría está en preparación"),
    ).toBeVisible();
    expect(products).not.toHaveBeenCalled();
  });
  it("maneja producto no encontrado", async () => {
    at("#/producto/no-existe");
    render(<App service={fixtureService({ product: async () => null })} />);
    expect(
      await screen.findByText("Esta pieza no está disponible"),
    ).toBeVisible();
  });
  it("navega por hash, restaura foco y acepta historial", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(<App service={fixtureService()} />);
    await screen.findByRole("heading", { name: product.name });
    window.history.replaceState(null, "", "/#/categoria/buzos");
    fireEvent(window, new HashChangeEvent("hashchange"));
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "Buzos",
      ),
    );
    expect(screen.getByRole("main")).toHaveFocus();
  });
});
