// @vitest-environment node
import { expect, it, vi } from "vitest";
import {
  createEmailRpc,
  makeEmailWorker,
} from "../functions/_shared/demo-email/worker";
import { emailSettings } from "./email-fixture";
const endpoint = "https://fixture.supabase.co";
const key = "fixture-service-only";
it("maintenance accepts 204 without inspecting an absent body", async () => {
  const response = new Response(null, { status: 204 });
  const body = vi.spyOn(response, "body", "get");
  const fetcher = vi.fn().mockResolvedValue(response);
  const rpc = createEmailRpc(endpoint, key, fetcher);
  await expect(rpc("demo_email_maintenance", {})).resolves.toBeNull();
  expect(body).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledWith(
    endpoint + "/rest/v1/rpc/demo_email_maintenance",
    expect.objectContaining({ method: "POST", body: "{}", redirect: "error" }),
  );
});
it.each([
  "demo_email_claim",
  "demo_email_freeze",
  "demo_email_begin",
  "demo_email_result",
  "demo_email_delivery",
])("204 cannot replace required data from %s", async (name) => {
  const rpc = createEmailRpc(
    endpoint,
    key,
    vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
  );
  await expect(rpc(name, {})).rejects.toThrow(/^RPC_UNAVAILABLE$/);
});
it.each([null, false, true, [], { sends: [], polls: [] }])(
  "valid JSON remains unchanged: %j",
  async (value) => {
    const rpc = createEmailRpc(
      endpoint,
      key,
      vi.fn().mockResolvedValue(Response.json(value)),
    );
    await expect(rpc("demo_email_claim", {})).resolves.toEqual(value);
  },
);
it.each([
  () => new Response(null, { status: 200 }),
  () => new Response("", { status: 200 }),
  () => new Response("not-json-private-sentinel", { status: 200 }),
  () => new Response('{"incomplete":', { status: 200 }),
  () => new Response('"' + "a".repeat(524288) + '"', { status: 200 }),
  () => Response.json({ message: "private-sentinel" }, { status: 403 }),
  () => Response.json({ message: "private-sentinel" }, { status: 500 }),
])(
  "invalid/unsuccessful responses retain a sanitized error (%#)",
  async (response) => {
    const rpc = createEmailRpc(
      endpoint,
      key,
      vi.fn().mockImplementation(async () => response()),
    );
    await expect(rpc("demo_email_maintenance", {})).rejects.toThrow(
      /^RPC_UNAVAILABLE$/,
    );
  },
);
it("transport errors remain sanitized and unsupported RPCs never fetch", async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error("private-sentinel"));
  const rpc = createEmailRpc(endpoint, key, fetcher);
  await expect(rpc("other_rpc", {})).rejects.toThrow(/^RPC_UNAVAILABLE$/);
  expect(fetcher).not.toHaveBeenCalled();
  await expect(rpc("demo_email_maintenance", {})).rejects.toThrow(
    /^RPC_UNAVAILABLE$/,
  );
});
it("disabled worker completes void maintenance via HTTP 204 without sending or claiming mail", async () => {
  const transport = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 204 }));
  const provider = vi.fn();
  const handler = makeEmailWorker(
    { ...emailSettings, enabled: false },
    createEmailRpc(endpoint, key, transport),
    provider,
  );
  const response = await handler(
    new Request("https://edge.example/demo-email-worker", {
      method: "POST",
      headers: {
        authorization: `Bearer ${emailSettings.workerSecret}`,
        "content-type": "application/json",
      },
      body: "{}",
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    processed: 0,
    retry: 0,
    disabled: true,
    demo: true,
  });
  expect(provider).not.toHaveBeenCalled();
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0][0]).toBe(
    endpoint + "/rest/v1/rpc/demo_email_maintenance",
  );
});
