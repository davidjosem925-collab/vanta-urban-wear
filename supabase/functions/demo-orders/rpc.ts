import {
  DependencyError,
  isTimeout,
  safeReason,
  type RpcOperation,
} from "./diagnostics.ts";
export type Rpc = (
  name: RpcOperation,
  args: Record<string, unknown>,
) => Promise<{
  data: unknown;
  error: {
    message: string;
    diagnostic?: { status: number; code: string };
  } | null;
}>;
const businessCodes = [
  "IDEMPOTENCY_EXPIRED",
  "IDEMPOTENCY_CONFLICT",
  "INSUFFICIENT_STOCK",
  "PRODUCT_UNAVAILABLE",
  "PRICE_CHANGED",
  "DEMO_CAPACITY",
  "INVALID_REQUEST",
] as const;
/** Preserve business decisions; discard all raw PostgREST details at this boundary. */
export function createRpc(
  url: string,
  key: string,
  fetcher: typeof fetch = fetch,
): Rpc {
  return async (name, args) => {
    const signal = AbortSignal.timeout(15000);
    let response: Response;
    try {
      response = await fetcher(`${url}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        signal,
      });
    } catch (error) {
      throw new DependencyError(
        isTimeout(error, signal) ? "timeout" : "network_error",
        "request",
      );
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      throw new DependencyError(
        isTimeout(error, signal)
          ? "timeout"
          : error instanceof SyntaxError
            ? "invalid_json"
            : "network_error",
        "body",
        response.status,
      );
    }
    if (!response.ok) {
      const record =
        data && typeof data === "object"
          ? (data as Record<string, unknown>)
          : {};
      const message = typeof record.message === "string" ? record.message : "";
      return {
        data: null,
        error: {
          message:
            businessCodes.find((code) => message.includes(code)) ??
            "UNAVAILABLE",
          diagnostic: {
            status: response.status,
            code: safeReason(record.code),
          },
        },
      };
    }
    return { data, error: null };
  };
}
