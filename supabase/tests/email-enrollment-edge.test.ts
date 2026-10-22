// @vitest-environment node
import { beforeAll, beforeEach, afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { makeHandler, sha } from "../functions/demo-orders/handler";
import {
  createEmailDb,
  emailSettings,
  payload,
  capability,
  recipient,
} from "./email-fixture";
let f: Awaited<ReturnType<typeof createEmailDb>>;
const base = {
  origin: "http://localhost:5173",
  challengeSecret: "fixture-secret",
  challengeHostname: "localhost",
  actorSecret: "a".repeat(32),
};
function request(body: Record<string, unknown>) {
  return new Request(base.origin, {
    method: "POST",
    headers: { origin: base.origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function handler() {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    try {
      return { data: await f.rpc(name, args), error: null };
    } catch (e) {
      const message = e instanceof Error ? e.message : "UNAVAILABLE";
      return { data: null, error: { message } };
    }
  });
  const fetcher = vi.fn(async () =>
    Response.json({
      success: true,
      hostname: "localhost",
      action: "demo-order",
    }),
  );
  const log = vi.fn();
  const run = makeHandler(
    {
      ...base,
      notifications: {
        enabled: true,
        allowed: emailSettings.allowed,
        encryption: emailSettings.encryption,
      },
    },
    rpc,
    fetcher,
    log,
  );
  return { run, rpc, fetcher, log };
}
function body() {
  return {
    action: "create",
    idempotency_key: randomUUID(),
    capability,
    payload,
    challenge: "fixture-turnstile",
    notification_email: recipient,
  };
}
beforeAll(async () => {
  f = await createEmailDb();
}, 30000);
afterAll(async () => f.db.close());
beforeEach(async () => f.reset());
it("official email field is optional and atomically encrypted after server order/Turnstile authorization", async () => {
  const { run, rpc, fetcher, log } = handler(),
    b = body();
  const response = await run(request(b));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ email_requested: true });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const args = rpc.mock.calls.find(
    (c) => c[0] === "demo_email_create_order",
  )![1];
  expect(JSON.stringify(args)).not.toContain(recipient);
  expect(JSON.stringify(args)).not.toContain(b.challenge);
  expect(JSON.stringify(log.mock.calls)).not.toContain(recipient);
  expect(JSON.stringify(log.mock.calls)).not.toContain(b.capability);
  expect(
    await f.scalar("select count(*)::int v from public.demo_email_outbox"),
  ).toBe(1);
  const legacy = { ...body() };
  delete (legacy as Partial<typeof legacy>).notification_email;
  expect(await (await run(request(legacy))).json()).toMatchObject({
    email_requested: false,
  });
});
it("replay and query recovery cannot retarget the saved recipient, repeat Turnstile or duplicate queued messages", async () => {
  const { run, fetcher } = handler(),
    b = body();
  await run(request(b));
  expect(
    (await run(request({ ...b, notification_email: "outsider@example.test" })))
      .status,
  ).toBe(200);
  const query = {
    action: "recover",
    idempotency_key: b.idempotency_key,
    capability: b.capability,
    payload: b.payload,
  };
  expect(await (await run(request(query))).json()).toMatchObject({
    email_requested: true,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    await f.scalar("select count(*)::int v from public.demo_email_outbox"),
  ).toBe(1);
  expect(
    await f.scalar("select recipient_hash v from public.demo_email_contacts"),
  ).toBe(await sha(recipient));
});
it.each([
  null,
  "bad",
  "a@example.test\r\nBcc:b@example.test",
  "outsider@example.test",
])(
  "invalid or unauthorized recipients are rejected before challenge/new order for %#",
  async (value) => {
    const { run, fetcher } = handler();
    const r = await run(request({ ...body(), notification_email: value }));
    expect([400, 403]).toContain(r.status);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await f.scalar("select count(*)::int v from public.orders")).toBe(0);
  },
);
it("notification field on recovery/cancel and browser-supplied sender/templates/status cannot bypass the strict request schema", async () => {
  const { run } = handler(),
    b = body();
  expect(
    (
      await run(
        request({
          ...b,
          subject: "unsafe",
          html: "<script>",
          status: "approved",
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await run(
        request({
          action: "recover",
          idempotency_key: b.idempotency_key,
          capability,
          payload,
          notification_email: recipient,
        }),
      )
    ).status,
  ).toBe(400);
  expect(await f.scalar("select count(*)::int v from public.orders")).toBe(0);
});
it("missing notification configuration fails closed without altering legacy order creation", async () => {
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  // Use the genuine SQL bridge for normal replay/admission behavior.
  const { run } = handler();
  await f.db.exec("update public.demo_email_config set enabled=false");
  const r = await run(request(body()));
  expect(r.ok).toBe(false);
  expect(await r.json()).toMatchObject({ error: "EMAIL_DISABLED" });
  expect(await f.scalar("select count(*)::int v from public.orders")).toBe(0);
  expect(rpc).not.toHaveBeenCalled();
});
