// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  makeEmailWorker,
  createEmailRpc,
} from "../functions/_shared/demo-email/worker";
import { encryptionKey, unseal } from "../functions/_shared/demo-email/privacy";
import { createEmailDb, emailSettings, recipient } from "./email-fixture";
let f: Awaited<ReturnType<typeof createEmailDb>>;
const providerId = randomUUID();
function request(secret = emailSettings.workerSecret, body: unknown = {}) {
  return new Request("https://edge.example/functions/v1/demo-email-worker", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  });
}
function worker(
  fetcher: typeof fetch,
  sink = vi.fn(),
  rpc = f.rpc,
  settings = emailSettings,
) {
  return makeEmailWorker(settings, rpc, fetcher, sink, async () => {});
}
async function due() {
  await f.db.exec(
    "update public.demo_email_outbox set next_attempt_at=clock_timestamp()-interval '1 second',next_poll_at=clock_timestamp()-interval '1 second',lease_until=null;",
  );
}
const result = () =>
  f.db
    .query(
      "select state,error_code,send_attempts,provider_id,delivery from public.demo_email_outbox order by created_at",
    )
    .then((r) => r.rows);
beforeAll(async () => {
  f = await createEmailDb();
}, 30000);
afterAll(async () => f.db.close());
beforeEach(async () => f.reset());
it("private worker rejects browser sessions, unknown actions and large bodies before SQL/provider access", async () => {
  const fetcher = vi.fn(),
    rpc = vi.fn(),
    run = worker(fetcher, vi.fn(), rpc);
  expect((await run(request("sb_publishable_fixture"))).status).toBe(403);
  expect(
    (await run(request(emailSettings.workerSecret, { email: recipient })))
      .status,
  ).toBe(400);
  expect(
    (await run(request(emailSettings.workerSecret, { x: "x".repeat(200) })))
      .status,
  ).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
it("disabled worker only maintains retention; SQL-disabled worker sends nothing even if Edge is enabled", async () => {
  await f.order("transfer");
  const fetcher = vi.fn();
  expect(
    await (
      await worker(fetcher, vi.fn(), f.rpc, {
        ...emailSettings,
        enabled: false,
      })(request())
    ).json(),
  ).toMatchObject({ disabled: true });
  await f.db.exec("update public.demo_email_config set enabled=false");
  expect(await (await worker(fetcher)(request())).json()).toMatchObject({
    processed: 0,
  });
  expect(fetcher).not.toHaveBeenCalled();
});
it("malformed mode, encryption or allowlist fails closed before claiming/sending", async () => {
  for (const settings of [
    { ...emailSettings, mode: "production" },
    { ...emailSettings, allowed: "[]" },
    { ...emailSettings, encryption: "invalid" },
  ]) {
    const rpc = vi.fn(),
      fetcher = vi.fn();
    expect(
      (await worker(fetcher, vi.fn(), rpc, settings)(request())).status,
    ).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  }
});
it("real SQL + simulated Resend: sends server snapshot to authorized buyer and stores acceptance separately from delivery", async () => {
  await f.order("transfer");
  const fetcher = vi.fn().mockResolvedValue(Response.json({ id: providerId }));
  const stock = (
    await f.db.query("select on_hand,reserved from public.inventory")
  ).rows;
  expect(await (await worker(fetcher)(request())).json()).toMatchObject({
    processed: 1,
    retry: 0,
  });
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe("https://api.resend.com/emails");
  const body = JSON.parse(options.body);
  expect(body.to).toEqual([recipient]);
  expect(body.from).toBe("VANTA Demo <onboarding@resend.dev>");
  expect(body.subject).toContain("Recibimos tu pedido");
  expect(body.html).toContain("50.001");
  expect(options.redirect).toBe("error");
  expect(options.headers["Idempotency-Key"]).toMatch(
    /^vanta-demo\/[a-f0-9-]{36}$/,
  );
  const data = await result();
  expect(data[0]).toMatchObject({
    state: "accepted",
    provider_id: providerId,
    delivery: "unknown",
  });
  const stored = (await f.db.query("select * from public.demo_email_outbox"))
    .rows[0];
  expect(JSON.stringify(stored)).not.toContain(recipient);
  expect(
    (await f.db.query("select on_hand,reserved from public.inventory")).rows,
  ).toEqual(stock);
});
it("lost provider response retries the exact encrypted/frozen body and key across worker deployments without duplicate mail", async () => {
  await f.order("transfer");
  const bodies: string[] = [],
    keys: string[] = [];
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, options?: RequestInit) => {
      bodies.push(String(options?.body));
      keys.push(
        (options?.headers as Record<string, string>)["Idempotency-Key"],
      );
      if (bodies.length === 1)
        throw new Error("secret provider response with buyer data");
      return Response.json({ id: providerId });
    },
  );
  await worker(fetcher)(request());
  await due();
  // A different sender setting must not regenerate an uncertain request.
  await worker(fetcher, vi.fn(), f.rpc, {
    ...emailSettings,
    from: "new@example.test",
  })(request());
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(keys[1]).toBe(keys[0]);
  expect((await result())[0]).toMatchObject({
    state: "accepted",
    send_attempts: 2,
  });
  await worker(fetcher)(request());
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("an HTTP-accepted response whose DB acknowledgement is lost recovers the original provider ID with the same key", async () => {
  await f.order("transfer");
  let fail = true;
  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (name === "demo_email_result" && args.p_outcome === "accepted" && fail) {
      fail = false;
      throw Error("DB down");
    }
    return f.rpc(name, args);
  };
  const fetcher = vi
    .fn()
    .mockImplementation(async () => Response.json({ id: providerId }));
  await worker(fetcher, vi.fn(), rpc)(request());
  expect((await result())[0].state).toBe("queued");
  await due();
  await worker(fetcher)(request());
  expect((await result())[0].provider_id).toBe(providerId);
  expect(fetcher.mock.calls[0][1].headers["Idempotency-Key"]).toBe(
    fetcher.mock.calls[1][1].headers["Idempotency-Key"],
  );
});
it.each([
  [500, { message: "private" }, "HTTP_RETRY", "queued"],
  [429, { name: "rate_limit_exceeded" }, "HTTP_RETRY", "queued"],
  [409, { name: "concurrent_idempotent_requests" }, "HTTP_RETRY", "queued"],
  [
    409,
    { name: "invalid_idempotent_request" },
    "IDEMPOTENCY_CONFLICT",
    "failed",
  ],
  [401, { message: "secret" }, "PROVIDER_AUTH", "failed"],
  [403, { message: "own address only" }, "PROVIDER_AUTH", "failed"],
  [422, { message: "bad address" }, "PROVIDER_REJECTED", "failed"],
] as const)(
  "provider HTTP %s classified without exposing bodies",
  async (status, body, code, state) => {
    await f.order("transfer");
    const sink = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json(body, { status, headers: { "Retry-After": "3600" } }),
      );
    await worker(fetcher, sink)(request());
    expect((await result())[0]).toMatchObject({ state, error_code: code });
    const diagnostics = JSON.stringify(sink.mock.calls);
    expect(diagnostics).not.toContain(recipient);
    expect(diagnostics).not.toContain(emailSettings.token);
    expect(diagnostics).not.toContain("private");
    if (status === 429)
      expect(
        await f.scalar(
          "select next_attempt_at>=clock_timestamp()+interval '59 minutes' v from public.demo_email_outbox",
        ),
      ).toBe(true);
  },
);
it("bad JSON, malformed success, redirects, response size and timeout stay uncertain without marking delivery or affecting stock", async () => {
  for (const response of [
    new Response("invalid JSON"),
    Response.json({ id: "spoof" }),
    new Response("x".repeat(140000)),
    new Response("moved", { status: 302 }),
  ]) {
    await f.reset();
    await f.order("transfer");
    await worker(vi.fn().mockResolvedValue(response))(request());
    expect((await result())[0].provider_id).toBeNull();
    expect((await result())[0].delivery).toBe("unknown");
  }
  await f.reset();
  await f.order("transfer");
  await worker(
    vi.fn().mockRejectedValue(new DOMException("private", "TimeoutError")),
  )(request());
  expect((await result())[0].error_code).toBe("TIMEOUT");
  expect(
    (await f.db.query("select on_hand,reserved from public.inventory")).rows[0],
  ).toEqual({ on_hand: 8, reserved: 2 });
});
it("delivery GET verifies known provider ID/recipient/from; accepted rows never trigger another POST", async () => {
  await f.order("transfer");
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ id: providerId }));
  await worker(fetcher)(request());
  await due();
  const original = JSON.parse(fetcher.mock.calls[0][1].body);
  fetcher.mockResolvedValueOnce(
    Response.json({ ...original, id: providerId, last_event: "delivered" }),
  );
  await worker(fetcher)(request());
  expect(fetcher.mock.calls[1][0]).toBe(
    `https://api.resend.com/emails/${providerId}`,
  );
  expect(fetcher.mock.calls[1][1].method).toBe("GET");
  expect((await result())[0]).toMatchObject({
    state: "accepted",
    delivery: "delivered",
  });
  await worker(fetcher)(request());
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(
    await f.scalar("select count(*)::int v from public.demo_email_outbox"),
  ).toBe(1);
});
it("forged delivery status or recipient mismatch cannot mark an email delivered", async () => {
  await f.order("transfer");
  await worker(vi.fn().mockResolvedValue(Response.json({ id: providerId })))(
    request(),
  );
  await due();
  await worker(
    vi.fn().mockResolvedValue(
      Response.json({
        id: providerId,
        from: "VANTA Demo <onboarding@resend.dev>",
        to: ["other@example.test"],
        last_event: "delivered",
      }),
    ),
  )(request());
  expect((await result())[0]).toMatchObject({
    state: "accepted",
    delivery: "unknown",
    error_code: "INVALID_RESPONSE",
  });
});
it("revoked recipients and changed encryption keys cannot cause an email to be redirected to a new recipient", async () => {
  await f.order("transfer");
  const fetcher = vi.fn();
  await worker(fetcher, vi.fn(), f.rpc, {
    ...emailSettings,
    allowed: JSON.stringify(["different@example.test"]),
  })(request());
  expect(fetcher).not.toHaveBeenCalled();
  expect((await result())[0].state).toBe("suppressed");
  await f.reset();
  await f.order("transfer");
  await worker(fetcher, vi.fn(), f.rpc, {
    ...emailSettings,
    encryption: btoa("z".repeat(32)),
  })(request());
  expect(fetcher).not.toHaveBeenCalled();
  expect((await result())[0].error_code).toBe("KEY_UNAVAILABLE");
});
it("frozen request ciphertext cannot be swapped between queue items or modified in local/database metadata", async () => {
  await f.order("transfer");
  const fetcher = vi.fn().mockRejectedValue(Error("network"));
  await worker(fetcher)(request());
  const row = (
    await f.db.query(
      "select id,request_ciphertext from public.demo_email_outbox",
    )
  ).rows[0];
  const key = await encryptionKey(emailSettings.encryption);
  expect(
    await unseal(row.request_ciphertext, key, `vanta-email-request:${row.id}`),
  ).toContain(recipient);
  await f.db.exec(
    "update public.demo_email_outbox set request_hash=repeat('e',64),next_attempt_at=clock_timestamp()-interval '1 second'",
  );
  fetcher.mockClear();
  await worker(fetcher)(request());
  expect(fetcher).not.toHaveBeenCalled();
  expect((await result())[0].state).toBe("failed");
});
it("RPC transport is allowlisted, bounded and strips raw database errors", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json({ message: "private address" }, { status: 500 }),
    );
  const rpc = createEmailRpc(
    "https://fixture.supabase.co",
    "fixture-service-only",
    fetcher,
  );
  await expect(rpc("demo_resolve_order", {})).rejects.toThrow(
    "RPC_UNAVAILABLE",
  );
  expect(fetcher).not.toHaveBeenCalled();
  await expect(rpc("demo_email_claim", {})).rejects.toThrow("RPC_UNAVAILABLE");
});

it("a committed acceptance whose RPC response is lost cannot fall back to another POST", async () => {
  await f.order("transfer");
  let lost = true;
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const data = await f.rpc(name, args);
    if (name === "demo_email_result" && args.p_outcome === "accepted" && lost) {
      lost = false;
      throw Error("lost ACK");
    }
    return data;
  };
  const fetcher = vi
    .fn()
    .mockImplementation(async () => Response.json({ id: providerId }));
  await worker(fetcher, vi.fn(), rpc)(request());
  expect((await result())[0].state).toBe("accepted");
  await worker(fetcher)(request());
  expect(fetcher).toHaveBeenCalledTimes(1);
});
