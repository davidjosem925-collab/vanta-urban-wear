import { expect, it, vi } from "vitest";
import { requestOrder, OrderRequestError } from "./service";
const url = "https://fixture.supabase.co";
it("distinguishes HTTP rejection, network, timeout and malformed success without exposing raw errors", async () => {
  const cases: [typeof fetch, string, string, number | undefined][] = [
    [
      vi.fn(
        async () => new Response("private gateway details", { status: 401 }),
      ) as typeof fetch,
      "HTTP_REJECTED",
      "http",
      401,
    ],
    [
      vi.fn(async () =>
        Response.json(
          { error: "FORBIDDEN", details: "private" },
          { status: 403 },
        ),
      ) as typeof fetch,
      "FORBIDDEN",
      "http",
      403,
    ],
    [
      vi.fn(async () => {
        throw new TypeError("private capability");
      }) as typeof fetch,
      "NETWORK_ERROR",
      "network",
      undefined,
    ],
    [
      vi.fn(async () => {
        throw new DOMException("private token", "TimeoutError");
      }) as typeof fetch,
      "TIMEOUT_ERROR",
      "timeout",
      undefined,
    ],
    [
      vi.fn(
        async () => new Response("invalid", { status: 200 }),
      ) as typeof fetch,
      "INVALID_RESPONSE",
      "protocol",
      200,
    ],
  ];
  for (const [fetcher, code, kind, status] of cases) {
    const e = await requestOrder(url, "public-test", {}, fetcher).catch(
      (e) => e,
    );
    expect(e).toBeInstanceOf(OrderRequestError);
    expect(e).toMatchObject({ message: code, kind, status });
    expect(String(e)).not.toMatch(/private/);
  }
});
it("does not discard recovery identity when a deployed older Edge rejects the new action", async () => {
  await expect(
    requestOrder(
      url,
      "public-test",
      { action: "recover" },
      vi.fn(async () =>
        Response.json({ error: "INVALID_REQUEST" }, { status: 400 }),
      ) as typeof fetch,
    ),
  ).rejects.toMatchObject({
    message: "RECOVERY_UNSUPPORTED",
    kind: "http",
    status: 400,
  });
});
