import {
  cents,
  checkoutUrl,
  identifier,
  PaymentError,
  record,
  testOrder,
  type Context,
  type Settings,
  type Dependency,
  type Validation,
  type PaidAmountDetail,
} from "./core.ts";
import { jsonBody } from "./core.ts";
// Known non-credit transaction details only. Unknown/credit-bearing details fail closed.
const nonCreditDetails: Record<string, readonly string[]> = {
  created: ["created"],
  processing: ["in_process", "pending_review_manual"],
  canceled: ["expired", "canceled", "canceled_transaction"],
  failed: [
    "bad_filled_card_data",
    "invalid_card_token",
    "high_risk",
    "rejected_by_issuer",
    "required_call_for_authorize",
    "max_attempts_exceeded",
    "card_disabled",
    "insufficient_amount",
    "amount_limit_exceeded",
    "invalid_installments",
    "processing_error",
  ],
};
type PaidEvidence =
  | { paid_cents: number; paid_evidence: "reported" }
  | {
      paid_cents: null;
      paid_evidence: "unreported";
      provider_state: string;
      provider_detail: string | null;
    };
export type Snapshot = {
  reference: string;
  seller_id: string;
  application_id: string;
  currency: "ARS";
  amount_cents: number;
  updated_at: string;
  state:
    | "pending"
    | "approved"
    | "rejected"
    | "cancelled"
    | "refunded"
    | "review";
  detail:
    | "accredited"
    | "pending"
    | "rejected"
    | "cancelled"
    | "refunded"
    | "partial"
    | "unknown";
} & PaidEvidence;
export function snapshot(
  raw: unknown,
  c: Context,
  settings: Settings,
  dependency: Dependency = "get",
) {
  // Name the first failing boundary without retaining any response values.
  function field<T>(
    validation: Validation,
    read: () => T,
    detail?: PaidAmountDetail,
  ): T {
    try {
      return read();
    } catch {
      throw new PaymentError(
        "INVALID_PROVIDER_RESPONSE",
        503,
        dependency,
        undefined,
        validation,
        detail,
      );
    }
  }
  function requireField(validation: Validation, valid: boolean) {
    if (!valid)
      field(validation, () => {
        throw new Error();
      });
  }
  const v = field("response_object", () => record(raw));
  const id = String(v.id);
  requireField("order_id", testOrder.test(id));
  requireField(
    "bound_order_id",
    !c.provider_order_id || c.provider_order_id === id,
  );
  requireField("order_type", v.type === "online");
  requireField("processing_mode", v.processing_mode === "manual");
  requireField(
    "status_detail",
    (typeof v.status_detail === "string" && v.status_detail.length > 0) ||
      (v.status === "created" && v.status_detail === undefined),
  );
  requireField("currency", v.currency === "ARS");
  requireField("country", v.country_code === "ARG");
  requireField("reference", v.external_reference === c.reference);
  requireField(
    "seller",
    field("seller", () => identifier(v.user_id)) === c.seller_id &&
      c.seller_id === settings.seller,
  );
  requireField(
    "application",
    field("application", () =>
      identifier(record(v.integration_data).application_id),
    ) === c.application_id && c.application_id === settings.application,
  );
  requireField(
    "total_amount",
    field("total_amount", () => cents(v.total_amount)) === c.amount_cents,
  );
  requireField(
    "live_mode",
    !Object.hasOwn(v, "live_mode") || v.live_mode === false,
  );
  const paidValue = v.total_paid_amount;
  // Classification adds metadata only: cents() remains the sole parser.
  const paidDetail: PaidAmountDetail =
    paidValue === undefined
      ? "missing"
      : paidValue === null
        ? "null"
        : typeof paidValue === "number"
          ? "number"
          : typeof paidValue === "string"
            ? "invalid_text"
            : "unsupported_type";
  const pendingPair =
    (v.status === "created" &&
      (v.status_detail === "created" || v.status_detail === undefined)) ||
    (v.status === "processing" &&
      typeof v.status_detail === "string" &&
      ["in_process", "pending_review_manual"].includes(
        String(v.status_detail),
      ));
  const cancelledPair =
    v.status === "canceled" &&
    typeof v.status_detail === "string" &&
    ["expired", "canceled", "canceled_transaction"].includes(
      String(v.status_detail),
    );
  let evidence: PaidEvidence;
  if (paidValue === undefined && (pendingPair || cancelledPair)) {
    // Unknown is not zero. Only non-credit lifecycle events can carry no amount.
    requireField(
      "payment_evidence",
      ["pending", "rejected", "cancelled", "expired"].includes(c.status) &&
        ["pending", "cancelled", "expired"].includes(c.order_status) &&
        ["unlinked", "awaiting", "closed"].includes(c.reconciliation) &&
        (!pendingPair || ["pending", "rejected"].includes(c.status)),
    );
    if (v.transactions !== undefined) {
      const t = field("payment_evidence", () => record(v.transactions));
      for (const name of ["refunds", "chargebacks"]) {
        if (t[name] !== undefined)
          requireField(
            "payment_evidence",
            Array.isArray(t[name]) && (t[name] as unknown[]).length === 0,
          );
      }
      if (t.payments !== undefined) {
        requireField(
          "payment_evidence",
          Array.isArray(t.payments) && t.payments.length <= 100,
        );
        for (const raw of t.payments as unknown[]) {
          const tx = field("payment_evidence", () => record(raw));
          const allowed =
            cancelledPair || v.status === "created"
              ? ["failed", "canceled"]
              : ["created", "processing", "failed", "canceled"];
          requireField(
            "payment_evidence",
            typeof tx.status === "string" &&
              allowed.includes(tx.status) &&
              typeof tx.status_detail === "string" &&
              nonCreditDetails[tx.status]?.includes(tx.status_detail) === true,
          );
          for (const name of ["paid_amount", "confirmed_amount"])
            if (tx[name] !== undefined)
              requireField(
                "payment_evidence",
                field("payment_evidence", () => cents(tx[name])) === 0,
              );
        }
      }
    }
    evidence = {
      paid_cents: null,
      paid_evidence: "unreported",
      provider_state: String(v.status),
      provider_detail:
        v.status_detail === undefined ? null : String(v.status_detail),
    };
  } else {
    const paid = field("paid_amount", () => cents(paidValue), paidDetail);
    if (paid > c.amount_cents)
      throw new PaymentError(
        "INVALID_PROVIDER_RESPONSE",
        503,
        dependency,
        undefined,
        "paid_amount",
        "exceeds_order",
      );
    evidence = { paid_cents: paid, paid_evidence: "reported" };
  }
  const paid = evidence.paid_cents;
  requireField(
    "updated_at",
    typeof v.last_updated_date === "string" &&
      Number.isFinite(Date.parse(v.last_updated_date)) &&
      Date.parse(v.last_updated_date) <= Date.now() + 300000,
  );
  // Check provider items against frozen SERVER snapshots, not against the current catalog/client.
  const expected = field("items", () => record(c.request).items);
  requireField(
    "items",
    Array.isArray(v.items) &&
      Array.isArray(expected) &&
      v.items.length === expected.length &&
      v.items.length <= 12,
  );
  const canonical = (items: unknown[]) =>
    items
      .map((raw) => {
        const i = field("item_fields", () => record(raw));
        requireField(
          "item_fields",
          Number.isInteger(i.quantity) &&
            Number(i.quantity) >= 1 &&
            Number(i.quantity) <= 3 &&
            typeof i.title === "string",
        );
        return JSON.stringify([
          i.title,
          i.quantity,
          field("item_fields", () => cents(i.unit_price)),
        ]);
      })
      .sort();
  requireField(
    "item_match",
    JSON.stringify(canonical(v.items as unknown[])) ===
      JSON.stringify(canonical(expected as unknown[])),
  );
  let state: Snapshot["state"] = "review",
    detail: Snapshot["detail"] = "unknown";
  if (
    v.status === "processed" &&
    v.status_detail === "accredited" &&
    paid === c.amount_cents
  ) {
    state = "approved";
    detail = "accredited";
  } else if (
    v.status === "processed" &&
    v.status_detail === "partially_refunded"
  ) {
    detail = "partial";
  } else if (
    v.status === "created" ||
    v.status === "processing" ||
    (v.status === "action_required" && v.status_detail === "waiting_capture")
  ) {
    state = "pending";
    detail = "pending";
  } else if (v.status === "failed") {
    state = "rejected";
    detail = "rejected";
  } else if (v.status === "canceled") {
    state = "cancelled";
    detail = "cancelled";
  } else if (v.status === "refunded") {
    state = "refunded";
    detail = "refunded";
  }
  return {
    id,
    url: field("checkout_url", () => checkoutUrl(v.checkout_url, id)),
    value: {
      reference: c.reference,
      seller_id: c.seller_id,
      application_id: c.application_id,
      currency: "ARS",
      amount_cents: c.amount_cents,
      ...evidence,
      updated_at: v.last_updated_date as string,
      state,
      detail,
    } satisfies Snapshot,
  };
}
export class Provider {
  constructor(
    private readonly settings: Settings,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  private async request(
    url: string,
    method = "GET",
    body?: unknown,
    key?: string,
    dependency: import("./core.ts").Dependency = "get",
  ) {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.settings.token}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(key ? { "X-Idempotency-Key": key } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
    } catch {
      throw new PaymentError("PROVIDER_UNAVAILABLE", 503, dependency);
    }
    // Never surface bodies/details from a rejected provider request.
    if (!response.ok) {
      await response.body?.cancel();
      throw new PaymentError("PROVIDER_HTTP", 503, dependency, response.status);
    }
    try {
      return await jsonBody(response);
    } catch {
      throw new PaymentError(
        "INVALID_PROVIDER_RESPONSE",
        503,
        dependency,
        response.status,
        "json_body",
      );
    }
  }
  assertContext(c: Context) {
    if (
      c.seller_id !== this.settings.seller ||
      c.application_id !== this.settings.application
    )
      throw new PaymentError("NOT_CONFIGURED");
  }
  async verifyIdentity() {
    // Official authenticated identity endpoint; no unsigned/user-supplied declaration of sandbox.
    const me = record(
      await this.request(
        "https://api.mercadolibre.com/users/me",
        "GET",
        undefined,
        undefined,
        "identity",
      ),
    );
    if (
      identifier(me.id) !== this.settings.seller ||
      me.site_id !== "MLA" ||
      me.country_id !== "AR" ||
      !Array.isArray(me.tags) ||
      !me.tags.includes("test_user") ||
      record(me.status).site_status !== "active"
    )
      throw new PaymentError("TEST_IDENTITY_REQUIRED", 503, "identity");
  }
  async create(c: Context) {
    this.assertContext(c);
    await this.verifyIdentity();
    return this.request(
      "https://api.mercadopago.com/v1/orders",
      "POST",
      c.request,
      c.idempotency_key,
      "create",
    );
  }
  async get(id: string) {
    if (!testOrder.test(id)) throw new PaymentError("INVALID_REQUEST", 400);
    await this.verifyIdentity();
    return this.request(`https://api.mercadopago.com/v1/orders/${id}`);
  }
  async find(c: Context) {
    this.assertContext(c);
    await this.verifyIdentity();
    const end = Math.min(
      Date.now() + 300000,
      Date.parse(c.expires_at) + 300000,
    );
    const begin = Date.parse(c.expires_at) - 3900000;
    const query = new URLSearchParams({
      begin_date: new Date(begin).toISOString(),
      end_date: new Date(end).toISOString(),
      external_reference: c.reference,
      limit: "2",
    });
    const list = record(
      await this.request(
        `https://api.mercadopago.com/v1/orders?${query}`,
        "GET",
        undefined,
        undefined,
        "search",
      ),
    );
    if (!Array.isArray(list.data) || list.data.length > 1)
      throw new PaymentError(
        "PAYMENT_CONFLICT",
        409,
        "search",
        undefined,
        "search_results",
      );
    if (!list.data.length) return null;
    const v = record(list.data[0]);
    if (v.external_reference !== c.reference || !testOrder.test(String(v.id)))
      throw new PaymentError(
        "INVALID_PROVIDER_RESPONSE",
        503,
        "search",
        undefined,
        "search_resource",
      );
    return this.get(String(v.id));
  }
  async cancel(c: Context) {
    this.assertContext(c);
    if (!c.provider_order_id || !testOrder.test(c.provider_order_id))
      throw new PaymentError("INVALID_REQUEST", 400);
    await this.verifyIdentity();
    return this.request(
      `https://api.mercadopago.com/v1/orders/${c.provider_order_id}/cancel`,
      "POST",
      {},
      c.cancel_key,
      "cancel",
    );
  }
}
