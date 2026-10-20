// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { makeHandler, type Rpc } from "../functions/demo-orders/handler";
import { createRpc } from "../functions/demo-orders/rpc";
import {
  diagnostic,
  writeDiagnostic,
  type DiagnosticEvent,
  type DiagnosticSink,
} from "../functions/demo-orders/diagnostics";
const settings = {
  origin: "https://shop.example",
  challengeHostname: "shop.example",
  challengeSecret: "SECRET-MUST-NOT-LOG",
  actorSecret: "ACTOR-SECRET-MUST-NOT-LOG-123456789",
};
const key = "10000000-0000-0000-0000-000000000001";
const body = {
  action: "create",
  capability: "a".repeat(64),
  idempotency_key: key,
  challenge: "TOKEN-MUST-NOT-LOG",
  payload: {
    items: [{ variant_id: key, quantity: 1, expected_price_cents: 100 }],
    delivery: "pickup",
    payment: "cash",
  },
};
const privateText = "PRIVATE-RAW-DETAILS customer@example.com 192.0.2.99";
const request = (data = body) =>
  new Request("https://function.example", {
    method: "POST",
    headers: {
      origin: settings.origin,
      "content-type": "application/json",
      "x-forwarded-for": "192.0.2.99",
    },
    body: JSON.stringify(data),
  });
const goodChallenge = () =>
  Response.json({
    success: true,
    hostname: settings.challengeHostname,
    action: "demo-order",
    cdata: privateText,
  });
const rpcMock = () =>
  vi.fn<Rpc>(async (name) => ({
    data:
      name === "demo_order_replay"
        ? null
        : name === "demo_create_order"
          ? { reference: key, demo: true }
          : true,
    error: null,
  }));
