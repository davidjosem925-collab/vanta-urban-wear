import {
  cents,
  checkoutUrl,
  identifier,
  PaymentError,
  record,
  testOrder,
  type Context,
  type Settings,
} from "./core.ts";
import { jsonBody } from "./core.ts";
export type Snapshot = {
  reference: string;
  seller_id: string;
  application_id: string;
  currency: "ARS";
  amount_cents: number;
  paid_cents: number;
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
};
export function snapshot(raw: unknown, c: Context, settings: Settings) {
  const v = record(raw);
  const id = String(v.id);
  if (
    !testOrder.test(id) ||
    (c.provider_order_id && c.provider_order_id !== id) ||
    v.type !== "online" ||
    v.processing_mode !== "manual" ||
    v.currency !== "ARS" ||
    v.country_code !== "ARG" ||
    v.external_reference !== c.reference ||
    identifier(v.user_id) !== c.seller_id ||
    c.seller_id !== settings.seller ||
    identifier(record(v.integration_data).application_id) !==
      c.application_id ||
    c.application_id !== settings.application ||
    cents(v.total_amount) !== c.amount_cents ||
    v.live_mode === true
  )
    throw new PaymentError("INVALID_PROVIDER_RESPONSE");
  const paid = cents(v.total_paid_amount);
  if (
    paid > c.amount_cents ||
    typeof v.last_updated_date !== "string" ||
    !Number.isFinite(Date.parse(v.last_updated_date)) ||
    Date.parse(v.last_updated_date) > Date.now() + 300000
  )
    throw new PaymentError("INVALID_PROVIDER_RESPONSE");
  // Check provider items against frozen SERVER snapshots, not against the current catalog/client.
  const expected = record(c.request).items;
  if (
    !Array.isArray(v.items) ||
    !Array.isArray(expected) ||
    v.items.length !== expected.length ||
    v.items.length > 12
  )
    throw new PaymentError("INVALID_PROVIDER_RESPONSE");
  const canonical = (items: unknown[]) =>
    items
      .map((raw) => {
        const i = record(raw);
        if (
          !Number.isInteger(i.quantity) ||
          Number(i.quantity) < 1 ||
          Number(i.quantity) > 3 ||
          typeof i.title !== "string"
        )
          throw new PaymentError("INVALID_PROVIDER_RESPONSE");
        return JSON.stringify([i.title, i.quantity, cents(i.unit_price)]);
      })
      .sort();
  if (
    JSON.stringify(canonical(v.items)) !== JSON.stringify(canonical(expected))
  )
    throw new PaymentError("INVALID_PROVIDER_RESPONSE");
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
    url: checkoutUrl(v.checkout_url, id),
    value: {
      reference: c.reference,
      seller_id: c.seller_id,
      application_id: c.application_id,
      currency: "ARS",
      amount_cents: c.amount_cents,
      paid_cents: paid,
      updated_at: v.last_updated_date,
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
      );
    }
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
      throw new PaymentError("PAYMENT_CONFLICT", 409);
    if (!list.data.length) return null;
    const v = record(list.data[0]);
    if (v.external_reference !== c.reference || !testOrder.test(String(v.id)))
      throw new PaymentError("INVALID_PROVIDER_RESPONSE");
    return this.get(String(v.id));
  }
  async cancel(c: Context) {
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
