// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  cents,
  createPaymentRpc,
  PaymentError,
  sameSecret,
  validateSettings,
} from "../functions/_shared/mp-orders/core";
import { Provider, snapshot } from "../functions/_shared/mp-orders/provider";
import { verifySignature } from "../functions/_shared/mp-orders/signature";
import {
  identity,
  payment,
  remote,
  resource,
  settings,
  signature,
} from "./mp-fixture";
it.each([
  ["0", 0],
  ["25000.50", 2500050],
  ["1.1", 110],
  ["2000000000.00", 200000000000],
])("parses decimal %s exactly in cents", (value, expected) =>
  expect(cents(value)).toBe(expected),
);
it.each([
  1,
  1.01,
  -1,
  "-1",
  "1e3",
  "1,00",
  "0.001",
  "Infinity",
  "2000000000.01",
  null,
])("rejects ambiguous/invalid provider amount %s", (value) =>
  expect(() => cents(value)).toThrow(PaymentError),
);
it.each([
  { mode: "production" },
  { token: "real-token" },
  { origin: "http://localhost:5173" },
  { origin: "https://shop.example/path" },
  { workerSecret: "short" },
  { seller: "bad" },
])("rejects unsafe server settings %j", (extra) =>
  expect(() => validateSettings({ ...settings, ...extra })).toThrow(
    PaymentError,
  ),
);
it("compares worker authority without exposing the secret", async () => {
  expect(await sameSecret("same", "same")).toBe(true);
  expect(await sameSecret("wrong", "same")).toBe(false);
  expect(await sameSecret("", "same")).toBe(false);
});
it.each([
  { tags: [] },
  { id: 999 },
  { site_id: "MLB" },
  { country_id: "BR" },
  { status: { site_status: "blocked" } },
])(
  "a syntactically valid APP_USR token of a non-test/wrong seller cannot issue any payment POST (%j)",
  async (extra) => {
    const fetcher = vi.fn(async () =>
      Response.json({ ...identity, ...extra }),
    ) as unknown as typeof fetch;
    await expect(
      new Provider(settings, fetcher).create(payment),
    ).rejects.toBeInstanceOf(PaymentError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      "https://api.mercadolibre.com/users/me",
    );
  },
);
it("creates only after authenticated test identity, uses official URL/idempotency/frozen body and never follows redirects", async () => {
  const fetcher = vi.fn(async (url) =>
    Response.json(String(url).includes("users/me") ? identity : remote()),
  ) as typeof fetch;
  await new Provider(settings, fetcher).create(payment);
  const [url, options] = vi.mocked(fetcher).mock.calls[1];
  expect(url).toBe("https://api.mercadopago.com/v1/orders");
  expect(options).toMatchObject({
    method: "POST",
    redirect: "error",
    body: JSON.stringify(payment.request),
  });
  expect(new Headers(options!.headers).get("x-idempotency-key")).toBe(
    payment.idempotency_key,
  );
  expect(new Headers(options!.headers).get("authorization")).toBe(
    `Bearer ${settings.token}`,
  );
});
it.each([401, 403, 409, 423, 429, 500])(
  "upstream HTTP %i cannot leak response/credentials or authorize settlement",
  async (status) => {
    const provider = new Provider(
      settings,
      vi.fn(
        async () => new Response("private-upstream-value", { status }),
      ) as typeof fetch,
    );
    await expect(provider.create(payment)).rejects.toMatchObject({
      code: "PROVIDER_HTTP",
    });
  },
);
it.each(["network", "timeout", "json", "oversized"])(
  "handles %s safely",
  async (kind) => {
    const fetcher = vi.fn(async () => {
      if (kind === "network") throw new Error("private-token");
      if (kind === "timeout") throw new DOMException("private", "TimeoutError");
      return new Response(kind === "json" ? "broken" : "x".repeat(70000));
    }) as typeof fetch;
    const error = await new Provider(settings, fetcher)
      .create(payment)
      .catch((e) => e);
    expect(error).toBeInstanceOf(PaymentError);
    expect(String(error)).not.toMatch(/private|token|broken/);
  },
);
it.each([
  { id: "ORDPRODUCTION0000000000" },
  { live_mode: true },
  { currency: "USD" },
  { country_code: "BRA" },
  { user_id: 999 },
  { integration_data: { application_id: "wrong" } },
  { external_reference: "foreign" },
  { total_amount: "0.01" },
  {
    items: [
      { title: "Essential / S / Negro", quantity: 1, unit_price: "25000.50" },
    ],
  },
  { checkout_url: "https://attacker.example/" },
  { last_updated_date: "invalid" },
])("rejects untrusted provider resource before SQL (%j)", (extra) =>
  expect(() => snapshot(remote(extra), payment, settings)).toThrow(
    PaymentError,
  ),
);
it.each([
  [
    {
      status: "processed",
      status_detail: "accredited",
      total_paid_amount: "50001.00",
    },
    "approved",
  ],
  [
    {
      status: "processed",
      status_detail: "accredited",
      total_paid_amount: "1.00",
    },
    "review",
  ],
  [
    {
      status: "processed",
      status_detail: "partially_refunded",
      total_paid_amount: "1.00",
    },
    "review",
  ],
  [{ status: "action_required", status_detail: "waiting_capture" }, "pending"],
  [{ status: "processing", status_detail: "in_process" }, "pending"],
  [{ status: "failed", status_detail: "rejected_by_issuer" }, "rejected"],
  [{ status: "canceled" }, "cancelled"],
  [{ status: "refunded" }, "refunded"],
  [{ status: "unknown" }, "review"],
] as const)(
  "maps status without equating authorization/partial payment with settlement: %j",
  (extra, state) =>
    expect(snapshot(remote(extra), payment, settings).value.state).toBe(state),
);
it.each([String(Date.now()), String(Math.floor(Date.now() / 1000))])(
  "validates official raw-case manifest with timestamp %s",
  async (ts) => {
    const headers = await signature(resource, ts);
    const req = new Request(
      `https://edge.example?type=order&data.id=${resource}`,
      { headers },
    );
    expect(await verifySignature(req, settings.webhookSecret)).toMatchObject({
      id: resource,
    });
  },
);
it("old signed retries are deduplicated downstream; signatures cannot be moved to another resource", async () => {
  const headers = await signature(resource, "1704908010");
  await expect(
    verifySignature(
      new Request(`https://edge.example?type=order&data.id=${resource}`, {
        headers,
      }),
      settings.webhookSecret,
    ),
  ).resolves.toBeTruthy();
  await expect(
    verifySignature(
      new Request(
        "https://edge.example?type=order&data.id=ORDTSTAAAAAAAAAAAAAAAAAAAA",
        { headers },
      ),
      settings.webhookSecret,
    ),
  ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
});
it.each([
  "missing",
  "bad-mac",
  "future",
  "duplicate-param",
  "production",
  "wrong-type",
])("rejects %s signature input", async (kind) => {
  const id = kind === "production" ? "ORDPRODUCTION00000000000" : resource;
  const headers = await signature(
    id,
    kind === "future" ? String(Date.now() + 3600000) : String(Date.now()),
  );
  if (kind === "missing") headers["x-signature"] = "";
  if (kind === "bad-mac")
    headers["x-signature"] = headers["x-signature"].replace(/v1=./, "v1=z");
  const url = `https://edge.example?type=${kind === "wrong-type" ? "payment" : "order"}&data.id=${id}${kind === "duplicate-param" ? `&data.id=${id}` : ""}`;
  await expect(
    verifySignature(new Request(url, { headers }), settings.webhookSecret),
  ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
});
it("searches lost create responses by fixed reference/date range, then verifies resource by GET; never searches a client URL", async () => {
  const fetcher = vi.fn(async (url) =>
    Response.json(
      String(url).includes("users/me")
        ? identity
        : String(url).includes("?")
          ? { data: [{ id: resource, external_reference: payment.reference }] }
          : remote(),
    ),
  ) as typeof fetch;
  expect(await new Provider(settings, fetcher).find(payment)).toMatchObject({
    id: resource,
  });
  const search = new URL(String(vi.mocked(fetcher).mock.calls[1][0]));
  expect(search.origin).toBe("https://api.mercadopago.com");
  expect(search.searchParams.get("external_reference")).toBe(payment.reference);
  expect(search.searchParams.get("begin_date")).toBeTruthy();
});
it("RPC wrapper never propagates raw errors and restricts business errors to known codes", async () => {
  const rpc = createPaymentRpc(
    "https://db.example",
    "private-test-key",
    vi.fn(async () =>
      Response.json(
        { message: "private-token", details: "private" },
        { status: 500 },
      ),
    ) as typeof fetch,
  );
  const error = await rpc("mp_test_settings", {}).catch((e) => e);
  expect(error).toMatchObject({ code: "RPC_UNAVAILABLE" });
  expect(String(error)).not.toContain("private");
});

it("matches official SDK 3.6.1 raw-field canonicalization; older lowercase manifests are rejected for Orders IDs", async () => {
  const ts = "1704908010",
    requestId = "fixture-request";
  const mac = (id: string) =>
    createHmac("sha256", settings.webhookSecret)
      .update(`id:${id};request-id:${requestId};ts:${ts};`)
      .digest("hex");
  const request = (id: string) =>
    new Request(`https://edge.example?type=order&data.id=${resource}`, {
      headers: {
        "x-request-id": requestId,
        "x-signature": `ts=${ts},v1=${mac(id)}`,
      },
    });
  await expect(
    verifySignature(request(resource), settings.webhookSecret),
  ).resolves.toBeTruthy();
  await expect(
    verifySignature(request(resource.toLowerCase()), settings.webhookSecret),
  ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
});

it("accepts the documented Checkout Pro create shape without trusting extra client/payer fields", () => {
  const raw = remote({
    user_id: "123",
    integration_data: { application_id: "456", integrator_id: "ignored" },
    total_paid_amount: "0.00",
    capture_mode: "automatic_async",
    expiration_time: "P1D",
    client_token: "private-client-token",
    payer: { email: "private@example.test" },
    items: [
      {
        title: "Essential / S / Negro",
        quantity: 2,
        unit_price: "25000.50",
        external_code: "ignored",
      },
    ],
  });
  const result = snapshot(raw, payment, settings, "create");
  expect(result).toMatchObject({
    id: resource,
    url: raw.checkout_url,
    value: { state: "pending", paid_cents: 0, amount_cents: 5000100 },
  });
  expect(JSON.stringify(result)).not.toMatch(
    /client-token|private@example|payer|integrator/,
  );
});
it("GET may omit checkout_url; it must still supply the financial/identity/item evidence", () => {
  const result = snapshot(
    remote({
      checkout_url: undefined,
      total_paid_amount: "50001.00",
      status: "processed",
      status_detail: "accredited",
    }),
    { ...payment, provider_order_id: resource },
    settings,
  );
  expect(result.url).toBeNull();
  expect(result.value.state).toBe("approved");
});
it.each([
  [null, "response_object"],
  [{ id: "ORD01J49MMW3SSBK5PSV3DFR32959" }, "order_id"],
  [{ type: "point" }, "order_type"],
  [{ processing_mode: "automatic" }, "processing_mode"],
  [{ currency: "USD" }, "currency"],
  [{ country_code: "BRA" }, "country"],
  [{ external_reference: "private-reference" }, "reference"],
  [{ user_id: "private-id" }, "seller"],
  [{ integration_data: null }, "application"],
  [{ total_amount: 50001 }, "total_amount"],
  [{ total_amount: "0.01" }, "total_amount"],
  [{ live_mode: true }, "live_mode"],
  [
    {
      status: "processed",
      status_detail: "accredited",
      total_paid_amount: undefined,
    },
    "paid_amount",
  ],
  [{ total_paid_amount: "50001.01" }, "paid_amount"],
  [{ last_updated_date: "private-date" }, "updated_at"],
  [{ items: undefined }, "items"],
  [{ items: [null] }, "item_fields"],
  [
    {
      items: [{ title: "private-title", quantity: 2, unit_price: "25000.50" }],
    },
    "item_match",
  ],
  [{ checkout_url: "https://private.example/" }, "checkout_url"],
] as const)(
  "identifies only the static failing validation (%j)",
  (extra, validation) => {
    try {
      snapshot(
        extra === null ? null : remote(extra),
        payment,
        settings,
        "create",
      );
      expect.fail("expected rejection");
    } catch (error) {
      expect(error).toMatchObject({
        code: "INVALID_PROVIDER_RESPONSE",
        http: 503,
        dependency: "create",
        validation,
      });
      expect(String(error)).not.toMatch(/private|50001/);
    }
  },
);
it.each([
  `http://www.mercadopago.com.ar/checkout/v1/redirect?order_id=${resource}`,
  `https://www.mercadopago.com.ar.evil.test/checkout/v1/redirect?order_id=${resource}`,
  `https://attacker@www.mercadopago.com.ar/checkout/v1/redirect?order_id=${resource}`,
  `https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=${resource}&redirect=https://evil.test`,
  `https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=${resource}#extra`,
  `https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=ORDTSTAAAAAAAAAAAAAAAAAAAA`,
  `https://sandbox.mercadopago.com.ar/checkout/v1/redirect?order_id=${resource}`,
])(
  "does not broaden the documented checkout URL allowlist (%s)",
  (checkout_url) => {
    expect(() => snapshot(remote({ checkout_url }), payment, settings)).toThrow(
      expect.objectContaining({ validation: "checkout_url" }),
    );
  },
);
it("a GET cannot substitute a different resource for an already linked order", () => {
  expect(() =>
    snapshot(
      remote(),
      { ...payment, provider_order_id: "ORDTSTAAAAAAAAAAAAAAAAAAAA" },
      settings,
    ),
  ).toThrow(expect.objectContaining({ validation: "bound_order_id" }));
});

it.each([
  [undefined, "missing"],
  [null, "null"],
  [0, "number"],
  [50001, "number"],
  ["", "invalid_text"],
  ["private-amount-sentinel", "invalid_text"],
  ["1e3", "invalid_text"],
  ["1,00", "invalid_text"],
  ["0.001", "invalid_text"],
  ["2000000000.01", "invalid_text"],
  [true, "unsupported_type"],
  [{ private: "amount-sentinel" }, "unsupported_type"],
  [[], "unsupported_type"],
  ["50001.01", "exceeds_order"],
] as const)(
  "rejects paid amount without coercion and classifies only its category (%j)",
  (total_paid_amount, validationDetail) => {
    expect(() =>
      snapshot(
        remote({
          status: "processed",
          status_detail: "accredited",
          total_paid_amount,
        }),
        payment,
        settings,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "INVALID_PROVIDER_RESPONSE",
        dependency: "get",
        validation: "paid_amount",
        validationDetail,
      }),
    );
  },
);
it("a genuinely omitted total_paid_amount cannot prove accreditation", () => {
  const raw: Record<string, unknown> = remote({
    status: "processed",
    status_detail: "accredited",
  });
  delete raw.total_paid_amount;
  expect(() => snapshot(raw, payment, settings)).toThrow(
    expect.objectContaining({
      validation: "paid_amount",
      validationDetail: "missing",
    }),
  );
});
it.each(["0", "0.00", "0.01", "50001.00"])(
  "still accepts explicit valid paid-amount text %s using exact cents",
  (total_paid_amount) => {
    const result = snapshot(remote({ total_paid_amount }), payment, settings);
    expect(result.value.paid_cents).toBe(cents(total_paid_amount));
    expect(result.value.state).toBe("pending");
  },
);

it.each([
  ["created", "created"],
  ["processing", "in_process"],
  ["processing", "pending_review_manual"],
  ["pending", "pending"], // Local/legacy wording is not an Orders API exception.
  ["action_required", "waiting_capture"],
  ["processed", "accredited"],
  ["processed", "partially_refunded"],
  ["refunded", "refunded"],
] as const)(
  "missing paid amount is unknown, never inferred from provider status %s/%s",
  (status, status_detail) => {
    const raw: Record<string, unknown> = remote({ status, status_detail });
    delete raw.total_paid_amount;
    if (["created", "processing"].includes(status)) {
      expect(snapshot(raw, payment, settings).value).toMatchObject({
        state: "pending",
        paid_cents: null,
        paid_evidence: "unreported",
      });
      return;
    }
    expect(() => snapshot(raw, payment, settings, "get")).toThrow(
      expect.objectContaining({
        code: "INVALID_PROVIDER_RESPONSE",
        validation: "paid_amount",
        validationDetail: "missing",
      }),
    );
  },
);
it.each([null, 0, "1e3", "50001.01"])(
  "an accredited label cannot authorize an invalid paid amount (%j)",
  (total_paid_amount) => {
    expect(() =>
      snapshot(
        remote({
          status: "processed",
          status_detail: "accredited",
          total_paid_amount,
        }),
        payment,
        settings,
      ),
    ).toThrow(PaymentError);
  },
);
it.each([
  ["0.00", "review"],
  ["50000.99", "review"],
  ["50001.00", "approved"],
] as const)(
  "accreditation requires explicit exact paid total %s (%s)",
  (total_paid_amount, state) => {
    const result = snapshot(
      remote({
        status: "processed",
        status_detail: "accredited",
        total_paid_amount,
      }),
      payment,
      settings,
    );
    expect(result.value.state).toBe(state);
    expect(result.value.paid_cents).toBe(cents(total_paid_amount));
  },
);

it.each(["expired", "accredited"])(
  "terminal spelling alone cannot supply a missing amount (canceled/%s)",
  (status_detail) => {
    const raw: Record<string, unknown> = remote({
      status: "canceled",
      status_detail,
    });
    delete raw.total_paid_amount;
    if (status_detail === "expired") {
      expect(snapshot(raw, payment, settings).value).toMatchObject({
        state: "cancelled",
        paid_cents: null,
        paid_evidence: "unreported",
      });
      return;
    }
    expect(() => snapshot(raw, payment, settings)).toThrow(
      expect.objectContaining({
        validation: "paid_amount",
        validationDetail: "missing",
      }),
    );
  },
);
it.each([null, 0, "invalid-private-amount", "50001.01"])(
  "canceled/expired does not bypass the existing amount checks (%j)",
  (total_paid_amount) => {
    expect(() =>
      snapshot(
        remote({
          status: "canceled",
          status_detail: "expired",
          total_paid_amount,
        }),
        payment,
        settings,
      ),
    ).toThrow(PaymentError);
  },
);
it("canceled/expired with explicit zero already maps to cancellation, never accreditation", () => {
  const result = snapshot(
    remote({
      status: "canceled",
      status_detail: "expired",
      total_paid_amount: "0.00",
    }),
    payment,
    settings,
  );
  expect(result.value).toMatchObject({
    state: "cancelled",
    detail: "cancelled",
    paid_cents: 0,
  });
});
it.each([
  { id: "ORDPRODUCTION0000000000" },
  { user_id: 999 },
  { integration_data: { application_id: "999" } },
  { currency: "USD" },
  { external_reference: "foreign-reference" },
  { total_amount: "0.01" },
  { items: [{ title: "Foreign", quantity: 2, unit_price: "25000.50" }] },
  { checkout_url: "https://attacker.example/" },
])(
  "a terminal order with an explicit amount still requires identity/products/URL evidence (%j)",
  (extra) => {
    expect(() =>
      snapshot(
        remote({
          status: "canceled",
          status_detail: "expired",
          total_paid_amount: "0.00",
          ...extra,
        }),
        payment,
        settings,
      ),
    ).toThrow(PaymentError);
  },
);

it.each([
  ["created", "created", "pending"],
  ["processing", "in_process", "pending"],
  ["processing", "pending_review_manual", "pending"],
  ["canceled", "expired", "cancelled"],
  ["canceled", "canceled", "cancelled"],
] as const)(
  "v2 separates lifecycle %s/%s from unreported money",
  (status, status_detail, state) => {
    const raw: Record<string, unknown> = remote({ status, status_detail });
    delete raw.total_paid_amount;
    const s = snapshot(raw, payment, settings, "create");
    expect(s.value).toMatchObject({
      state,
      paid_cents: null,
      paid_evidence: "unreported",
      provider_state: status,
      provider_detail: status_detail,
    });
    expect(s.url).toContain(resource);
  },
);
it.each([
  { payments: [{ status: "processed", status_detail: "accredited" }] },
  {
    payments: [{ status: "action_required", status_detail: "waiting_capture" }],
  },
  { payments: [{ status: "canceled", paid_amount: "0.01" }] },
  { payments: [{ status: "failed", confirmed_amount: "1.00" }] },
  { payments: [{ status: "refunded" }] },
  { refunds: [{}] },
  { chargebacks: [{}] },
  { payments: null },
  { payments: [null] },
  { payments: [{ status: ["failed"] }] },
])(
  "unknown money cannot hide contradictory/malformed transaction evidence %j",
  (transactions) => {
    expect(() =>
      snapshot(
        remote({ total_paid_amount: undefined, transactions }),
        payment,
        settings,
      ),
    ).toThrow(expect.objectContaining({ validation: "payment_evidence" }));
  },
);
it.each([
  { status: "approved" },
  { status: "refunded" },
  { status: "cancelled" },
  { status: "expired" },
  { reconciliation: "settled" },
  { reconciliation: "review" },
  { order_status: "confirmed" },
])("unknown money cannot overwrite protected local state %j", (extra) => {
  expect(() =>
    snapshot(
      remote({ total_paid_amount: undefined }),
      { ...payment, ...extra },
      settings,
    ),
  ).toThrow(expect.objectContaining({ validation: "payment_evidence" }));
});
it("valid non-credit transaction evidence remains unknown instead of summing it into zero", () => {
  const result = snapshot(
    remote({
      total_paid_amount: undefined,
      transactions: {
        payments: [
          {
            status: "failed",
            status_detail: "rejected_by_issuer",
            paid_amount: "0.00",
          },
        ],
        refunds: [],
      },
    }),
    payment,
    settings,
  );
  expect(result.value.paid_cents).toBeNull();
});
it.each([
  { currency: "USD" },
  { user_id: "999" },
  { integration_data: { application_id: "999" } },
  { external_reference: "foreign" },
  { total_amount: "0.01" },
  { items: [] },
  { checkout_url: "https://www.mercadopago.com.ar.evil.test/" },
  {
    checkout_url: `https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=${resource}&next=https://evil.test`,
  },
])(
  "unreported creation still verifies all identity/item/URL boundaries %j",
  (extra) => {
    expect(() =>
      snapshot(
        remote({ total_paid_amount: undefined, ...extra }),
        payment,
        settings,
      ),
    ).toThrow(PaymentError);
  },
);

it.each([undefined, "approved", "unknown-provider-detail"])(
  "unreported money requires a recognized non-credit transaction detail (%j)",
  (status_detail) => {
    expect(() =>
      snapshot(
        remote({
          total_paid_amount: undefined,
          transactions: { payments: [{ status: "failed", status_detail }] },
        }),
        payment,
        settings,
      ),
    ).toThrow(expect.objectContaining({ validation: "payment_evidence" }));
  },
);