const fetchMock = (fn: () => Promise<Response>) => vi.fn(fn) as typeof fetch;
function assertPrivate(events: DiagnosticEvent[], publicBody: unknown) {
  const output = JSON.stringify({ events, publicBody });
  for (const value of [
    body.challenge,
    body.capability,
    key,
    settings.challengeSecret,
    settings.actorSecret,
    settings.origin,
    privateText,
    "192.0.2.99",
    "customer@example.com",
    "RAW-SERVICE-KEY",
  ])
    expect(output).not.toContain(value);
  expect(output).not.toMatch(
    /stack|authorization|idempotency|payload|p_owner|p_actor/,
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each([
  [
    "network failure",
    () => Promise.reject(new TypeError(privateText)),
    "request",
    "network_error",
    undefined,
  ],
  [
    "timeout before headers",
    () => Promise.reject(new DOMException(privateText, "TimeoutError")),
    "request",
    "timeout",
    undefined,
  ],
  [
    "HTTP 502 with private HTML",
    async () => new Response(privateText, { status: 502 }),
    "request",
    "http_error",
    502,
  ],
  [
    "HTTP 429",
    async () => new Response(privateText, { status: 429 }),
    "request",
    "http_error",
    429,
  ],
  [
    "invalid JSON",
    async () => new Response(privateText),
    "body",
    "invalid_json",
    200,
  ],
  [
    "null JSON",
    async () => Response.json(null),
    "body",
    "invalid_response",
    200,
  ],
  [
    "array JSON",
    async () => Response.json([]),
    "body",
    "invalid_response",
    200,
  ],
  [
    "invalid schema",
    async () => Response.json({ success: "true", privateText }),
    "body",
    "invalid_response",
    200,
  ],
  [
    "timeout reading body",
    async () => {
      const response = goodChallenge();
      vi.spyOn(response, "json").mockRejectedValue(
        new DOMException(privateText, "AbortError"),
      );
      return response;
    },
    "body",
    "timeout",
    200,
  ],
  [
    "network failure reading body",
    async () => {
      const response = goodChallenge();
      vi.spyOn(response, "json").mockRejectedValue(new TypeError(privateText));
      return response;
    },
    "body",
    "network_error",
    200,
  ],
] as const)(
  "Siteverify %s has a precise safe diagnostic and never creates",
  async (_name, fetcher, phase, outcome, status) => {
    const events: DiagnosticEvent[] = [],
      rpc = rpcMock();
    const response = await makeHandler(settings, rpc, fetchMock(fetcher), (e) =>
      events.push(e),
    )(request());
    expect(response.status).toBe(503);
    const publicBody = await response.json();
    expect(publicBody).toEqual({ error: "CHALLENGE_UNAVAILABLE" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "demo_orders_diagnostic",
      version: 1,
      http_status: 503,
      duration_ms: expect.any(Number),
    });
    expect(events[0].steps.at(-1)).toMatchObject({
      operation: "siteverify",
      phase,
      outcome,
    });
    expect(events[0].steps.at(-1)?.upstream_status).toBe(status);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      "demo_rate_limit",
      "demo_order_replay",
    ]);
    assertPrivate(events, publicBody);
  },
);
it.each([
  ["internal-error", 503, "CHALLENGE_UNAVAILABLE"],
  ["invalid-input-secret", 503, "CHALLENGE_CONFIG"],
  ["timeout-or-duplicate", 403, "CHALLENGE_EXPIRED"],
  ["invalid-input-response", 403, "CHALLENGE_REJECTED"],
  [privateText, 403, "CHALLENGE_REJECTED"],
] as const)(
  "provider rejection %s logs only an allowlisted reason",
  async (code, status, error) => {
    const events: DiagnosticEvent[] = [],
      rpc = rpcMock();
    const response = await makeHandler(
      settings,
      rpc,
      fetchMock(async () =>
        Response.json({ success: false, "error-codes": [code], privateText }),
      ),
      (e) => events.push(e),
    )(request());
    expect(response.status).toBe(status);
    const publicBody = await response.json();
    expect(publicBody).toEqual({ error });
    expect(events[0].steps.at(-1)).toMatchObject({
      operation: "siteverify",
      phase: "validation",
      outcome: "rejected",
      reason: code === privateText ? "other" : code,
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    assertPrivate(events, publicBody);
  },
);
it.each(["hostname", "action"] as const)(
  "context rejection reports %s mismatch without actual values",
  async (field) => {
    const events: DiagnosticEvent[] = [],
      rpc = rpcMock();
    const response = await makeHandler(
      settings,
      rpc,
      fetchMock(async () =>
        Response.json({
          success: true,
          hostname: settings.challengeHostname,
          action: "demo-order",
          [field]: privateText,
        }),
      ),
      (e) => events.push(e),
    )(request());
    expect(response.status).toBe(403);
    const publicBody = await response.json();
    expect(publicBody).toEqual({ error: "CHALLENGE_CONTEXT" });
    expect(events[0].steps.at(-1)?.reason).toBe(`${field}_mismatch`);
    expect(rpc).toHaveBeenCalledTimes(2);
    assertPrivate(events, publicBody);
  },
);
it.each([
  "demo_rate_limit",
  "demo_order_replay",
  "demo_admit_creation",
  "demo_create_order",
  "demo_cancel_order",
] as const)(
  "identifies RPC %s failure and filters PostgREST details",
  async (operation) => {
    const events: DiagnosticEvent[] = [],
      calls: string[] = [];
    const transport = fetchMock(async () =>
      Response.json(
        {
          message: privateText,
          details: privateText,
          hint: privateText,
          code: "42501",
        },
        { status: 403 },
      ),
    );
    const realRpc = createRpc(
      "https://fixture.example",
      "RAW-SERVICE-KEY",
      transport,
    );
    const fallback = rpcMock();
    const rpc: Rpc = async (name, args) => {
      calls.push(name);
      return name === operation ? realRpc(name, args) : fallback(name, args);
    };
    const response = await makeHandler(
      settings,
      rpc,
      fetchMock(async () => goodChallenge()),
      (e) => events.push(e),
    )(
      operation === "demo_cancel_order"
        ? request({
            action: "cancel",
            capability: body.capability,
            reference: key,
          } as unknown as typeof body)
        : request(),
    );
    expect(response.status).toBe(operation === "demo_cancel_order" ? 404 : 503);
    const publicBody = await response.json();
    expect(events[0].steps.at(-1)).toMatchObject({
      operation,
      phase: "result",
      outcome: "rpc_error",
      upstream_status: 403,
      reason: "42501",
    });
    expect(calls.at(-1)).toBe(operation);
    assertPrivate(events, publicBody);
  },
);
it.each([
  [
    () => Promise.reject(new TypeError(privateText)),
    "request",
    "network_error",
    undefined,
  ],
  [
    () => Promise.reject(new DOMException(privateText, "TimeoutError")),
    "request",
    "timeout",
    undefined,
  ],
  [async () => new Response(privateText), "body", "invalid_json", 200],
  [
    async () => new Response(privateText, { status: 502 }),
    "body",
    "invalid_json",
    502,
  ],
] as const)(
  "RPC transport exceptions are attributed without raw errors %#",
  async (fn, phase, outcome, status) => {
    const events: DiagnosticEvent[] = [];
    const response = await makeHandler(
      settings,
      createRpc("https://fixture.example", "RAW-SERVICE-KEY", fetchMock(fn)),
      fetchMock(async () => goodChallenge()),
      (e) => events.push(e),
    )(request());
    expect(response.status).toBe(503);
    const publicBody = await response.json();
    expect(events[0].steps).toHaveLength(1);
    expect(events[0].steps[0]).toMatchObject({
      operation: "demo_rate_limit",
      phase,
      outcome,
    });
    expect(events[0].steps[0].upstream_status).toBe(status);
    assertPrivate(events, publicBody);
  },
);
it("preserves business errors, authenticates RPC normally, and discards unknown error codes", async () => {
  const fetcher = fetchMock(async () =>
    Response.json(
      {
        message: `INSUFFICIENT_STOCK ${privateText}`,
        code: privateText,
        details: privateText,
      },
      { status: 409 },
    ),
  );
  const result = await createRpc(
    "https://fixture.example",
    "RAW-SERVICE-KEY",
    fetcher,
  )("demo_create_order", { p_key: key });
  expect(result).toEqual({
    data: null,
    error: {
      message: "INSUFFICIENT_STOCK",
      diagnostic: { status: 409, code: "other" },
    },
  });
  const [url, init] = vi.mocked(fetcher).mock.calls[0];
  expect(url).toBe("https://fixture.example/rest/v1/rpc/demo_create_order");
  expect(init?.headers).toMatchObject({
    Authorization: "Bearer RAW-SERVICE-KEY",
    apikey: "RAW-SERVICE-KEY",
  });
  expect(JSON.stringify(result)).not.toContain(privateText);
});
it("logs success once, keeps Siteverify form encoding and skips it entirely on recovery", async () => {
  const events: DiagnosticEvent[] = [],
    fetcher = fetchMock(async () => goodChallenge());
  const handler = makeHandler(settings, rpcMock(), fetcher, (e) =>
    events.push(e),
  );
  expect((await handler(request())).status).toBe(200);
  expect(events[0].steps.map((s) => s.operation)).toEqual([
    "demo_rate_limit",
    "demo_order_replay",
    "siteverify",
    "siteverify",
    "siteverify",
    "demo_admit_creation",
    "demo_create_order",
  ]);
  expect(
    events[0].steps.every((s) => s.outcome === "ok" && s.duration_ms >= 0),
  ).toBe(true);
  const [url, init] = vi.mocked(fetcher).mock.calls[0];
  expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
  expect(init?.headers).toEqual({
    "Content-Type": "application/x-www-form-urlencoded",
  });
  expect((init?.body as URLSearchParams).get("response")).toBe(body.challenge);
  expect((init?.body as URLSearchParams).get("secret")).toBe(
    settings.challengeSecret,
  );
  const { challenge: _ignored, ...rest } = body;
  void _ignored;
  const response = await handler(
    request({ ...rest, action: "recover" } as typeof body),
  );
  expect(await response.json()).toEqual({ found: false });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(events[1].steps.map((s) => s.operation)).toEqual([
    "demo_rate_limit",
    "demo_order_replay",
  ]);
  assertPrivate(events, null);
});
it("diagnostic output is JSON, sanitizes reasons and cannot change a committed result when logging fails", async () => {
  const spy = vi.spyOn(console, "info").mockImplementation(() => {});
  const collector = diagnostic(writeDiagnostic);
  collector.record(
    "siteverify",
    "validation",
    "rejected",
    performance.now(),
    undefined,
    privateText,
  );
  collector.finish(403);
  expect(spy).toHaveBeenCalledOnce();
  const event = JSON.parse(spy.mock.calls[0][0]);
  expect(event.steps[0].reason).toBe("other");
  assertPrivate([event], null);
  const rpc = rpcMock(),
    sink: DiagnosticSink = () => {
      throw new Error(privateText);
    };
  const response = await makeHandler(
    settings,
    rpc,
    fetchMock(async () => goodChallenge()),
    sink,
  )(request());
  expect(response.status).toBe(200);
  expect(
    rpc.mock.calls.filter((c) => c[0] === "demo_create_order"),
  ).toHaveLength(1);
});
it("an unexpected RPC exception is safely identified without leaking stack or causing another call", async () => {
  const events: DiagnosticEvent[] = [],
    rpc = vi.fn<Rpc>(async () => {
      throw new Error(privateText);
    });
  const response = await makeHandler(
    settings,
    rpc,
    fetchMock(async () => goodChallenge()),
    (e) => events.push(e),
  )(request());
  expect(response.status).toBe(503);
  const publicBody = await response.json();
  expect(events[0].steps[0]).toMatchObject({
    operation: "demo_rate_limit",
    outcome: "unexpected_error",
  });
  expect(rpc).toHaveBeenCalledOnce();
  assertPrivate(events, publicBody);
});

it.each([8000, 15000])(
  "recognizes an aborted %i ms dependency even when fetch throws TypeError",
  async (ms) => {
    const events: DiagnosticEvent[] = [];
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(
        AbortSignal.abort(new DOMException(privateText, "TimeoutError")),
      );
    const unavailable = fetchMock(async () => {
      throw new TypeError(privateText);
    });
    const rpc =
      ms === 15000
        ? createRpc("https://fixture.example", "RAW-SERVICE-KEY", unavailable)
        : rpcMock();
    const response = await makeHandler(settings, rpc, unavailable, (e) =>
      events.push(e),
    )(request());
    expect(response.status).toBe(503);
    expect(timeout).toHaveBeenCalledWith(ms);
    expect(events[0].steps.at(-1)).toMatchObject({
      operation: ms === 8000 ? "siteverify" : "demo_rate_limit",
      phase: "request",
      outcome: "timeout",
    });
    assertPrivate(events, await response.json());
  },
);
it("the real Edge entrypoint wires sanitized RPC and JSON logging without environment or body dumps", async () => {
  vi.resetModules();
  const serve = vi.fn();
  const env: Record<string, string> = {
    SUPABASE_URL: "https://fixture.example",
    SUPABASE_SERVICE_ROLE_KEY: "RAW-SERVICE-KEY",
    DEMO_ALLOWED_ORIGIN: settings.origin,
    DEMO_CHALLENGE_HOSTNAME: settings.challengeHostname,
    DEMO_ACTOR_SECRET: settings.actorSecret,
    TURNSTILE_SECRET_KEY: settings.challengeSecret,
  };
  vi.stubGlobal("Deno", { env: { get: (name: string) => env[name] }, serve });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (input === "https://fixture.example/rest/v1/rpc/demo_rate_limit")
        return Response.json(true);
      if (input === "https://fixture.example/rest/v1/rpc/demo_order_replay")
        return Response.json(null);
      if (input === "https://challenges.cloudflare.com/turnstile/v0/siteverify")
        return new Response(privateText, { status: 502 });
      throw new Error(privateText);
    }),
  );
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  await import("../functions/demo-orders/index");
  expect(serve).toHaveBeenCalledOnce();
  const handler = serve.mock.calls[0][0] as (
    request: Request,
  ) => Promise<Response>;
  const response = await handler(request());
  expect(response.status).toBe(503);
  expect(info).toHaveBeenCalledOnce();
  const event = JSON.parse(info.mock.calls[0][0]);
  expect(event.steps.at(-1)).toMatchObject({
    operation: "siteverify",
    phase: "request",
    outcome: "http_error",
    upstream_status: 502,
  });
  assertPrivate([event], await response.json());
});

