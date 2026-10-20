import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CartContext, type CartContextValue } from "./context";
import { CartFeedback } from "./CartFeedback";
import { fixtureService, product } from "../../test/fixtures";

function value(id = 1): CartContextValue {
  return {
    entries: [],
    units: 2,
    total: 5_000_100,
    warning: "",
    open: false,
    adding: false,
    service: fixtureService(),
    notice: { id, product, variant: product.variants[0], quantity: 1 },
    dismissNotice: vi.fn(),
    openCart: vi.fn(),
    closeCart: vi.fn(),
    refresh: vi.fn(),
    add: vi.fn(),
    setQuantity: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("Notificación no modal del carrito", () => {
  it("vence a los cuatro segundos y no roba foco", () => {
    const cart = value();
    render(
      <CartContext.Provider value={cart}>
        <button autoFocus>Seguir navegando</button>
        <CartFeedback />
      </CartContext.Provider>,
    );
    expect(
      screen.getByRole("button", { name: "Seguir navegando" }),
    ).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("1 unidad agregada");
    act(() => vi.advanceTimersByTime(3999));
    expect(cart.dismissNotice).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(cart.dismissNotice).toHaveBeenCalledTimes(1);
  });
  it("reinicia la duración al reemplazar un agregado consecutivo", () => {
    const first = value();
    const view = render(
      <CartContext.Provider value={first}>
        <CartFeedback />
      </CartContext.Provider>,
    );
    act(() => vi.advanceTimersByTime(3000));
    const next = value(2);
    next.notice = {
      ...next.notice!,
      variant: product.variants[1],
      quantity: 3,
    };
    view.rerender(
      <CartContext.Provider value={next}>
        <CartFeedback />
      </CartContext.Provider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Grafito · 3 unidades agregadas",
    );
    act(() => vi.advanceTimersByTime(3999));
    expect(first.dismissNotice).not.toHaveBeenCalled();
    expect(next.dismissNotice).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(next.dismissNotice).toHaveBeenCalledTimes(1);
  });
  it("pausa al interactuar con teclado y permite cerrar o abrir el carrito", () => {
    const cart = value();
    render(
      <CartContext.Provider value={cart}>
        <CartFeedback />
      </CartContext.Provider>,
    );
    const view = screen.getByRole("button", { name: "Ver carrito" });
    fireEvent.focusIn(view);
    act(() => vi.advanceTimersByTime(12000));
    expect(cart.dismissNotice).not.toHaveBeenCalled();
    fireEvent.click(view);
    expect(cart.openCart).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole("button", { name: "Cerrar notificación" }),
    );
    expect(cart.dismissNotice).toHaveBeenCalledOnce();
  });
});
