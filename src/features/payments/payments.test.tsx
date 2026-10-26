import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { newAttempt, type Receipt } from "../orders/service";
import {
  paymentConfiguration,
  paymentStorageKey,
  paymentView,
  readPaymentSession,
  requestPayment,
  type PaymentSession,
  type PaymentView,
} from "./service";
import { usePayment } from "./usePayment";
import { PaymentPage } from "./PaymentPage";
import { paymentHeading } from "./model";
import { parseRoute } from "../../app/router";
const ref = "20000000-0000-0000-0000-000000000001";
const session: PaymentSession = {
  version: 1,
  reference: ref,
  attempt: newAttempt({
    items: [{ variant_id: ref, quantity: 2, expected_price_cents: 2500050 }],
    delivery: "pickup",
    payment: "mercado_pago",
  }),
};
const view: PaymentView = {
  reference: ref,
  order_status: "pending",
  payment_status: "pending",
  reconciliation: "awaiting",
  amount_cents: 5000100,
  currency: "ARS",
  expires_at: "2099-10-20T01:00:00Z",
  demo: true,
  checkout_url:
    "https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=ORDTST01KS5AJ6HTK2HRQ3XJ3C2JCKP9",
};
const receipt: Receipt = {
  reference: ref,
  status: "pending",
  subtotal_cents: 5000100,
  created_at: "2099-10-20T00:00:00Z",
  expires_at: view.expires_at,
  demo: true,
};
const config = {
  url: "https://fixture.supabase.co",
  key: "sb_publishable_fixture",
};
const store = () =>
  sessionStorage.setItem(paymentStorageKey, JSON.stringify(session));
beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});
it("requires explicit public flag, existing order service config and Turnstile; no token needed in browser", () => {
  const env = {
    VITE_MP_CHECKOUT_ENABLED: "true",
    VITE_DEMO_ORDERS_ENABLED: "true",
    VITE_TURNSTILE_SITE_KEY: "public-test",
    VITE_SUPABASE_URL: config.url,
    VITE_SUPABASE_PUBLISHABLE_KEY: config.key,
  };
  expect(paymentConfiguration(env)).toEqual(config);
  for (const field of Object.keys(env))
    expect(paymentConfiguration({ ...env, [field]: "" })).toBeNull();
  expect(
    paymentConfiguration({
      ...env,
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_not_public",
    }),
  ).toBeNull();
});
it("stores only validated private recovery identity, never money, URL, buyer or payment success", () => {
  expect(readPaymentSession(JSON.stringify(session))).toEqual(session);
  expect(readPaymentSession(null)).toBeNull();
  for (const bad of [
    "broken",
    "{}",
    JSON.stringify({ ...session, paid: true }),
    JSON.stringify({ ...session, reference: "bad" }),
    JSON.stringify({
      ...session,
      attempt: { ...session.attempt, capability: "bad" },
    }),
    "a".repeat(13000),
  ])
    expect(() => readPaymentSession(bad)).toThrow("STORAGE");
  expect(JSON.stringify(session)).not.toMatch(
    /email|phone|checkout_url|payment_status|access_token/,
  );
});
it("payment request sends only capability/reference/action, ignoring manipulated local prices and provider status", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(view)));
  const tampered = {
    ...session,
    attempt: {
      ...session.attempt,
      payload: {
        ...session.attempt.payload,
        items: [
          { ...session.attempt.payload.items[0], expected_price_cents: 1 },
        ],
      },
    },
  };
  expect(await requestPayment(config, tampered, "create", fetcher)).toEqual(
    view,
  );
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe(config.url + "/functions/v1/mp-checkout");
  expect(JSON.parse(options.body)).toEqual({
    action: "create",
    reference: ref,
    capability: session.attempt.capability,
  });
  expect(options.redirect).toBe("error");
  expect(options.credentials).toBe("omit");
});
it("sends the admin JWT only as Authorization, preserving the public API key", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(view));
  await requestPayment(config, session, "recover", fetcher, "admin-access-jwt");
  const [, options] = fetcher.mock.calls[0];
  expect(options.headers.Authorization).toBe("Bearer admin-access-jwt");
  expect(options.headers.apikey).toBe(config.key);
  expect(options.body).not.toContain("admin-access-jwt");
});
it("transfer calls the authorized demo Edge endpoint and cannot send an approval", async () => {
  const s = {
    ...session,
    attempt: {
      ...session.attempt,
      payload: { ...session.attempt.payload, payment: "transfer" as const },
    },
  };
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ ...view, checkout_url: null })),
    );
  await requestPayment(config, s, "create", fetcher);
  expect(fetcher.mock.calls[0][0]).toBe(
    config.url + "/functions/v1/demo-orders",
  );
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    action: "transfer",
    reference: ref,
    capability: session.attempt.capability,
  });
});
it.each([
  { ...view, reference: "30000000-0000-0000-0000-000000000001" },
  { ...view, demo: false },
  { ...view, currency: "USD" },
  { ...view, amount_cents: 1.1 },
  { ...view, payment_status: "success" },
  { ...view, order_status: "paid" },
  { ...view, checkout_url: "https://evil.example" },
  { ...view, checkout_url: view.checkout_url + "&next=https://evil.example" },
  { ...view, checkout_url: view.checkout_url?.replace("ORDTST", "ORD") },
  { ...view, expires_at: "bad" },
])("rejects malformed/production/redirect-injected response %#", (bad) =>
  expect(() => paymentView(bad, ref)).toThrow("INVALID_RESPONSE"),
);
it("distinguishes absent recover response from invalid create response", async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(() => Promise.resolve(new Response('{"found":false}')));
  expect(await requestPayment(config, session, "recover", fetcher)).toBeNull();
  await expect(
    requestPayment(config, session, "create", fetcher),
  ).rejects.toThrow("INVALID_RESPONSE");
});
it("bounded response + safe error messages never expose HTTP bodies", async () => {
  for (const [body, status, message] of [
    ['{"error":"RATE_LIMITED","debug":"PRIVATE"}', 429, "RATE_LIMITED"],
    ['{"error":"PRIVATE"}', 503, "UNAVAILABLE"],
    ["PRIVATE", 200, "INVALID_RESPONSE"],
    ["x".repeat(17000), 200, "INVALID_RESPONSE"],
  ] as const)
    await expect(
      requestPayment(
        config,
        session,
        "recover",
        vi.fn().mockResolvedValue(new Response(body, { status })),
      ),
    ).rejects.toThrow(message);
  await expect(
    requestPayment(
      config,
      session,
      "recover",
      vi.fn().mockRejectedValue(new Error("PRIVATE")),
    ),
  ).rejects.toThrow("NETWORK_ERROR");
  await expect(
    requestPayment(
      config,
      session,
      "recover",
      vi.fn().mockRejectedValue(new DOMException("PRIVATE", "TimeoutError")),
    ),
  ).rejects.toThrow("TIMEOUT");
});
it("persists capability before redirect, duplicate clicks share reference and a single in-flight request", async () => {
  let resolve!: (v: PaymentView) => void;
  const request = vi.fn(() => new Promise<PaymentView>((r) => (resolve = r)));
  const redirect = vi.fn();
  const hook = renderHook(() =>
    usePayment({ enabled: true, request }, redirect),
  );
  act(() => hook.result.current.attach(receipt, session.attempt));
  expect(readPaymentSession(sessionStorage.getItem(paymentStorageKey))).toEqual(
    session,
  );
  expect(request).toHaveBeenCalledWith(session, "create");
  await act(() => hook.result.current.resume());
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => resolve(view));
  expect(redirect).toHaveBeenCalledWith(view.checkout_url);
  expect(hook.result.current.view).toEqual(view);
});
it("storage failure prevents payment start and retains the original creation attempt", () => {
  const request = vi.fn();
  const hook = renderHook(() => usePayment({ enabled: true, request }));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error();
  });
  expect(() =>
    act(() => hook.result.current.attach(receipt, session.attempt)),
  ).toThrow("STORAGE");
  expect(request).not.toHaveBeenCalled();
});
it("reload queries only; return query status cannot approve, redirect or reserve", async () => {
  store();
  window.history.replaceState(
    null,
    "",
    "/?status=approved#/checkout/pago?payment_status=approved",
  );
  const request = vi.fn().mockResolvedValue({ ...view, checkout_url: null });
  const redirect = vi.fn();
  function Test() {
    const flow = usePayment({ enabled: true, request }, redirect);
    return <PaymentPage flow={flow} />;
  }
  render(<Test />);
  expect(
    await screen.findByRole("heading", { name: "Pago pendiente." }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: /aprobado/ }),
  ).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledExactlyOnceWith(session, "recover");
  expect(redirect).not.toHaveBeenCalled();
  expect(parseRoute(window.location.hash)).toEqual({ kind: "payment" });
});
it("lost request remains recoverable after remount and never creates a new order", async () => {
  store();
  const redirect = vi.fn();
  const request = vi
    .fn()
    .mockRejectedValueOnce(Error("NETWORK_ERROR"))
    .mockResolvedValue({ ...view, checkout_url: null });
  const first = renderHook(() =>
    usePayment({ enabled: true, request }, redirect),
  );
  await act(() => first.result.current.recover());
  expect(first.result.current.error).toMatch(/incierto/);
  expect(first.result.current.view).toBeNull();
  first.unmount();
  const next = renderHook(() =>
    usePayment({ enabled: true, request }, redirect),
  );
  await act(() => next.result.current.recover());
  expect(request.mock.calls).toEqual([
    [session, "recover"],
    [session, "recover"],
  ]);
  expect(redirect).not.toHaveBeenCalled();
});
it("absent operation allows explicit create on same order; no silent retry or polling", async () => {
  store();
  const request = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(view),
    redirect = vi.fn();
  const hook = renderHook(() =>
    usePayment({ enabled: true, request }, redirect),
  );
  await act(() => hook.result.current.recover());
  expect(hook.result.current.absent).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
  await act(() => hook.result.current.resume());
  expect(request).toHaveBeenLastCalledWith(session, "create");
  expect(redirect).toHaveBeenCalledOnce();
});
it.each([
  [
    {
      ...view,
      payment_status: "approved",
      reconciliation: "settled",
      order_status: "confirmed",
      checkout_url: null,
    },
    "Pago aprobado.",
  ],
  [
    {
      ...view,
      payment_status: "approved",
      reconciliation: "review",
      order_status: "expired",
      checkout_url: null,
    },
    "Pago en revisión.",
  ],
  [
    {
      ...view,
      payment_status: "approved",
      reconciliation: "settled",
      order_status: "pending",
      checkout_url: null,
    },
    "Pago pendiente.",
  ],
  [
    { ...view, order_status: "expired", checkout_url: null },
    "La reserva venció.",
  ],
  [
    { ...view, payment_status: "cancelled", checkout_url: null },
    "Pago cancelado.",
  ],
  [
    { ...view, payment_status: "rejected", checkout_url: null },
    "Pago rechazado.",
  ],
] as const)(
  "only server states decide terminal presentation: %s",
  async (state, heading) => {
    store();
    const redirect = vi.fn();
    const request = vi.fn().mockResolvedValue(state);
    const hook = renderHook(() =>
      usePayment({ enabled: true, request }, redirect),
    );
    await act(() => hook.result.current.recover());
    expect(paymentHeading(hook.result.current.view)).toBe(heading);
    expect(redirect).not.toHaveBeenCalled();
  },
);
it("manual retry can neither auto-redirect an expired reserve nor an approval under review", async () => {
  store();
  const redirect = vi.fn();
  const request = vi
    .fn()
    .mockResolvedValue({ ...view, expires_at: "2020-01-01T00:00:00Z" });
  const hook = renderHook(() =>
    usePayment({ enabled: true, request }, redirect),
  );
  await act(() => hook.result.current.resume());
  expect(redirect).not.toHaveBeenCalled();
  request.mockResolvedValue({ ...view, reconciliation: "review" });
  await act(() => hook.result.current.resume());
  expect(redirect).not.toHaveBeenCalled();
});
it("missing or corrupt session never queries by URL/reference alone", async () => {
  sessionStorage.setItem(paymentStorageKey, "bad");
  const request = vi.fn();
  function Test() {
    return <PaymentPage flow={usePayment({ enabled: true, request })} />;
  }
  render(<Test />);
  expect(
    await screen.findByRole("heading", { name: /No encontramos/ }),
  ).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(/almacenamiento/);
  expect(request).not.toHaveBeenCalled();
});
it("fictitious transfer has no account number, upload or browser payment-confirm button", async () => {
  const transfer = {
    ...session,
    attempt: {
      ...session.attempt,
      payload: { ...session.attempt.payload, payment: "transfer" },
    },
  };
  sessionStorage.setItem(paymentStorageKey, JSON.stringify(transfer));
  const request = vi.fn().mockResolvedValue({ ...view, checkout_url: null });
  function Test() {
    return <PaymentPage flow={usePayment({ enabled: true, request })} />;
  }
  render(<Test />);
  expect(await screen.findByText("No transfieras dinero.")).toBeVisible();
  expect(
    screen.queryByRole("button", {
      name: /confirmar|pagué|comprobante|continuar en mercado/i,
    }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Consultar estado" }),
  ).toBeEnabled();
});
it("does not discard recovery until a server terminal state; keeps review records", async () => {
  store();
  const request = vi.fn().mockResolvedValue({ ...view, checkout_url: null });
  const hook = renderHook(() => usePayment({ enabled: true, request }));
  await act(() => hook.result.current.recover());
  act(() => hook.result.current.finish());
  expect(sessionStorage.getItem(paymentStorageKey)).not.toBeNull();
  request.mockResolvedValue({
    ...view,
    order_status: "expired",
    checkout_url: null,
  });
  await act(() => hook.result.current.resume());
  act(() => hook.result.current.finish());
  expect(sessionStorage.getItem(paymentStorageKey)).toBeNull();
});

it("corrupt payment identity blocks a new attachment rather than overwriting an uncertain operation", () => {
  sessionStorage.setItem(paymentStorageKey, "broken");
  const request = vi.fn();
  const hook = renderHook(() => usePayment({ enabled: true, request }));
  expect(hook.result.current.blocked).toBe(true);
  expect(() =>
    act(() => hook.result.current.attach(receipt, session.attempt)),
  ).toThrow("STORAGE");
  expect(sessionStorage.getItem(paymentStorageKey)).toBe("broken");
  expect(request).not.toHaveBeenCalled();
});

it("redirects to the exact provider pref_id URL and preserves private recovery before navigation", async () => {
  const url =
    view.checkout_url + "&pref_id=123-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const request = vi.fn().mockResolvedValue({ ...view, checkout_url: url });
  const redirect = vi.fn();
  const hook = renderHook(() =>
    usePayment({ enabled: true, request }, redirect),
  );
  await act(async () => hook.result.current.attach(receipt, session.attempt));
  expect(redirect).toHaveBeenCalledWith(url);
  expect(readPaymentSession(sessionStorage.getItem(paymentStorageKey))).toEqual(
    session,
  );
  expect(hook.result.current.view?.payment_status).toBe("pending");
});