it.each([
  ["missing-input-secret", 503, "CHALLENGE_CONFIG"],
  ["invalid-input-secret", 503, "CHALLENGE_CONFIG"],
  ["missing-input-response", 403, "CHALLENGE_REJECTED"],
  ["invalid-input-response", 403, "CHALLENGE_REJECTED"],
  ["timeout-or-duplicate", 403, "CHALLENGE_EXPIRED"],
  ["bad-request", 403, "CHALLENGE_REJECTED"],
  ["internal-error", 503, "CHALLENGE_UNAVAILABLE"],
  [privateText, 503, "CHALLENGE_UNAVAILABLE"],
] as const)(
  "HTTP 400 validation JSON classifies %s without disclosing its body",
  async (code, status, error) => {
    const events: DiagnosticEvent[] = [],
      rpc = rpcMock();
    const response = await makeHandler(
      settings,
      rpc,
      fetchMock(async () =>
        Response.json(
          {
            success: false,
            "error-codes": [code],
            secret: settings.challengeSecret,
            response: body.challenge,
            details: privateText,
          },
          { status: 400 },
        ),
      ),
      (e) => events.push(e),
    )(request());
    expect(response.status).toBe(status);
    const publicBody = await response.json();
    expect(publicBody).toEqual({ error });
    expect(events[0].steps).toContainEqual(
      expect.objectContaining({
        operation: "siteverify",
        phase: "request",
        outcome: "http_error",
        upstream_status: 400,
      }),
    );
    expect(events[0].steps.at(-1)).toMatchObject({
      operation: "siteverify",
      phase: "validation",
      outcome: "rejected",
      upstream_status: 400,
      reason: code === privateText ? "other" : code,
    });
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      "demo_rate_limit",
      "demo_order_replay",
    ]);
    assertPrivate(events, publicBody);
  },
);
it.each([
  ["HTML", () => new Response(privateText, { status: 400 }), "invalid_json"],
  ["null", () => Response.json(null, { status: 400 }), "invalid_response"],
  [
    "invalid structure",
    () =>
      Response.json(
        { "error-codes": ["invalid-input-secret"], details: privateText },
        { status: 400 },
      ),
    "invalid_response",
  ],
  [
    "success on HTTP error",
    () =>
      Response.json(
        {
          success: true,
          hostname: settings.challengeHostname,
          action: "demo-order",
        },
        { status: 400 },
      ),
    "http_error",
  ],
] as const)(
  "HTTP 400 %s never authorizes creation or invents a validation result",
  async (_name, fixture, outcome) => {
    const events: DiagnosticEvent[] = [],
      rpc = rpcMock();
    const response = await makeHandler(
      settings,
      rpc,
      fetchMock(async () => fixture()),
      (e) => events.push(e),
    )(request());
    expect(response.status).toBe(503);
    const publicBody = await response.json();
    expect(publicBody).toEqual({ error: "CHALLENGE_UNAVAILABLE" });
    expect(events[0].steps.at(-1)).toMatchObject({
      operation: "siteverify",
      outcome,
      upstream_status: 400,
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    assertPrivate(events, publicBody);
  },
);
it("URLSearchParams serializes the exact two fields safely, including reserved characters, without extra headers", async () => {
  const secret = "test +/=&%? ñ",
    token = "token +/=&%? é";
  const fetcher: typeof fetch = vi.fn(async (input, init) => {
    const wire = new Request(input, init);
    expect(wire.method).toBe("POST");
    expect(wire.url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    expect(wire.headers.get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(wire.headers.has("authorization")).toBe(false);
    expect(wire.headers.has("apikey")).toBe(false);
    const form = await wire.formData();
    expect([...form.keys()].sort()).toEqual(["response", "secret"]);
    expect(form.get("secret")).toBe(secret);
    expect(form.get("response")).toBe(token);
    return goodChallenge();
  });
  const response = await makeHandler(
    { ...settings, challengeSecret: secret },
    rpcMock(),
    fetcher,
  )(request({ ...body, challenge: token }));
  expect(response.status).toBe(200);
  expect(fetcher).toHaveBeenCalledOnce();
});
