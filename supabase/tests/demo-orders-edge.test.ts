// @vitest-environment node
import { expect, it, vi } from "vitest";
import { makeHandler, type Rpc } from "../functions/demo-orders/handler";
const config = {
  origin: "https://vanta.example",
  challengeSecret: "local-test-secret",
  challengeHostname: "vanta.example",
  actorSecret: "x".repeat(32),
};
const key = "10000000-0000-0000-0000-000000000001";
const body = () => ({
  action: "create",
  capability: "a".repeat(64),
  idempotency_key: key,
  challenge: "test-token",
  payload: {
    items: [{ variant_id: key, quantity: 2, expected_price_cents: 2500050 }],
    delivery: "pickup",
    payment: "cash",
  },
});
const request = (data: unknown = body(), origin = config.origin) =>
  new Request("https://edge.example", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(data),
  });
const challenge = () =>
  vi.fn(async () =>
    Response.json({
      success: true,
      hostname: config.challengeHostname,
      action: "demo-order",
    }),
  ) as unknown as typeof fetch;
function rpcMock() {
  return vi.fn<Rpc>(async (name) => ({
    data: ["demo_rate_limit", "demo_admit_creation"].includes(name)
      ? true
      : name === "demo_order_replay"
        ? null
        : { reference: key, demo: true },
    error: null,
  }));
}
it("fails closed without settings; enforces origin, method, content type and bounded body", async () => {
  const rpc = rpcMock();
  expect(
    (await makeHandler({ ...config, challengeSecret: "" }, rpc)(request()))
      .status,
  ).toBe(503);
  const handler = makeHandler(config, rpc);
  expect((await handler(request(body(), "https://evil.example"))).status).toBe(
    403,
  );
  expect(
    (
      await handler(
        new Request("https://edge.example", {
          headers: { origin: config.origin },
        }),
      )
    ).status,
  ).toBe(405);
  expect(
    (
      await handler(
        new Request("https://edge.example", {
          method: "POST",
          headers: { origin: config.origin },
          body: "{}",
        }),
      )
    ).status,
  ).toBe(415);
  expect((await handler(request({ data: "x".repeat(9000) }))).status).toBe(413);
  expect(rpc).not.toHaveBeenCalled();
});
it("challenge verification, limits and minimal RPC payload precede creation; no PII or client totals", async () => {
  const rpc = rpcMock(),
    fetcher = challenge();
  const res = await makeHandler(config, rpc, fetcher)(request());
  expect(res.status).toBe(200);
  expect(rpc.mock.calls.map((c) => c[0])).toEqual([
    "demo_rate_limit",
    "demo_order_replay",
    "demo_admit_creation",
    "demo_create_order",
  ]);
  const args = rpc.mock.calls[3][1];
  expect(Object.keys(args).sort()).toEqual(["p_key", "p_owner", "p_payload"]);
  expect(args.p_owner).not.toBe(body().capability);
  expect(args.p_owner).toMatch(/^[a-f0-9]{64}$/);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(JSON.stringify(args)).not.toMatch(/email|phone|address|first_name/);
});
it("rejects tampered data, duplicated variants, bad quantities or real buyer fields", async () => {
  for (const alter of [
    (b: ReturnType<typeof body>) => ({
      ...b,
      payload: { ...b.payload, email: "real@example.com" },
    }),
    (b: ReturnType<typeof body>) => ({
      ...b,
      payload: {
        ...b.payload,
        items: [...b.payload.items, ...b.payload.items],
      },
    }),
    (b: ReturnType<typeof body>) => ({
      ...b,
      payload: {
        ...b.payload,
        items: [{ ...b.payload.items[0], quantity: 100 }],
      },
    }),
  ]) {
    const rpc = rpcMock();
    expect(
      (await makeHandler(config, rpc, challenge())(request(alter(body()))))
        .status,
    ).toBe(400);
    expect(rpc.mock.calls.some((c) => c[0] === "demo_create_order")).toBe(
      false,
    );
  }
});
it("requires genuine challenge hostname/action; fails closed on provider timeout", async () => {
  for (const result of [
    { success: false },
    { success: true, hostname: "evil.example", action: "demo-order" },
    { success: true, hostname: config.challengeHostname, action: "other" },
  ]) {
    const rpc = rpcMock();
    const res = await makeHandler(
      config,
      rpc,
      vi.fn(async () => Response.json(result)) as typeof fetch,
    )(request());
    expect(res.status).toBe(403);
    expect(rpc.mock.calls.some((c) => c[0] === "demo_create_order")).toBe(
      false,
    );
  }
  const rpc = rpcMock();
  expect(
    (
      await makeHandler(
        config,
        rpc,
        vi.fn(async () => {
          throw Error("timeout");
        }) as typeof fetch,
      )(request())
    ).status,
  ).toBe(503);
});
it("durable limiter blocks before challenge; global protection independent of spoofed IP", async () => {
  const rpc = vi.fn<Rpc>(async () => ({ data: false, error: null })),
    fetcher = challenge();
  expect((await makeHandler(config, rpc, fetcher)(request())).status).toBe(429);
  expect(fetcher).not.toHaveBeenCalled();
});
it("replay retrieves only authenticated minimal receipt without re-consuming a challenge", async () => {
  const rpc = rpcMock();
  rpc.mockImplementation(async (name) => ({
    data: ["demo_rate_limit", "demo_admit_creation"].includes(name)
      ? true
      : { reference: key, status: "pending" },
    error: null,
  }));
  const fetcher = challenge();
  expect(
    (
      await makeHandler(
        config,
        rpc,
        fetcher,
      )(request({ ...body(), challenge: "" }))
    ).status,
  ).toBe(200);
  expect(fetcher).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledTimes(2);
});
it("does not expose raw SQL errors, logs or false success", async () => {
  const rpc = rpcMock();
  rpc.mockImplementation(async (name) =>
    name === "demo_create_order"
      ? { data: null, error: { message: "internal private details" } }
      : {
          data: ["demo_rate_limit", "demo_admit_creation"].includes(name),
          error: null,
        },
  );
  const r = await makeHandler(config, rpc, challenge())(request());
  expect(r.status).toBe(503);
  expect(await r.json()).toEqual({ error: "UNAVAILABLE" });
});
it("cancellation requires capability and reference; has no public lookup operation", async () => {
  const rpc = rpcMock();
  const handler = makeHandler(config, rpc, challenge());
  expect(
    (
      await handler(
        request({
          action: "lookup",
          reference: key,
          capability: "a".repeat(64),
        }),
      )
    ).status,
  ).toBe(400);
  const response = await handler(
    request({ action: "cancel", reference: key, capability: "a".repeat(64) }),
  );
  expect(response.status).toBe(200);
  expect(rpc.mock.calls.at(-1)?.[0]).toBe("demo_cancel_order");
});
it("invalid JSON returns 400 and a failed challenge does not consume global creation budget", async () => {
  const rpc = rpcMock(),
    handler = makeHandler(
      config,
      rpc,
      vi.fn(async () => Response.json({ success: false })) as typeof fetch,
    );
  expect(
    (
      await handler(
        new Request("https://edge.example", {
          method: "POST",
          headers: {
            origin: config.origin,
            "content-type": "application/json",
          },
          body: "{",
        }),
      )
    ).status,
  ).toBe(400);
  expect((await handler(request())).status).toBe(403);
  expect(rpc.mock.calls.some((c) => c[0] === "demo_admit_creation")).toBe(
    false,
  );
});
it("replay infrastructure failures remain retryable, not false idempotency conflicts", async () => {
  const rpc = rpcMock();
  rpc.mockImplementation(async (name) => ({
    data: name === "demo_rate_limit" ? true : null,
    error:
      name === "demo_order_replay"
        ? { message: "permission denied / internal details" }
        : null,
  }));
  const response = await makeHandler(config, rpc, challenge())(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "UNAVAILABLE" });
  expect(rpc.mock.calls.some((c) => c[0] === "demo_create_order")).toBe(false);
});
it("rejects array-valued delivery and payment instead of coercing them to strings", async () => {
  for (const payload of [
    { ...body().payload, delivery: ["pickup"] },
    { ...body().payload, payment: ["transfer"] },
  ]) {
    const rpc = rpcMock();
    expect(
      (
        await makeHandler(
          config,
          rpc,
          challenge(),
        )(request({ ...body(), payload }))
      ).status,
    ).toBe(400);
    expect(rpc.mock.calls.some((c) => c[0] === "demo_admit_creation")).toBe(
      false,
    );
  }
});
it("invalid origin/hostname configuration fails closed before RPC or challenge verification", async () => {
  for (const settings of [
    { ...config, challengeHostname: "other.example" },
    { ...config, origin: "https://vanta.example/path" },
    { ...config, origin: "http://vanta.example" },
  ]) {
    const rpc = rpcMock(),
      fetcher = challenge();
    expect((await makeHandler(settings, rpc, fetcher)(request())).status).toBe(
      503,
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  }
});
it("recovery miss only queries replay: no challenge validation, admission or creation", async () => {
  const rpc = rpcMock(),
    fetcher = challenge();
  const { challenge: _ignored, ...rest } = body();
  void _ignored;
  const response = await makeHandler(
    config,
    rpc,
    fetcher,
  )(request({ ...rest, action: "recover" }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ found: false });
  expect(rpc.mock.calls.map((c) => c[0])).toEqual([
    "demo_rate_limit",
    "demo_order_replay",
  ]);
  expect(fetcher).not.toHaveBeenCalled();
});
it("missing, consumed, rejected and misconfigured challenges have safe distinct codes and never reserve", async () => {
  const cases: [string, unknown, string, number][] = [
    ["", null, "CHALLENGE_REQUIRED", 403],
    [
      "used",
      { success: false, "error-codes": ["timeout-or-duplicate"] },
      "CHALLENGE_EXPIRED",
      403,
    ],
    [
      "bad",
      { success: false, "error-codes": ["invalid-input-response"] },
      "CHALLENGE_REJECTED",
      403,
    ],
    [
      "token",
      { success: false, "error-codes": ["invalid-input-secret"] },
      "CHALLENGE_CONFIG",
      503,
    ],
    [
      "token",
      { success: true, hostname: "other.example", action: "demo-order" },
      "CHALLENGE_CONTEXT",
      403,
    ],
  ];
  for (const [token, data, error, status] of cases) {
    const rpc = rpcMock(),
      fetcher = vi.fn(async () => Response.json(data)) as typeof fetch;
    const res = await makeHandler(
      config,
      rpc,
      fetcher,
    )(request({ ...body(), challenge: token }));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
    expect(
      rpc.mock.calls.some((c) =>
        ["demo_admit_creation", "demo_create_order"].includes(c[0]),
      ),
    ).toBe(false);
    if (!token) expect(fetcher).not.toHaveBeenCalled();
  }
});
it("lost response then recovery/retry return the same order without another challenge or reservation", async () => {
  let saved: unknown = null,
    creates = 0;
  const rpc = vi.fn<Rpc>(async (name) => {
    if (name === "demo_order_replay") return { data: saved, error: null };
    if (name === "demo_create_order") {
      creates++;
      saved = { reference: key, status: "pending" };
      return { data: saved, error: null };
    }
    return { data: true, error: null };
  });
  const fetcher = challenge(),
    handler = makeHandler(config, rpc, fetcher);
  await handler(request());
  const { challenge: _ignored, ...rest } = body();
  void _ignored;
  const recovered = await handler(request({ ...rest, action: "recover" }));
  expect(await recovered.json()).toEqual(saved);
  const retried = await handler(
    request({ ...body(), challenge: "already-used" }),
  );
  expect(await retried.json()).toEqual(saved);
  expect(creates).toBe(1);
  expect(fetcher).toHaveBeenCalledOnce();
});
