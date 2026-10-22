import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { OrderPayments } from "./OrderPayments";
import {
  emptyPayments,
  orderActions,
  paymentLabel,
  type AdminPayment,
} from "./paymentModel";
import type { DemoOrder } from "./model";
const calls = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./client", () => ({ rpc: calls.rpc }));
const order: DemoOrder = {
  id: "10000000-0000-0000-0000-000000000001",
  public_reference: "20000000-0000-0000-0000-000000000001",
  status: "pending",
  created_at: "2026-10-22T10:00:00Z",
  reservation_expires_at: "2026-10-22T11:00:00Z",
  reservation_resolved_at: null,
  subtotal_cents: 2700000,
  delivery: "pickup",
  demo_payment: "transfer",
};
const pay: AdminPayment = {
  id: order.id,
  method: "bank_transfer",
  status: "pending",
  amount_cents: 2700000,
  currency: "ARS",
  mp_test: false,
  operation_id: null,
  provider_status: null,
  provider_detail: null,
  reconciliation: null,
  created_at: order.created_at,
  updated_at: order.created_at,
  verified_at: null,
};
const data = { ...emptyPayments(order.id), payments: [pay] };
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("separates payment labels, read-only legacy orders and provider-only MP approval", () => {
  expect(paymentLabel("rejected")).toBe("Rechazado");
  expect(orderActions(order, emptyPayments(order.id))).toEqual([]);
  expect(orderActions(order, data).map((a) => a.action)).toEqual([
    "confirm",
    "cancel",
  ]);
  expect(
    orderActions(
      { ...order, demo_payment: "mercado_pago" },
      {
        ...data,
        payments: [{ ...pay, mp_test: true, method: "mercado_pago" }],
      },
    ).map((a) => a.action),
  ).toEqual(["cancel"]);
  expect(
    orderActions(order, {
      ...data,
      payments: [{ ...pay, amount_cents: 1 }],
    }).map((a) => a.action),
  ).toEqual(["cancel"]);
});
it("fulfillment requires a settled provider proof and never offers a manual MP approval", () => {
  const o = { ...order, status: "confirmed", demo_payment: "mercado_pago" };
  const p = {
    ...pay,
    method: "mercado_pago",
    mp_test: true,
    status: "approved",
  };
  expect(orderActions(o, { ...data, payments: [p] })).toEqual([]);
  expect(
    orderActions(o, {
      ...data,
      payments: [
        {
          ...p,
          reconciliation: "settled",
          provider_status: "approved",
          provider_detail: "accredited",
        },
      ],
    }),
  ).toEqual([{ action: "prepare", label: "Marcar en preparación" }]);
});
it("requires accessible confirmation, cancels without a write, then submits an immutable action", async () => {
  calls.rpc.mockResolvedValue({ order_status: "confirmed" });
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(<OrderPayments order={order} data={data} refresh={refresh} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Registrar transferencia demo" }),
  );
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(calls.rpc).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Registrar transferencia demo" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirmar cambio" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(calls.rpc).toHaveBeenCalledWith(
    "admin_demo_order_action",
    expect.objectContaining({
      p_id: order.id,
      p_action: "confirm",
      p_expected_status: "pending",
      p_key: expect.any(String),
    }),
  );
});
it("lost response keeps the same key and blocks alternate actions until recovery", async () => {
  calls.rpc
    .mockRejectedValueOnce(new Error("Respuesta no disponible"))
    .mockResolvedValueOnce({ order_status: "confirmed" });
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(<OrderPayments order={order} data={data} refresh={refresh} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Registrar transferencia demo" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirmar cambio" }));
  await screen.findByRole("alert");
  expect(
    screen.getByRole("button", { name: "Cancelar reserva demo" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Reintentar misma acción" }),
  );
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(calls.rpc.mock.calls[0]).toEqual(calls.rpc.mock.calls[1]);
});
it("shows safe delivery states and warns that accepted email does not prove payment or inbox receipt", () => {
  render(
    <OrderPayments
      order={order}
      data={{
        ...data,
        notifications: [
          {
            event: "order_received",
            state: "accepted",
            delivery: "unknown",
            error_code: null,
            created_at: order.created_at,
          },
        ],
      }}
      refresh={vi.fn()}
    />,
  );
  expect(screen.getByText(/Aceptado por Resend/)).toBeVisible();
  expect(screen.getByText(/Los fallos de correo no cambian/)).toBeVisible();
});
