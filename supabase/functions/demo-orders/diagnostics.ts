/** Closed diagnostic vocabulary: never accept request data or raw exceptions. */
export const rpcOperations = [
  "demo_rate_limit",
  "demo_order_replay",
  "demo_admit_creation",
  "demo_create_order",
  "demo_cancel_order",
] as const;
export type RpcOperation = (typeof rpcOperations)[number];
type Operation = RpcOperation | "request" | "configuration" | "siteverify";
export type Phase = "request" | "body" | "validation" | "result";
export type Outcome =
  | "ok"
  | "network_error"
  | "timeout"
  | "http_error"
  | "invalid_json"
  | "invalid_response"
  | "rejected"
  | "rpc_error"
  | "unexpected_error";
const reasons = [
  "missing-input-secret",
  "invalid-input-secret",
  "missing-input-response",
  "invalid-input-response",
  "timeout-or-duplicate",
  "bad-request",
  "internal-error",
  "hostname_mismatch",
  "action_mismatch",
  "missing_challenge",
  "other",
  "42501",
  "42883",
  "PGRST202",
  "PGRST301",
  "23505",
  "23503",
  "23514",
  "P0001",
] as const;
export function safeReason(value: unknown): string {
  return typeof value === "string" &&
    (reasons as readonly string[]).includes(value)
    ? value
    : "other";
}
export function isTimeout(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    ((error instanceof Error || error instanceof DOMException) &&
      ["TimeoutError", "AbortError"].includes(error.name))
  );
}
export class DependencyError extends Error {
  constructor(
    readonly outcome: Outcome,
    readonly phase: Phase,
    readonly status?: number,
  ) {
    super("DEPENDENCY_UNAVAILABLE");
    this.name = "DependencyError";
  }
}
type Step = {
  operation: Operation;
  phase: Phase;
  outcome: Outcome;
  duration_ms: number;
  upstream_status?: number;
  reason?: string;
};
export type DiagnosticEvent = {
  event: "demo_orders_diagnostic";
  version: 1;
  http_status: number;
  duration_ms: number;
  steps: Step[];
};
export type DiagnosticSink = (event: DiagnosticEvent) => void;
export const writeDiagnostic: DiagnosticSink = (event) =>
  console.info(JSON.stringify(event));
const duration = (start: number) =>
  Math.max(0, Math.min(300000, Math.round(performance.now() - start)));
export function diagnostic(sink: DiagnosticSink) {
  const start = performance.now(),
    steps: Step[] = [];
  return {
    record(
      operation: Operation,
      phase: Phase,
      outcome: Outcome,
      since: number,
      status?: number,
      reason?: unknown,
    ) {
      if (steps.length >= 12) return;
      steps.push({
        operation,
        phase,
        outcome,
        duration_ms: duration(since),
        ...(Number.isInteger(status) && status! >= 100 && status! <= 599
          ? { upstream_status: status }
          : {}),
        ...(reason === undefined ? {} : { reason: safeReason(reason) }),
      });
    },
    finish(status: number) {
      try {
        sink({
          event: "demo_orders_diagnostic",
          version: 1,
          http_status: status,
          duration_ms: duration(start),
          steps,
        });
      } catch {
        /* Logging must never change a committed result or trigger a retry. */
      }
    },
  };
}
