// @vitest-environment node
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createDemoDb } from "./demo-fixture";
import { paymentView } from "../../src/features/payments/service";
import {
  hash,
  PaymentError,
  type Rpc,
  type RpcName,
  type Diagnostic,
} from "../functions/_shared/mp-orders/core";
import { makePaymentHandler } from "../functions/_shared/mp-orders/handlers";
import { identity, remote, resource, settings, signature } from "./mp-fixture";
let db: Awaited<ReturnType<typeof createDemoDb>>;
const variant = "10000000-0000-0000-0000-000000000001",
  capability = "a".repeat(64);
let reference = "",
  saved: Record<string, unknown> | null = null,
  providerState: Record<string, unknown> = {},
  loseResponse = false,
  realSeller = false;
let diagnostics: Diagnostic[] = [];
let postResponse: Record<string, unknown> = {};
let writes: { url: string; body: unknown; key: string | null }[] = [];
const fetcher = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
  const path = String(url);
  if (path === "https://api.mercadolibre.com/users/me")
    return Response.json({
      ...identity,
      tags: realSeller ? [] : identity.tags,
    });
  if (path.includes("/v1/orders?"))
    return Response.json({
      data: saved ? [{ id: resource, external_reference: reference }] : [],
    });
  if (
    path === "https://api.mercadopago.com/v1/orders" &&
    options?.method === "POST"
  ) {
    const body = JSON.parse(String(options.body));
    saved = body;
    writes.push({
      url: path,
      body,
      key: new Headers(options.headers).get("x-idempotency-key"),
    });
    if (loseResponse) {
      loseResponse = false;
      throw new TypeError("private-fixture-error");
    }
    return Response.json(
      remote({
        external_reference: reference,
        items: saved.items,
        ...providerState,
        ...postResponse,
      }),
      { status: 201 },
    );
  }
  if (path.endsWith("/cancel"))
    providerState = {
      status: "canceled",
      status_detail: "canceled_transaction",
    };
  return Response.json(
    remote({
      external_reference: reference,
      items: saved?.items ?? [],
      ...providerState,
    }),
  );
}) as typeof fetch;
const rpc: Rpc = async (name, args) => {
  const entries = Object.entries(args);
  const params = entries.map(([k], i) => `${k}=>$${i + 1}`).join(",");
  try {
    return (
      await db.query<{ v: unknown }>(
        `select public.${name}(${params}) v`,
        entries.map(([, v]) =>
          typeof v === "object" && v !== null ? JSON.stringify(v) : v,
        ),
      )
    ).rows[0]?.v;
  } catch (e) {
    if (e instanceof Error && e.message === "ORDER_UNAVAILABLE")
      throw new PaymentError("ORDER_UNAVAILABLE", 404);
    throw new PaymentError("RPC_UNAVAILABLE");
  }
};
function handler(
  op: "checkout" | "webhook" | "worker",
  extra: Partial<typeof settings> = {},
  call: Rpc = rpc,
) {
  return makePaymentHandler(op, { ...settings, ...extra }, call, fetcher, (v) =>
    diagnostics.push(v),
  );
}
function checkout(
  action = "create",
  extra: Record<string, unknown> = {},
  who = capability,
) {
  return new Request("https://edge.example/mp-checkout", {
    method: "POST",
    headers: { "content-type": "application/json", origin: settings.origin },
    body: JSON.stringify({ action, reference, capability: who, ...extra }),
  });
}
async function webhook(
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return new Request(
    `https://edge.example/mp-webhook?type=order&data.id=${resource}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(await signature()),
        ...headers,
      },
      body: JSON.stringify({
        type: "order",
        live_mode: false,
        application_id: settings.application,
        user_id: settings.seller,
        data: { id: resource },
        ...extra,
      }),
    },
  );
}
function worker(secret = settings.workerSecret) {
  return new Request("https://edge.example/mp-reconcile", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    },
    body: "{}",
  });
}
async function value(sql: string) {
  // Trusted fixture inspection only. Handler RPCs still run as service_role.
  await db.exec("reset role");
  try {
    return (await db.query<{ v: unknown }>(sql)).rows[0]?.v;
  } finally {
    await db.exec("set role service_role");
  }
}
async function due() {
  await db.exec(
    "update public.payments set mp_lease_until=null,mp_next_check=clock_timestamp()-interval '1 second'",
  );
}
beforeAll(async () => {
  db = await createDemoDb();
  await db.exec(
    "create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('request.jwt.claim.aal',true))$$;",
  );
  for (const file of [
    "202610200001_demo_orders.sql",
    "202610200002_admin_panel.sql",
    "202610230001_mp_test_backend.sql",
    "202610240001_mp_payment_evidence.sql",
    "202610240002_mp_created_without_detail.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.exec(`insert into public.categories(id,name,slug,active) values('${variant}','Remeras','remeras',true);
 insert into public.products(id,category_id,name,description,slug,price_cents,active) values('${variant}','${variant}','Essential','Original','essential',2500050,true);
 insert into public.product_variants(id,product_id,sku,size,color,active) values('${variant}','${variant}','A','S','Negro',true);insert into public.inventory(variant_id,on_hand) values('${variant}',8);`);
}, 30000);
afterAll(async () => db.close());
beforeEach(async () => {
  diagnostics = [];
  writes = [];
  saved = null;
  providerState = {};
  postResponse = {};
  loseResponse = false;
  realSeller = false;
  vi.mocked(fetcher).mockClear();
  await db.exec(
    "reset role;delete from public.payment_events;delete from public.payments;delete from public.inventory_movements;delete from public.stock_reservations;delete from public.order_items;delete from public.orders;delete from public.demo_request_limits;update public.mp_test_config set enabled=true,seller_id='123',application_id='456';update public.inventory set on_hand=8,reserved=0;",
  );
  const payload = {
    items: [
      { variant_id: variant, quantity: 2, expected_price_cents: 2500050 },
    ],
    delivery: "pickup",
    payment: "mercado_pago",
  };
  const r = await db.query<{ v: { reference: string } }>(
    "select public.demo_create_order($1,$2,$3) v",
    [randomUUID(), await hash(capability), JSON.stringify(payload)],
  );
  reference = r.rows[0].v.reference;
  await db.exec("set role service_role");
});
it("real SQL + simulated provider: create, repeat, signed approval and replay consume exactly once without exposing private fields", async () => {
  const create = handler("checkout");
  const first = await create(checkout());
  expect(first.status).toBe(200);
  const data = await first.json();
  expect(data).toMatchObject({
    payment_status: "pending",
    order_status: "pending",
    amount_cents: 5000100,
  });
  expect(JSON.stringify(data)).not.toMatch(
    /idempotency|capability|request|seller_id|application_id|token/,
  );
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toMatchObject({
    total_amount: "50001.00",
    items: [{ unit_price: "25000.50", quantity: 2 }],
  });
  expect((await create(checkout())).status).toBe(200);
  expect(writes).toHaveLength(1);
  providerState = {
    status: "processed",
    status_detail: "accredited",
    total_paid_amount: "50001.00",
  };
  const request = await webhook();
  const copy = request.clone();
  expect((await handler("webhook")(request)).status).toBe(200);
  expect((await handler("webhook")(copy)).status).toBe(200);
  expect(await value("select status v from public.orders")).toBe("confirmed");
  expect(await value("select on_hand v from public.inventory")).toBe(6);
  expect(await value("select reserved v from public.inventory")).toBe(0);
  expect(
    await value(
      "select count(*)::int v from public.inventory_movements where kind='consume'",
    ),
  ).toBe(1);
  expect(await value("select count(*)::int v from public.payment_events")).toBe(
    1,
  );
  expect(JSON.stringify(diagnostics)).not.toContain(capability);
  expect(JSON.stringify(diagnostics)).not.toContain(settings.token);
});
it("wrong capability and arbitrary prices cannot create a payment or call the provider", async () => {
  expect(
    (await handler("checkout")(checkout("create", { amount_cents: 1 }))).status,
  ).toBe(400);
  expect(
    (await handler("checkout")(checkout("create", {}, "b".repeat(64)))).status,
  ).toBe(404);
  expect(writes).toHaveLength(0);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await value("select count(*)::int v from public.payments")).toBe(0);
});
it("a productive seller token is rejected before payment preparation or any provider POST", async () => {
  realSeller = true;
  const r = await handler("checkout")(checkout());
  expect(r.status).toBe(503);
  expect(await r.json()).toEqual({ error: "TEST_IDENTITY_REQUIRED" });
  expect(writes).toHaveLength(0);
  expect(await value("select count(*)::int v from public.payments")).toBe(0);
});
it("both independent flags block create but recover never creates a payment", async () => {
  expect(
    (await handler("checkout", { enabled: false })(checkout())).status,
  ).toBe(503);
  await db.exec(
    "reset role;update public.mp_test_config set enabled=false;set role service_role",
  );
  expect((await handler("checkout")(checkout())).status).toBe(503);
  expect(await (await handler("checkout")(checkout("recover"))).json()).toEqual(
    { found: false },
  );
  expect(writes).toHaveLength(0);
});
it("lost create response is recovered by worker search without creating another payment/reservation/order", async () => {
  loseResponse = true;
  expect((await handler("checkout")(checkout())).status).toBe(503);
  expect(writes).toHaveLength(1);
  await db.exec("reset role");
  await due();
  await db.exec("set role service_role");
  expect((await handler("worker")(worker())).status).toBe(200);
  expect(writes).toHaveLength(1);
  expect(await value("select mp_order_id v from public.payments")).toBe(
    resource,
  );
  expect(await value("select reserved v from public.inventory")).toBe(2);
});
it("worker after expiry queries/cancels provider and late approval only marks review", async () => {
  expect((await handler("checkout")(checkout())).status).toBe(200);
  await db.exec(
    "reset role;update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes';select public.demo_expire_orders();",
  );
  await due();
  await db.exec("set role service_role");
  expect((await handler("worker")(worker())).status).toBe(200);
  expect(await value("select status v from public.payments")).toBe("expired");
  providerState = {
    status: "processed",
    status_detail: "accredited",
    total_paid_amount: "50001.00",
  };
  expect((await handler("webhook")(await webhook())).status).toBe(200);
  expect(await value("select mp_reconciliation v from public.payments")).toBe(
    "review",
  );
  expect(await value("select status v from public.orders")).toBe("expired");
  expect(await value("select on_hand v from public.inventory")).toBe(8);
});
it("signed notification with fabricated approval body still uses server GET, not the body as payment proof", async () => {
  await handler("checkout")(checkout());
  expect(
    (
      await handler("webhook")(
        await webhook({
          status: "approved",
          data: {
            id: resource,
            status: "processed",
            total_paid_amount: "50001.00",
          },
        }),
      )
    ).status,
  ).toBe(200);
  expect(await value("select status v from public.orders")).toBe("pending");
});
it.each(["signature", "live", "seller", "application", "data"])(
  "rejects invalid webhook %s before any provider request",
  async (kind) => {
    const headers = kind === "signature" ? { "x-signature": "bad" } : {};
    const extra =
      kind === "live"
        ? { live_mode: true }
        : kind === "seller"
          ? { user_id: "999" }
          : kind === "application"
            ? { application_id: "999" }
            : kind === "data"
              ? { data: { id: "foreign" } }
              : {};
    const request = await webhook(extra, headers);
    vi.mocked(fetcher).mockClear();
    expect((await handler("webhook")(request)).status).toBeGreaterThanOrEqual(
      400,
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      await value("select count(*)::int v from public.payment_events"),
    ).toBe(0);
  },
);
it("API mismatch cannot consume inventory; durable inbox remains retryable", async () => {
  await handler("checkout")(checkout());
  providerState = { total_amount: "1.00" };
  const r = await handler("webhook")(await webhook());
  expect(r.status).toBe(503);
  expect(await value("select reserved v from public.inventory")).toBe(2);
  expect(await value("select status v from public.payment_events")).toBe(
    "received",
  );
});
it("a webhook after a lost bind can link the verified resource and approve; no new POST is issued", async () => {
  loseResponse = true;
  await handler("checkout")(checkout());
  providerState = {
    status: "processed",
    status_detail: "accredited",
    total_paid_amount: "50001.00",
  };
  expect((await handler("webhook")(await webhook())).status).toBe(200);
  expect(writes).toHaveLength(1);
  expect(await value("select status v from public.orders")).toBe("confirmed");
});
it("private worker rejects ordinary/browser auth; a failed RPC never becomes an accepted webhook", async () => {
  expect((await handler("worker")(worker("public-user-session"))).status).toBe(
    403,
  );
  const broken: Rpc = async (name: RpcName, args) => {
    if (name === "mp_test_accept_event")
      throw new Error("private-stack-details");
    return rpc(name, args);
  };
  const response = await handler("webhook", {}, broken)(await webhook());
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain("private");
  expect(JSON.stringify(diagnostics)).not.toContain("private");
});
it("origin, rate limits and body bounds reject calls before any provider access", async () => {
  const request = checkout();
  const wrong = new Request(request, {
    headers: {
      "content-type": "application/json",
      origin: "https://foreign.example",
    },
  });
  expect((await handler("checkout")(wrong)).status).toBe(403);
  const limited: Rpc = async (name, args) =>
    name === "demo_rate_limit" ? false : rpc(name, args);
  expect((await handler("checkout", {}, limited)(checkout())).status).toBe(429);
  const large = new Request("https://edge.example", {
    method: "POST",
    headers: { "content-type": "application/json", origin: settings.origin },
    body: "x".repeat(2048),
  });
  expect((await handler("checkout")(large)).status).toBe(413);
  expect(fetcher).not.toHaveBeenCalled();
});
it("safe diagnostic identifies upstream identity HTTP status without recording request/response/token/IP", async () => {
  const reject = vi.fn(
    async () => new Response("private-provider-body", { status: 401 }),
  ) as typeof fetch;
  const r = await makePaymentHandler("checkout", settings, rpc, reject, (e) =>
    diagnostics.push(e),
  )(checkout());
  expect(r.status).toBe(503);
  expect(await r.json()).toEqual({ error: "PROVIDER_HTTP" });
  expect(diagnostics.at(-1)).toMatchObject({
    operation: "checkout",
    dependency: "identity",
    upstream_status: 401,
    outcome: "PROVIDER_HTTP",
  });
  expect(JSON.stringify(diagnostics)).not.toMatch(
    /private-provider|APP_USR|capability|127\.0/,
  );
});
it("a signed notification for an order without a prepared payment cannot create a payment or consume inventory", async () => {
  saved = { items: [] };
  providerState = {
    status: "processed",
    status_detail: "accredited",
    total_paid_amount: "50001.00",
  };
  expect((await handler("webhook")(await webhook())).status).toBe(200);
  expect(await value("select count(*)::int v from public.payments")).toBe(0);
  expect(await value("select status v from public.orders")).toBe("pending");
  expect(await value("select mp_outcome v from public.payment_events")).toBe(
    "unknown_resource",
  );
});
it("disabling creation still permits read-only orphan search, but never issues another POST", async () => {
  await rpc("mp_test_prepare", {
    p_reference: reference,
    p_owner: await hash(capability),
    p_create: true,
    p_return_origin: settings.origin,
  });
  await db.exec("reset role;update public.mp_test_config set enabled=false");
  await due();
  await db.exec("set role service_role");
  expect((await handler("worker", { enabled: false })(worker())).status).toBe(
    200,
  );
  expect(writes).toHaveLength(0);
  expect(await value("select mp_reconciliation v from public.payments")).toBe(
    "review",
  );
  expect(await value("select reserved v from public.inventory")).toBe(2);
});

it("rejected create response can leave a real provider order unlinked; worker searches then GETs it without another POST/reservation", async () => {
  providerState = {
    checkout_url: "https://private.example/unsafe?token=private-value",
    payer: { email: "private@example.test" },
  };
  const response = await handler("checkout")(checkout());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "INVALID_PROVIDER_RESPONSE" });
  expect(diagnostics.at(-1)).toEqual({
    event: "mp_test_diagnostic",
    operation: "checkout",
    outcome: "INVALID_PROVIDER_RESPONSE",
    http_status: 503,
    dependency: "create",
    validation: "checkout_url",
  });
  expect(await value("select mp_order_id v from public.payments")).toBeNull();
  expect(writes).toHaveLength(1);
  const key = writes[0].key;
  expect(saved).not.toBeNull();
  expect(
    await value("select count(*)::int v from public.stock_reservations"),
  ).toBe(1);
  providerState = {};
  await db.exec("reset role");
  await due();
  await db.exec("set role service_role");
  const recovered = await handler("worker")(worker());
  expect(await recovered.json()).toMatchObject({ processed: 1, retry: 0 });
  expect(await value("select mp_order_id v from public.payments")).toBe(
    resource,
  );
  expect(writes).toHaveLength(1);
  expect(writes[0].key).toBe(key);
  expect(await value("select reserved v from public.inventory")).toBe(2);
  expect(await value("select on_hand v from public.inventory")).toBe(8);
  expect(await value("select count(*)::int v from public.orders")).toBe(1);
  expect(
    await value("select count(*)::int v from public.stock_reservations"),
  ).toBe(1);
  expect(JSON.stringify(diagnostics)).not.toMatch(
    /private|token=|APP_USR|capability/,
  );
});
it("worker HTTP 200 is not proof of reconciliation: invalid GET is reported as retry with its validation", async () => {
  await handler("checkout")(checkout());
  providerState = { integration_data: null };
  await db.exec("reset role");
  await due();
  await db.exec("set role service_role");
  const response = await handler("worker")(worker());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ processed: 0, retry: 1 });
  expect(diagnostics.at(-1)).toMatchObject({
    operation: "worker",
    http_status: 200,
    outcome: "INVALID_PROVIDER_RESPONSE",
    dependency: "get",
    validation: "application",
  });
  expect(await value("select status v from public.orders")).toBe("pending");
  expect(await value("select on_hand v from public.inventory")).toBe(8);
});

it.each([
  [undefined, "missing"],
  [null, "null"],
  [0, "number"],
  ["private-paid-value", "invalid_text"],
  [{ private: "paid-value" }, "unsupported_type"],
  ["50001.01", "exceeds_order"],
] as const)(
  "unlinked GET failure reports only paid-amount category (%j), never links/settles or duplicates a reservation",
  async (total_paid_amount, validation_detail) => {
    providerState = {
      status: "processed",
      status_detail: "accredited",
      total_paid_amount,
    };
    const first = await handler("checkout")(checkout());
    expect(first.status).toBe(503);
    expect(await first.json()).toEqual({ error: "INVALID_PROVIDER_RESPONSE" });
    expect(await value("select mp_order_id v from public.payments")).toBeNull();
    expect(saved).not.toBeNull();
    await db.exec("reset role");
    await due();
    await db.exec("set role service_role");
    const response = await handler("worker")(worker());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ processed: 0, retry: 1 });
    expect(diagnostics.at(-1)).toEqual({
      event: "mp_test_diagnostic",
      operation: "worker",
      outcome: "INVALID_PROVIDER_RESPONSE",
      dependency: "get",
      validation: "paid_amount",
      validation_detail,
      http_status: 200,
    });
    expect(await value("select mp_order_id v from public.payments")).toBeNull();
    expect(await value("select mp_reconciliation v from public.payments")).toBe(
      "unlinked",
    );
    expect(await value("select status v from public.orders")).toBe("pending");
    expect(await value("select reserved v from public.inventory")).toBe(2);
    expect(await value("select on_hand v from public.inventory")).toBe(8);
    expect(
      await value("select count(*)::int v from public.stock_reservations"),
    ).toBe(1);
    expect(writes).toHaveLength(1);
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /private|paid-value|APP_USR|capability/,
    );
    expect(JSON.stringify(diagnostics)).not.toContain(reference);
    expect(JSON.stringify(diagnostics)).not.toContain(writes[0].key!);
  },
);

it.each([
  ["processed", "accredited"],
  ["processed", "partially_refunded"],
  ["refunded", "refunded"],
] as const)(
  "missing GET amount in %s/%s never binds or settles an unlinked order by assuming zero",
  async (status, status_detail) => {
    providerState = { status, status_detail, total_paid_amount: undefined };
    const first = await handler("checkout")(checkout());
    expect(first.status).toBe(503);
    await db.exec("reset role");
    await due();
    await db.exec("set role service_role");
    const response = await handler("worker")(worker());
    expect(await response.json()).toMatchObject({ processed: 0, retry: 1 });
    expect(diagnostics.at(-1)).toMatchObject({
      dependency: "get",
      validation: "paid_amount",
      validation_detail: "missing",
    });
    expect(await value("select mp_order_id v from public.payments")).toBeNull();
    expect(await value("select status v from public.orders")).toBe("pending");
    expect(await value("select mp_reconciliation v from public.payments")).toBe(
      "unlinked",
    );
    expect(await value("select reserved v from public.inventory")).toBe(2);
    expect(await value("select on_hand v from public.inventory")).toBe(8);
    expect(
      await value("select count(*)::int v from public.stock_reservations"),
    ).toBe(1);
    expect(
      await value(
        "select count(*)::int v from public.inventory_movements where kind='consume'",
      ),
    ).toBe(0);
    expect(writes).toHaveLength(1);
  },
);

it("local TTL releases an unlinked reservation once despite a contradictory terminal GET; a late explicit approval cannot consume it", async () => {
  providerState = {
    status: "processed",
    status_detail: "accredited",
    total_paid_amount: undefined,
  };
  expect((await handler("checkout")(checkout())).status).toBe(503);
  providerState = {
    status: "canceled",
    status_detail: "accredited",
    total_paid_amount: undefined,
  };
  await db.exec("reset role");
  await due();
  await db.exec("set role service_role");
  expect(await (await handler("worker")(worker())).json()).toMatchObject({
    processed: 0,
    retry: 1,
  });
  expect(diagnostics.at(-1)).toMatchObject({
    dependency: "get",
    validation: "paid_amount",
    validation_detail: "missing",
  });
  expect(await value("select reserved v from public.inventory")).toBe(2);
  expect(await value("select mp_order_id v from public.payments")).toBeNull();
  // Only the disposable fixture clock is advanced. No provider or remote mutation.
  await db.exec(
    "reset role;update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes'",
  );
  expect(
    (await db.query<{ v: number }>("select public.demo_expire_orders() v"))
      .rows[0].v,
  ).toBe(1);
  expect(
    (await db.query<{ v: number }>("select public.demo_expire_orders() v"))
      .rows[0].v,
  ).toBe(0);
  await due();
  await db.exec("set role service_role");
  expect(await (await handler("worker")(worker())).json()).toMatchObject({
    processed: 0,
    retry: 1,
  });
  expect(await value("select status v from public.orders")).toBe("expired");
  expect(await value("select status v from public.stock_reservations")).toBe(
    "expired",
  );
  expect(await value("select reserved v from public.inventory")).toBe(0);
  expect(await value("select on_hand v from public.inventory")).toBe(8);
  expect(
    await value(
      "select count(*)::int v from public.inventory_movements where kind='expire'",
    ),
  ).toBe(1);
  expect(
    await value(
      "select count(*)::int v from public.inventory_movements where kind='consume'",
    ),
  ).toBe(0);
  expect(await value("select mp_order_id v from public.payments")).toBeNull();
  expect(writes).toHaveLength(1);
  // A separate authoritative, explicit financial snapshot goes to review after TTL.
  providerState = {
    status: "processed",
    status_detail: "accredited",
    total_paid_amount: "50001.00",
  };
  await db.exec("reset role");
  await due();
  await db.exec("set role service_role");
  expect(await (await handler("worker")(worker())).json()).toMatchObject({
    processed: 1,
    retry: 0,
  });
  expect(await value("select mp_reconciliation v from public.payments")).toBe(
    "review",
  );
  expect(await value("select status v from public.orders")).toBe("expired");
  expect(await value("select reserved v from public.inventory")).toBe(0);
  expect(await value("select on_hand v from public.inventory")).toBe(8);
  expect(
    await value(
      "select count(*)::int v from public.inventory_movements where kind='consume'",
    ),
  ).toBe(0);
  expect(writes).toHaveLength(1);
});

it("POST created without paid amount links immediately and returns a frontend-valid redirect; repeated creates/recovery do not POST twice", async () => {
  providerState = { total_paid_amount: undefined };
  const response = await handler("checkout")(checkout());
  expect(response.status).toBe(200);
  const data = await response.json();
  const view = paymentView(data, reference);
  expect(view.checkout_url).toBe(
    `https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=${resource}`,
  );
  expect(view.payment_status).toBe("pending");
  expect(await value("select mp_order_id v from public.payments")).toBe(
    resource,
  );
  expect(
    await value("select mp_paid_amount_cents v from public.payments"),
  ).toBeNull();
  expect(await value("select mp_paid_evidence v from public.payments")).toBe(
    "unreported",
  );
  expect((await handler("checkout")(checkout())).status).toBe(200);
  expect((await handler("checkout")(checkout("recover"))).status).toBe(200);
  expect(writes).toHaveLength(1);
  expect(await value("select reserved v from public.inventory")).toBe(2);
  providerState = {
    status: "processed",
    status_detail: "accredited",
    total_paid_amount: "50001.00",
  };
  await handler("webhook")(await webhook());
  await handler("webhook")(await webhook());
  expect(await value("select mp_paid_evidence v from public.payments")).toBe(
    "reported",
  );
  expect(
    await value("select mp_paid_amount_cents::int v from public.payments"),
  ).toBe(5000100);
  expect(await value("select status v from public.orders")).toBe("confirmed");
  expect(
    await value(
      "select count(*)::int v from public.inventory_movements where kind='consume'",
    ),
  ).toBe(1);
});
it("valid POST without URL binds before GET retrieves URL from the same resource; GET without URL preserves it", async () => {
  providerState = { total_paid_amount: undefined };
  postResponse = { checkout_url: undefined };
  const response = await handler("checkout")(checkout());
  expect(response.status).toBe(200);
  expect((await response.json()).checkout_url).toContain(resource);
  expect(writes).toHaveLength(1);
  expect(
    vi
      .mocked(fetcher)
      .mock.calls.some(([url]) =>
        String(url).endsWith(`/v1/orders/${resource}`),
      ),
  ).toBe(true);
  providerState = { total_paid_amount: undefined, checkout_url: undefined };
  const recovered = await handler("checkout")(checkout("recover"));
  expect((await recovered.json()).checkout_url).toContain(resource);
  expect(writes).toHaveLength(1);
});
it("a lost POST response recovers an unreported pending resource by GET without another creation", async () => {
  providerState = { total_paid_amount: undefined };
  loseResponse = true;
  expect((await handler("checkout")(checkout())).status).toBe(503);
  await db.exec("reset role");
  await due();
  await db.exec("set role service_role");
  expect(await (await handler("worker")(worker())).json()).toMatchObject({
    processed: 1,
    retry: 0,
  });
  expect(await value("select mp_order_id v from public.payments")).toBe(
    resource,
  );
  expect(await value("select mp_paid_evidence v from public.payments")).toBe(
    "unreported",
  );
  expect(writes).toHaveLength(1);
});
it("unreported canceled/expired GET closes/releases once and never exposes a checkout URL", async () => {
  providerState = { total_paid_amount: undefined };
  await handler("checkout")(checkout());
  providerState = {
    status: "canceled",
    status_detail: "expired",
    total_paid_amount: undefined,
  };
  for (let i = 0; i < 2; i++) {
    await db.exec("reset role");
    await due();
    await db.exec("set role service_role");
    expect(await (await handler("worker")(worker())).json()).toMatchObject({
      processed: 1,
      retry: 0,
    });
  }
  expect(await value("select status v from public.orders")).toBe("cancelled");
  expect(await value("select mp_reconciliation v from public.payments")).toBe(
    "closed",
  );
  expect(await value("select reserved v from public.inventory")).toBe(0);
  expect(await value("select on_hand v from public.inventory")).toBe(8);
  expect(
    await value(
      "select count(*)::int v from public.inventory_movements where kind='release'",
    ),
  ).toBe(1);
  expect(
    (await (await handler("checkout")(checkout("recover"))).json())
      .checkout_url,
  ).toBeNull();
  expect(writes).toHaveLength(1);
});

it("a reservation expiring during POST cannot expose a redirect or reserve again", async () => {
  providerState = { total_paid_amount: undefined };
  const expireDuringApply: Rpc = async (name, args) => {
    if (name === "mp_test_apply")
      await db.exec(
        "reset role;update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes';set role service_role",
      );
    return rpc(name, args);
  };
  const response = await handler("checkout", {}, expireDuringApply)(checkout());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    order_status: "expired",
    checkout_url: null,
  });
  expect(await value("select reserved v from public.inventory")).toBe(0);
  expect(await value("select on_hand v from public.inventory")).toBe(8);
  expect(writes).toHaveLength(1);
});
it("URL hydration never admits an unsafe GET URL and keeps the same linked resource for recovery", async () => {
  providerState = {
    total_paid_amount: undefined,
    checkout_url: "https://attacker.example/",
  };
  postResponse = { checkout_url: undefined };
  expect((await handler("checkout")(checkout())).status).toBe(503);
  expect(diagnostics.at(-1)).toMatchObject({
    dependency: "get",
    validation: "checkout_url",
  });
  expect(await value("select mp_order_id v from public.payments")).toBe(
    resource,
  );
  providerState = { total_paid_amount: undefined };
  const response = await handler("checkout")(checkout("recover"));
  expect((await response.json()).checkout_url).toContain(resource);
  expect(writes).toHaveLength(1);
});
it("a sparse POST cannot bypass required seller/currency evidence; GET recovery may later validate the complete resource", async () => {
  providerState = { total_paid_amount: undefined };
  postResponse = { currency: undefined };
  expect((await handler("checkout")(checkout())).status).toBe(503);
  expect(diagnostics.at(-1)).toMatchObject({
    dependency: "create",
    validation: "currency",
  });
  expect(await value("select mp_order_id v from public.payments")).toBeNull();
  await db.exec("reset role");
  await due();
  await db.exec("set role service_role");
  expect(await (await handler("worker")(worker())).json()).toMatchObject({
    processed: 1,
    retry: 0,
  });
  expect(await value("select mp_order_id v from public.payments")).toBe(
    resource,
  );
  expect(writes).toHaveLength(1);
});

it("the investigated shape recovers an unlinked locally expired order as closed without reopening stock or returning a URL", async () => {
  providerState = { total_paid_amount: undefined };
  loseResponse = true;
  expect((await handler("checkout")(checkout())).status).toBe(503);
  await db.exec(
    "reset role;update public.orders set created_at=created_at-interval '61 minutes',reservation_expires_at=reservation_expires_at-interval '61 minutes';select public.demo_expire_orders()",
  );
  await due();
  await db.exec("set role service_role");
  providerState = {
    status: "canceled",
    status_detail: "expired",
    total_paid_amount: undefined,
    checkout_url: undefined,
  };
  expect(await (await handler("worker")(worker())).json()).toMatchObject({
    processed: 1,
    retry: 0,
  });
  expect(await value("select mp_order_id v from public.payments")).toBe(
    resource,
  );
  expect(await value("select mp_reconciliation v from public.payments")).toBe(
    "closed",
  );
  expect(
    await value("select mp_paid_amount_cents v from public.payments"),
  ).toBeNull();
  expect(await value("select status v from public.orders")).toBe("expired");
  expect(await value("select reserved v from public.inventory")).toBe(0);
  expect(await value("select on_hand v from public.inventory")).toBe(8);
  expect(
    (await (await handler("checkout")(checkout("recover"))).json())
      .checkout_url,
  ).toBeNull();
  expect(writes).toHaveLength(1);
});

it("the observed created response without detail/money links and redirects; duplicate creates and GET recovery share one order", async () => {
  providerState = { status_detail: undefined, total_paid_amount: undefined };
  const first = await handler("checkout")(checkout());
  expect(first.status).toBe(200);
  const data = paymentView(await first.json(), reference);
  expect(data).toMatchObject({
    payment_status: "pending",
    order_status: "pending",
    checkout_url: `https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=${resource}`,
  });
  await handler("checkout")(checkout());
  expect((await handler("checkout")(checkout("recover"))).status).toBe(200);
  expect(
    await value("select mp_paid_amount_cents v from public.payments"),
  ).toBeNull();
  expect(await value("select mp_paid_evidence v from public.payments")).toBe(
    "unreported",
  );
  expect(await value("select mp_order_id v from public.payments")).toBe(
    resource,
  );
  expect(await value("select count(*)::int v from public.orders")).toBe(1);
  expect(
    await value("select count(*)::int v from public.stock_reservations"),
  ).toBe(1);
  expect(writes).toHaveLength(1);
});
it("lost POST without detail/money recovers by search+GET, then cancellation releases once without approving", async () => {
  providerState = { status_detail: undefined, total_paid_amount: undefined };
  loseResponse = true;
  expect((await handler("checkout")(checkout())).status).toBe(503);
  await db.exec("reset role");
  await due();
  await db.exec("set role service_role");
  expect(await (await handler("worker")(worker())).json()).toMatchObject({
    processed: 1,
    retry: 0,
  });
  expect(await value("select mp_order_id v from public.payments")).toBe(
    resource,
  );
  providerState = {
    status: "processed",
    status_detail: undefined,
    total_paid_amount: "50001.00",
  };
  expect((await handler("checkout")(checkout("recover"))).status).toBe(503);
  expect(diagnostics.at(-1)).toMatchObject({ validation: "status_detail" });
  expect(await value("select status v from public.orders")).toBe("pending");
  providerState = {
    status: "canceled",
    status_detail: "expired",
    total_paid_amount: undefined,
  };
  for (let i = 0; i < 2; i++) {
    await db.exec("reset role");
    await due();
    await db.exec("set role service_role");
    expect(await (await handler("worker")(worker())).json()).toMatchObject({
      processed: 1,
      retry: 0,
    });
  }
  expect(await value("select status v from public.orders")).toBe("cancelled");
  expect(await value("select reserved v from public.inventory")).toBe(0);
  expect(await value("select on_hand v from public.inventory")).toBe(8);
  expect(
    await value(
      "select count(*)::int v from public.inventory_movements where kind='release'",
    ),
  ).toBe(1);
  expect(writes).toHaveLength(1);
});
it("created without detail may later settle only with an explicit accredited detail and exact money", async () => {
  providerState = { status_detail: undefined, total_paid_amount: undefined };
  await handler("checkout")(checkout());
  providerState = {
    status: "processed",
    status_detail: "accredited",
    total_paid_amount: undefined,
  };
  expect((await handler("checkout")(checkout("recover"))).status).toBe(503);
  expect(await value("select reserved v from public.inventory")).toBe(2);
  providerState = {
    status: "processed",
    status_detail: "accredited",
    total_paid_amount: "50001.00",
  };
  await handler("webhook")(await webhook());
  await handler("webhook")(await webhook());
  expect(await value("select status v from public.orders")).toBe("confirmed");
  expect(
    await value(
      "select count(*)::int v from public.inventory_movements where kind='consume'",
    ),
  ).toBe(1);
  expect(writes).toHaveLength(1);
});

it("buyer recovery searches and GETs a lost created response without waiting for worker or issuing another POST", async () => {
  providerState = { status_detail: undefined, total_paid_amount: undefined };
  loseResponse = true;
  expect((await handler("checkout")(checkout())).status).toBe(503);
  expect(await value("select mp_order_id v from public.payments")).toBeNull();
  const indexedOrder = saved;
  saved = null; // Simulate search indexing lag; recovery must never create.
  const absent = await handler("checkout")(checkout("recover"));
  expect((await absent.json()).checkout_url).toBeNull();
  expect(await value("select mp_order_id v from public.payments")).toBeNull();
  expect(writes).toHaveLength(1);
  saved = indexedOrder;
  const response = await handler("checkout")(checkout("recover"));
  expect(response.status).toBe(200);
  expect(paymentView(await response.json(), reference).checkout_url).toContain(
    resource,
  );
  expect(writes).toHaveLength(1);
  expect(
    await value("select count(*)::int v from public.stock_reservations"),
  ).toBe(1);
  expect(await value("select reserved v from public.inventory")).toBe(2);
});
