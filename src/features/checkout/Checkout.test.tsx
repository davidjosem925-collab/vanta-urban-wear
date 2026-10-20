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
import { STORAGE_KEY } from "../cart/model";

function route(hash: string) {
  act(() => {
    window.history.replaceState(null, "", `/${hash}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}
function seed() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      lines: [
        {
          slug: product.slug,
          productId: product.id,
          variantId: product.variants[0].id,
          quantity: 2,
        },
      ],
    }),
  );
}
async function start() {
  seed();
  route("#/checkout");
  const app = render(<App service={fixtureService()} />);
  await screen.findByLabelText("Nombre");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Revisar demostración" }),
    ).toBeEnabled(),
  );
  return app;
}
function contact() {
  for (const [name, value] of [
    ["Nombre", "Lucía"],
    ["Apellido", "Pérez"],
    ["Correo electrónico", "lucia@example.com"],
    ["Teléfono de contacto", "+54 9 11 5555-1234"],
  ])
    fireEvent.change(screen.getByLabelText(name), { target: { value } });
}
function pickup() {
  fireEvent.click(
    screen.getByRole("radio", { name: /Retiro en local ficticio/ }),
  );
  fireEvent.click(screen.getByRole("radio", { name: /Efectivo — Demo/ }));
}
async function review() {
  fireEvent.click(screen.getByRole("button", { name: "Revisar demostración" }));
  await screen.findByRole("heading", { name: "Todo en su lugar." });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Finalizar demostración" }),
    ).toBeEnabled(),
  );
}
beforeEach(() => vi.spyOn(window, "scrollTo").mockImplementation(() => {}));
afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});
describe("Checkout integrado con el carrito existente", () => {
  it.each(["#/checkout", "#/checkout/revision", "#/checkout/finalizado"])(
    "bloquea acceso vacío en %s",
    async (hash) => {
      route(hash);
      render(<App service={fixtureService()} />);
      expect(
        await screen.findByRole("heading", {
          name: "Tu selección está vacía.",
        }),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Finalizar demostración" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Explorar la colección" }),
      ).toHaveAttribute("href", "#/catalogo");
    },
  );
  it("valida junto a cada campo, enfoca el primer error y conserva datos correctos", async () => {
    await start();
    fireEvent.change(screen.getByLabelText("Apellido"), {
      target: { value: "Pérez" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Revisar demostración" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Revisá los campos",
    );
    const name = screen.getByLabelText("Nombre");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription(
      "Ingresá tu nombre (entre 2 y 60 caracteres).",
    );
    await waitFor(() => expect(name).toHaveFocus());
    expect(screen.getByLabelText("Apellido")).toHaveValue("Pérez");
    expect(screen.getByLabelText("Correo electrónico")).toHaveAttribute(
      "autocomplete",
      "email",
    );
  });
  it("muestra solo dirección de envío; efectivo se limpia al cambiar de modalidad", async () => {
    await start();
    contact();
    expect(screen.getByLabelText("Provincia")).toBeVisible();
    expect(
      screen.getByRole("radio", { name: /Efectivo — Demo/ }),
    ).toBeDisabled();
    pickup();
    expect(screen.queryByLabelText("Provincia")).not.toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Efectivo — Demo/ }),
    ).toBeChecked();
    const total = screen.getByRole("complementary", {
      name: "Resumen de la selección",
    });
    expect(within(total).getByText("$ 50.001", { exact: true })).toBeVisible();
    fireEvent.click(screen.getByRole("radio", { name: /Envío a domicilio/ }));
    expect(
      screen.getByRole("radio", { name: /Efectivo — Demo/ }),
    ).not.toBeChecked();
    expect(screen.getByText(/Efectivo solo está disponible/)).toBeVisible();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Lucía");
  });
  it("conserva memoria al volver y navegar, finaliza sin vaciar ni persistir datos personales", async () => {
    await start();
    contact();
    pickup();
    await review();
    expect(screen.getByText("lucia@example.com")).toBeVisible();
    fireEvent.click(screen.getByRole("link", { name: "Editar información" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Nombre")).toHaveValue("Lucía"),
    );
    expect(
      screen.getByRole("radio", { name: /Retiro en local ficticio/ }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: /Efectivo — Demo/ }),
    ).toBeChecked();
    route("#/catalogo");
    await screen.findByRole("heading", { name: /Toda la colección/ });
    route("#/checkout");
    await screen.findByLabelText("Nombre");
    expect(screen.getByLabelText("Correo electrónico")).toHaveValue(
      "lucia@example.com",
    );
    await review();
    fireEvent.click(
      screen.getByRole("button", { name: "Finalizar demostración" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Recorrido de compra completado.",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        /No se realizó ningún cobro ni se registró un pedido real/,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Abrir carrito, 2 unidades" }),
    ).toBeVisible();
    expect(localStorage.getItem(STORAGE_KEY)).not.toMatch(
      /Lucía|Pérez|lucia|phone|email|price/,
    );
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).lines).toHaveLength(
      1,
    );
  });
  it("la recarga conserva el carrito, pierde PII y no permite falsificar una finalización", async () => {
    const app = await start();
    contact();
    pickup();
    await review();
    app.unmount();
    render(<App service={fixtureService()} />);
    expect(
      await screen.findByText(/Completá tus datos, entrega y método/),
    ).toBeVisible();
    expect(screen.queryByText("lucia@example.com")).not.toBeInTheDocument();
    route("#/checkout/finalizado");
    expect(
      screen.queryByRole("heading", {
        name: "Recorrido de compra completado.",
      }),
    ).not.toBeInTheDocument();
    route("#/checkout");
    expect(await screen.findByLabelText("Nombre")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Abrir carrito, 2 unidades" }),
    ).toBeVisible();
  });
  it("revalida precio/variante y bloquea la finalización ante error o despublicación", async () => {
    seed();
    route("#/checkout");
    let current = product;
    let offline = false;
    const service = fixtureService({
      product: async () => {
        if (offline) throw new Error("offline fixture");
        return current;
      },
    });
    render(<App service={service} />);
    await screen.findByLabelText("Nombre");
    contact();
    pickup();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Revisar demostración" }),
      ).toBeEnabled(),
    );
    await review();
    current = { ...product, price_cents: 2700000 };
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() =>
      expect(
        screen
          .getByRole("complementary")
          .querySelector(".checkout-total strong"),
      ).toHaveTextContent("54.000"),
    );
    offline = true;
    act(() => window.dispatchEvent(new Event("focus")));
    expect(
      await screen.findByText(/No pudimos verificar toda la selección/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Finalizar demostración" }),
    ).toBeDisabled();
    offline = false;
    fireEvent.click(
      screen.getByRole("button", { name: "Reintentar verificación" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Finalizar demostración" }),
      ).toBeEnabled(),
    );
    current = { ...current, variants: [] };
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Finalizar demostración" }),
      ).toBeDisabled(),
    );
    expect(
      await screen.findByText(/No pudimos verificar toda la selección/),
    ).toBeVisible();
  });
});
