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
import type { OrderService } from "../orders/service";
import type { PaymentService } from "../payments/service";

// This suite exercises the local-only checkout. Never inherit deployed order
// configuration or contact an Edge Function from a unit test.
const localOrders: OrderService = {
  enabled: false,
  siteKey: "",
  confirm: vi.fn(() => {
    throw new Error("Unexpected order creation");
  }),
  recover: vi.fn(() => {
    throw new Error("Unexpected order recovery");
  }),
};

// Legacy checkout cases must not inherit a developer's phase-3 flag.
const localPayments: PaymentService = {
  enabled: false,
  request: vi.fn(async () => {
    throw new Error("Unexpected payment request");
  }),
};
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
  const app = render(
    <App
      service={fixtureService()}
      orders={localOrders}
      payments={localPayments}
    />,
  );
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
  vi.unstubAllGlobals();
  delete window.turnstile;
  sessionStorage.clear();
});
describe("Checkout integrado con el carrito existente", () => {
  it("contrae inicialmente en móvil y mantiene cantidades, subtotal, entrega y formulario al alternar", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    await start();
    contact();
    pickup();
    const summary = screen.getByRole("complementary", {
      name: "Resumen de la selección",
    });
    const toggle = within(summary).getByText("Ver productos");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      within(summary).getByRole("heading", { name: "Tu selección" }),
    ).toBeVisible();
    expect(within(summary).getByText("2 unidades")).toBeVisible();
    expect(
      await within(summary).findByText("$ 50.001", { exact: true }),
    ).toBeVisible();
    expect(within(summary).getByText("Cantidad: 2")).not.toBeVisible();
    expect(
      within(summary).getByText("Retiro ficticio · Sin costo"),
    ).toBeVisible();
    expect(within(summary).getByText("Efectivo — Demo")).toBeVisible();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveTextContent("Ocultar productos"));
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(summary).getByText("Cantidad: 2")).toBeVisible();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveTextContent("Ver productos"));
    expect(within(summary).getByText("Cantidad: 2")).not.toBeVisible();
    expect(
      await within(summary).findByText("$ 50.001", { exact: true }),
    ).toBeVisible();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Lucía");
    expect(
      screen.getByRole("radio", { name: /Efectivo — Demo/ }),
    ).toBeChecked();
    fireEvent.click(
      within(summary).getByRole("button", { name: "Modificar carrito" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Tu carrito" }),
    ).toBeVisible();
  });
  it("mantiene el resumen abierto y el contenido lateral actual en escritorio", async () => {
    await start();
    const summary = screen.getByRole("complementary", {
      name: "Resumen de la selección",
    });
    expect(summary.querySelector("details")).toHaveAttribute("open");
    expect(within(summary).getByText("Cantidad: 2")).toBeVisible();
    expect(
      within(summary).queryByText("Ver productos"),
    ).not.toBeInTheDocument();
    expect(
      within(summary).getByRole("button", { name: "Modificar carrito" }),
    ).toBeVisible();
  });
  it.each(["#/checkout", "#/checkout/revision", "#/checkout/finalizado"])(
    "bloquea acceso vacío en %s",
    async (hash) => {
      route(hash);
      render(
        <App
          service={fixtureService()}
          orders={localOrders}
          payments={localPayments}
        />,
      );
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
    render(
      <App
        service={fixtureService()}
        orders={localOrders}
        payments={localPayments}
      />,
    );
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
    render(
      <App service={service} orders={localOrders} payments={localPayments} />,
    );
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

// The enabled path is tested separately with a simulated server receipt. The
// local-only tests above must not silently switch modes with .env.local.
it.each([true, false])(
  "enabled orders require a challenge and server acceptance (accepted=%s)",
  async (accepted) => {
    const variantId = "10000000-0000-0000-0000-000000000001";
    const item = {
      ...product,
      variants: [{ ...product.variants[0], id: variantId }],
    };
    const confirm = accepted
      ? vi.fn().mockResolvedValue({
          reference: "20000000-0000-0000-0000-000000000001",
          status: "pending",
          subtotal_cents: 5000100,
          created_at: "2026-10-20T00:00:00Z",
          expires_at: "2026-10-20T01:00:00Z",
          demo: true,
        })
      : vi.fn().mockRejectedValue(new Error("PRICE_CHANGED"));
    const orders: OrderService = {
      enabled: true,
      siteKey: "fixture",
      confirm,
      recover: vi.fn(),
    };
    let token: ((value: string) => void) | undefined;
    window.turnstile = {
      render: vi.fn((_el, options) => {
        token = options.callback as (value: string) => void;
        return "fixture";
      }),
      remove: vi.fn(),
    };
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        lines: [
          { slug: item.slug, productId: item.id, variantId, quantity: 2 },
        ],
      }),
    );
    route("#/checkout");
    render(
      <App
        service={fixtureService({ product: async () => item })}
        orders={orders}
        payments={localPayments}
      />,
    );
    await screen.findByLabelText("Nombre");
    contact();
    pickup();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Revisar demostración" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Revisar demostración" }),
    );
    const button = await screen.findByRole("button", {
      name: "Confirmar pedido demo",
    });
    expect(button).toBeDisabled();
    expect(confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(token).toBeTypeOf("function"));
    act(() => token!("fixture-token"));
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0][0].payload).toEqual({
      items: [
        { variant_id: variantId, quantity: 2, expected_price_cents: 2500050 },
      ],
      delivery: "pickup",
      payment: "cash",
    });
    expect(confirm.mock.calls[0][1]).toBe("fixture-token");
    if (accepted) {
      expect(
        await screen.findByRole("heading", { name: "Pedido demo registrado." }),
      ).toBeVisible();
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).lines).toHaveLength(
        0,
      );
    } else {
      expect(await screen.findByRole("alert")).toHaveTextContent(/precio/i);
      expect(
        screen.queryByRole("heading", { name: "Pedido demo registrado." }),
      ).not.toBeInTheDocument();
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).lines).toHaveLength(
        1,
      );
      expect(
        screen.getByRole("button", { name: "Confirmar pedido demo" }),
      ).toBeDisabled();
    }
  },
);
