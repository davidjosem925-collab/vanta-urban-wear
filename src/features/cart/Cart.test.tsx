import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { fixtureService, product } from "../../test/fixtures";
import { formatARS } from "../catalog/model";
import type { CatalogProduct } from "../catalog/service";
import { selection, STORAGE_KEY, writeCart } from "./model";

const price = (cents: number) => formatARS(cents).replace(/\s/g, " ");
const line = selection(product, "Negro", "M", 2);
beforeEach(() => {
  window.history.replaceState(null, "", "/#/producto/remera-essential");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});
async function detail(service = fixtureService()) {
  const view = render(<App service={service} />);
  await screen.findByRole("heading", { name: product.name, level: 1 });
  return view;
}
function choose(color = "Negro", size = "M") {
  fireEvent.click(screen.getByRole("button", { name: color }));
  fireEvent.click(screen.getByRole("button", { name: size }));
}
async function add() {
  fireEvent.click(screen.getByRole("button", { name: "Agregar al carrito" }));
  await screen.findByText("Prenda agregada al carrito.");
}
async function open() {
  fireEvent.click(screen.getByRole("button", { name: /^Abrir carrito/ }));
  const panel = await screen.findByRole("dialog", { name: "Tu carrito" });
  await waitFor(() =>
    expect(
      within(panel).queryByText("Verificando prenda y precio…"),
    ).not.toBeInTheDocument(),
  );
  return panel;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe("Carrito integrado", () => {
  it("notifica sin abrir el panel y muestra los datos recién verificados", async () => {
    await detail();
    choose();
    const button = screen.getByRole("button", { name: "Agregar al carrito" });
    button.focus();
    await add();
    const notice = screen.getByRole("region", { name: "Producto agregado" });
    expect(within(notice).getByText(product.name)).toBeVisible();
    expect(within(notice).getByText(/Talle M/)).toHaveTextContent("Negro");
    expect(within(notice).getByText(/1 unidad agregada/)).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    fireEvent.click(
      within(notice).getByRole("button", { name: "Ver carrito" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Tu carrito" }),
    ).toBeVisible();
  });
  it("muestra carrito vacío, acceso visible y continuación deshabilitada", async () => {
    await detail();
    const panel = await open();
    expect(
      within(panel).getByText("Todavía no agregaste prendas a tu carrito."),
    ).toBeVisible();
    expect(
      within(panel).getByRole("button", { name: /Continuar al checkout/ }),
    ).toBeDisabled();
    expect(
      within(panel).getByRole("link", { name: "Explorar la colección" }),
    ).toHaveAttribute("href", "#/catalogo");
    expect(
      screen.getByRole("button", { name: "Abrir carrito, 0 unidades" }),
    ).toHaveAttribute("aria-expanded", "true");
  });
  it("exige talle y color, muestra feedback y no consulta ni agrega antes de seleccionarlos", async () => {
    const lookup = vi.fn().mockResolvedValue(product);
    await detail(fixtureService({ product: lookup }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar al carrito" }));
    expect(
      await screen.findByText(
        "Seleccioná talle y color antes de agregar la prenda.",
      ),
    ).toBeVisible();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Negro" }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar al carrito" }));
    expect(
      await screen.findByText(
        "Seleccioná talle y color antes de agregar la prenda.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Abrir carrito, 0 unidades" }),
    ).toBeVisible();
  });
  it("agrega la cantidad elegida, conserva datos mínimos y calcula en centavos ARS", async () => {
    await detail();
    choose();
    fireEvent.change(screen.getByLabelText("Cantidad", { exact: true }), {
      target: { value: "2" },
    });
    await add();
    expect(
      screen.getByRole("button", { name: "Abrir carrito, 2 unidades" }),
    ).toBeVisible();
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
        version: 1,
        lines: [line],
      }),
    );
    const panel = await open();
    expect(
      within(panel).getByRole("link", { name: product.name }),
    ).toHaveAttribute("href", "#/producto/remera-essential");
    expect(
      within(panel).getByText("Talle M", { exact: false }),
    ).toHaveTextContent("Negro");
    expect(
      within(panel).getByRole("img", { name: "Essential vista frontal" }),
    ).toHaveAttribute("src", product.images[0].url);
    expect(
      within(panel).getByText(`${price(product.price_cents)} ARS`, {
        exact: false,
      }),
    ).toBeVisible();
    expect(within(panel).getByText("Subtotal")).toHaveTextContent(
      `${price(product.price_cents * 2)} ARS`,
    );
    expect(within(panel).queryByText(/Stock por confirmar|En stock/i)).not.toBeInTheDocument();
    expect(within(panel).getByText("Agregar prendas al carrito no reserva unidades.")).toBeVisible();
    expect(
      within(panel).getByText(price(product.price_cents * 2), { exact: true }),
    ).toBeVisible();
  });
  it("agrupa unidades de la misma variante y separa combinaciones diferentes", async () => {
    await detail();
    choose();
    await add();
    await add();
    choose("Grafito", "L");
    await add();
    const panel = await open();
    expect(within(panel).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(panel).getByRole("group", { name: /Negro, M/ }),
    ).toHaveTextContent("2");
    expect(
      within(panel).getByRole("group", { name: /Grafito, L/ }),
    ).toHaveTextContent("1");
    expect(within(panel).getByText("3 unidades")).toBeVisible();
  });
  it("aumenta, disminuye, respeta el mínimo y elimina artículos", async () => {
    await detail();
    choose();
    await add();
    const panel = await open();
    expect(
      within(panel).getByRole("button", { name: /^Disminuir/ }),
    ).toBeDisabled();
    fireEvent.click(within(panel).getByRole("button", { name: /^Aumentar/ }));
    await waitFor(() =>
      expect(within(panel).getByText("2 unidades")).toBeVisible(),
    );
    await waitFor(() =>
      expect(
        within(panel).queryByText("Verificando prenda y precio…"),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(within(panel).getByRole("button", { name: /^Disminuir/ }));
    await waitFor(() =>
      expect(within(panel).getByText("1 unidad")).toBeVisible(),
    );
    fireEvent.click(within(panel).getByRole("button", { name: /^Eliminar/ }));
    expect(
      within(panel).getByText("Todavía no agregaste prendas a tu carrito."),
    ).toBeVisible();
  });
  it("no supera el límite por variante ni acepta cantidades fraccionarias", async () => {
    await detail();
    choose();
    const input = screen.getByLabelText("Cantidad", { exact: true });
    for (const value of ["0", "11", "1.5", ""]) {
      fireEvent.change(input, { target: { value } });
      fireEvent.click(
        screen.getByRole("button", { name: "Agregar al carrito" }),
      );
      expect(
        await screen.findByText("Elegí una cantidad entera entre 1 y 10."),
      ).toBeVisible();
    }
    fireEvent.change(input, { target: { value: "10" } });
    await add();
    fireEvent.click(screen.getByRole("button", { name: "Agregar al carrito" }));
    expect(
      await screen.findByText(/El límite del carrito es 10 unidades/),
    ).toBeVisible();
    const panel = await open();
    expect(
      within(panel).getByRole("button", { name: /^Aumentar/ }),
    ).toBeDisabled();
  });
  it("pide confirmación antes de vaciar y permite cancelarla", async () => {
    localStorage.setItem(STORAGE_KEY, writeCart([line]));
    await detail();
    const panel = await open();
    fireEvent.click(
      within(panel).getByRole("button", { name: "Vaciar carrito" }),
    );
    expect(
      within(panel).getByRole("group", { name: "Confirmar vaciar carrito" }),
    ).toBeVisible();
    fireEvent.click(within(panel).getByRole("button", { name: "Cancelar" }));
    expect(within(panel).getAllByRole("listitem")).toHaveLength(1);
    expect(
      within(panel).getByRole("button", { name: "Vaciar carrito" }),
    ).toHaveFocus();
    fireEvent.click(
      within(panel).getByRole("button", { name: "Vaciar carrito" }),
    );
    fireEvent.click(within(panel).getByRole("button", { name: "Sí, vaciar" }));
    expect(
      within(panel).getByText("Todavía no agregaste prendas a tu carrito."),
    ).toBeVisible();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).lines).toEqual([]);
  });
  it("restaura tras remontar y verifica el precio actual sin confiar en importes guardados", async () => {
    const first = await detail();
    choose();
    await add();
    first.unmount();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    stored.lines[0].price_cents = 1;
    stored.lines[0].stock = 999;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    const current = { ...product, price_cents: 9_999_999 };
    await detail(fixtureService({ product: async () => current }));
    const panel = await open();
    expect(
      within(panel).getByText(price(current.price_cents), { exact: true }),
    ).toBeVisible();
    expect(localStorage.getItem(STORAGE_KEY)).not.toMatch(
      /price_cents|stock|url/,
    );
  });
  it.each(["{bad", JSON.stringify({ version: 99, lines: [line] })])(
    "recupera datos corruptos o de otra versión sin romper la tienda",
    async (raw) => {
      localStorage.setItem(STORAGE_KEY, raw);
      await detail();
      const panel = await open();
      expect(within(panel).getByRole("alert")).toHaveTextContent(/descartamos/);
      expect(within(panel).getByText("0 unidades")).toBeVisible();
    },
  );
  it("funciona en memoria e informa cuando el navegador bloquea localStorage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    await detail();
    choose();
    await add();
    const panel = await open();
    expect(within(panel).getByRole("alert")).toHaveTextContent(
      "durante esta visita",
    );
    expect(within(panel).getByText("1 unidad")).toBeVisible();
  });
  it("ante error de conexión oculta importes, permite reintentar y no borra la selección", async () => {
    localStorage.setItem(STORAGE_KEY, writeCart([line]));
    let offline = false;
    const service = fixtureService({
      product: async () => {
        if (offline) throw new Error("offline");
        return product;
      },
    });
    await detail(service);
    offline = true;
    const panel = await open();
    expect(within(panel).getByText("Por confirmar")).toBeVisible();
    expect(within(panel).queryByText("Subtotal")).not.toBeInTheDocument();
    expect(
      within(panel).getByText(/No pudimos consultar el catálogo/),
    ).toBeVisible();
    offline = false;
    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Volver a verificar catálogo",
      }),
    );
    await waitFor(() =>
      expect(
        within(panel).getByText(price(product.price_cents * 2), {
          exact: true,
        }),
      ).toBeVisible(),
    );
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).lines).toEqual([
      line,
    ]);
  });
  it("no calcula un producto despublicado y permite quitarlo", async () => {
    localStorage.setItem(STORAGE_KEY, writeCart([line]));
    let published = true;
    await detail(
      fixtureService({ product: async () => (published ? product : null) }),
    );
    published = false;
    const panel = await open();
    await waitFor(() =>
      expect(
        within(panel).getByText(/Producto o variante sin disponibilidad/),
      ).toBeVisible(),
    );
    expect(within(panel).getByText("Por confirmar")).toBeVisible();
    fireEvent.click(within(panel).getByRole("button", { name: /^Eliminar/ }));
    expect(within(panel).getByText("0 unidades")).toBeVisible();
  });
  it("comunica errores al agregar y permite un nuevo intento", async () => {
    let fail = false;
    await detail(
      fixtureService({
        product: async () => {
          if (fail) throw new Error("offline");
          return product;
        },
      }),
    );
    choose();
    fail = true;
    fireEvent.click(screen.getByRole("button", { name: "Agregar al carrito" }));
    expect(
      await screen.findByText(/Revisá tu conexión e intentá nuevamente/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Abrir carrito, 0 unidades" }),
    ).toBeVisible();
    fail = false;
    await add();
  });
  it("bloquea dobles envíos mientras consulta el catálogo", async () => {
    const pending = deferred<CatalogProduct>();
    let delay = false;
    await detail(
      fixtureService({
        product: async () => (delay ? pending.promise : product),
      }),
    );
    choose();
    delay = true;
    fireEvent.click(screen.getByRole("button", { name: "Agregar al carrito" }));
    expect(
      screen.getByRole("button", { name: "Verificando…" }),
    ).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Verificando…" }));
    await act(async () => pending.resolve(product));
    expect(
      await screen.findByText("Prenda agregada al carrito."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Abrir carrito, 1 unidad" }),
    ).toBeVisible();
  });
  it("ignora respuestas de validaciones antiguas tras actualizar cantidades", async () => {
    localStorage.setItem(STORAGE_KEY, writeCart([line]));
    const old = deferred<CatalogProduct>();
    let slow = false;
    await detail(
      fixtureService({ product: async () => (slow ? old.promise : product) }),
    );
    const panel = await open();
    slow = true;
    fireEvent.click(within(panel).getByRole("button", { name: /^Aumentar/ }));
    expect(
      within(panel).getByRole("link", { name: product.name }),
    ).toBeVisible();
    expect(within(panel).getByText("Subtotal")).toHaveTextContent(
      "Por confirmar",
    );
    expect(
      within(panel).queryByText(`${price(product.price_cents)} ARS`, {
        exact: false,
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: /^Eliminar/ }));
    await act(async () => old.resolve(product));
    expect(within(panel).getByText("0 unidades")).toBeVisible();
    expect(within(panel).queryByRole("listitem")).not.toBeInTheDocument();
  });
  it("vaciar durante una consulta pendiente no permite que esta reponga prendas", async () => {
    localStorage.setItem(STORAGE_KEY, writeCart([line]));
    const pending = deferred<CatalogProduct>();
    let delay = false;
    await detail(
      fixtureService({
        product: async () => (delay ? pending.promise : product),
      }),
    );
    choose();
    delay = true;
    fireEvent.click(screen.getByRole("button", { name: "Agregar al carrito" }));
    fireEvent.click(screen.getByRole("button", { name: /^Abrir carrito/ }));
    const panel = screen.getByRole("dialog");
    fireEvent.click(
      within(panel).getByRole("button", { name: "Vaciar carrito" }),
    );
    fireEvent.click(within(panel).getByRole("button", { name: "Sí, vaciar" }));
    await act(async () => pending.resolve(product));
    expect(within(panel).getByText("0 unidades")).toBeVisible();
    fireEvent.click(
      within(panel).getByRole("button", { name: "Cerrar carrito" }),
    );
    expect(
      await screen.findByText(/El carrito cambió durante la consulta/),
    ).toBeVisible();
  });
  it("sincroniza otra pestaña y descarta los importes que esta envíe", async () => {
    await detail();
    act(() =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          storageArea: localStorage,
          newValue: JSON.stringify({
            version: 1,
            lines: [{ ...line, price_cents: 0 }],
          }),
        }),
      ),
    );
    const panel = await open();
    expect(within(panel).getByText("2 unidades")).toBeVisible();
    expect(
      within(panel).getByText(price(product.price_cents * 2), { exact: true }),
    ).toBeVisible();
  });
  it("cierra con botón, Escape y clic fuera, y devuelve el foco al acceso", async () => {
    await detail();
    const trigger = screen.getByRole("button", { name: /^Abrir carrito/ });
    trigger.focus();
    let panel = await open();
    expect(
      within(panel).getByRole("button", { name: "Cerrar carrito" }),
    ).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(
      within(panel).getByRole("button", { name: "Cerrar carrito" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
    panel = await open();
    fireEvent(panel, new Event("cancel", { bubbles: true, cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    panel = await open();
    fireEvent.click(panel, { clientX: -1, clientY: 5 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("Escape cancela primero la confirmación y el acceso móvil cierra el menú", async () => {
    localStorage.setItem(STORAGE_KEY, writeCart([line]));
    await detail();
    const menu = screen.getByRole("button", { name: "Abrir menú" });
    fireEvent.click(menu);
    const panel = await open();
    expect(menu).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(
      within(panel).getByRole("button", { name: "Vaciar carrito" }),
    );
    fireEvent(panel, new Event("cancel", { bubbles: true, cancelable: true }));
    expect(panel).toHaveAttribute("open");
    expect(
      within(panel).queryByRole("group", { name: "Confirmar vaciar carrito" }),
    ).not.toBeInTheDocument();
  });
  it("preserva el carrito al navegar entre rutas", async () => {
    await detail();
    choose();
    await add();
    const panel = await open();
    fireEvent.click(
      within(panel).getByRole("button", { name: "Vaciar carrito" }),
    );
    fireEvent.click(within(panel).getByRole("link", { name: product.name }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const reopened = await open();
    expect(
      within(reopened).queryByRole("group", {
        name: "Confirmar vaciar carrito",
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(reopened).getByRole("button", { name: "Cerrar carrito" }),
    );
    fireEvent.click(screen.getByRole("link", { name: "VANTA, inicio" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "Presencia",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Abrir carrito, 1 unidad" }),
    ).toBeVisible();
  });
});
