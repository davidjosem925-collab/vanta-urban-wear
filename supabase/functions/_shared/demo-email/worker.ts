import { hash, jsonBody, sameSecret, uuid } from "../mp-orders/core.ts";
import {
  encryptionKey,
  normalizeEmail,
  recipients,
  seal,
  unseal,
} from "./privacy.ts";
import { emailTemplate } from "./template.ts";
export type EmailSettings = {
  enabled: boolean;
  mode: string;
  token: string;
  from: string;
  workerSecret: string;
  allowed: string;
  encryption: string;
};
export type EmailRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;
const outcomes = [
  "NETWORK",
  "TIMEOUT",
  "HTTP_RETRY",
  "PROVIDER_AUTH",
  "PROVIDER_REJECTED",
  "IDEMPOTENCY_CONFLICT",
  "INVALID_RESPONSE",
  "INVALID_DATA",
  "RECIPIENT_BLOCKED",
  "KEY_UNAVAILABLE",
] as const;
type Outcome = (typeof outcomes)[number];
class MailFailure extends Error {
  constructor(
    readonly code: Outcome,
    readonly delay = 60,
  ) {
    super(code);
  }
}
type RequestBody = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  tags: { name: string; value: string }[];
};
function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new MailFailure("INVALID_DATA");
  return raw as Record<string, unknown>;
}
function frozenBody(
  raw: string,
  jobId: string,
  allowed: Set<string>,
): RequestBody {
  try {
    if (raw.length > 100000) throw Error();
    const p = JSON.parse(raw) as RequestBody;
    if (
      Object.keys(p).sort().join(",") !== "from,html,subject,tags,text,to" ||
      !Array.isArray(p.to) ||
      p.to.length !== 1 ||
      typeof p.to[0] !== "string" ||
      typeof p.from !== "string" ||
      !/^VANTA Demo <[^<>]+>$/.test(p.from) ||
      !normalizeEmail(p.from.slice(12, -1)) ||
      typeof p.subject !== "string" ||
      p.subject.length > 300 ||
      /[\r\n]/.test(p.subject) ||
      !p.subject.startsWith("VANTA Demo · ") ||
      typeof p.html !== "string" ||
      p.html.length > 60000 ||
      typeof p.text !== "string" ||
      p.text.length > 20000 ||
      !Array.isArray(p.tags) ||
      p.tags.length !== 2 ||
      p.tags[0]?.name !== "vanta_demo_job" ||
      p.tags[0]?.value !== jobId ||
      p.tags[1]?.name !== "vanta_mode" ||
      p.tags[1]?.value !== "portfolio_demo"
    )
      throw Error();
    const address = normalizeEmail(p.to[0]);
    if (address !== p.to[0]) throw Error();
    if (!allowed.has(address)) throw new MailFailure("RECIPIENT_BLOCKED");
    return p;
  } catch (e) {
    if (e instanceof MailFailure) throw e;
    throw new MailFailure("INVALID_DATA");
  }
}
function failure(error: unknown): Outcome {
  const code = error instanceof Error ? error.message : "";
  return outcomes.includes(code as Outcome)
    ? (code as Outcome)
    : "INVALID_DATA";
}
function retryAfter(response: Response): number {
  const value = response.headers.get("retry-after");
  if (!value) return 60;
  const seconds = /^\d{1,8}$/.test(value)
    ? Number(value)
    : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(seconds)
    ? Math.max(1, Math.min(86400, Math.ceil(seconds)))
    : 60;
}
export function makeEmailWorker(
  settings: EmailSettings,
  rpc: EmailRpc,
  fetcher: typeof fetch = fetch,
  sink: (value: {
    event: "demo_email_diagnostic";
    outcome: string;
    http_status: number;
    processed: number;
    retry: number;
  }) => void = () => {},
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
) {
  return async (request: Request): Promise<Response> => {
    let code = "ok",
      http = 200,
      processed = 0,
      retry = 0;
    const reply = (data: unknown, status = 200) => {
      http = status;
      return Response.json(data, {
        status,
        headers: { "Cache-Control": "no-store" },
      });
    };
    async function call(name: string, args: Record<string, unknown>) {
      try {
        return await rpc(name, args);
      } catch {
        throw Error("RPC_UNAVAILABLE");
      }
    }
    try {
      if (settings.workerSecret.length < 32) {
        code = "NOT_CONFIGURED";
        return reply({ error: code }, 503);
      }
      const auth = request.headers.get("authorization") ?? "";
      if (
        auth.length > 1200 ||
        !(await sameSecret(auth, `Bearer ${settings.workerSecret}`))
      ) {
        code = "FORBIDDEN";
        return reply({ error: code }, 403);
      }
      if (
        request.method !== "POST" ||
        request.headers
          .get("content-type")
          ?.split(";")[0]
          .trim()
          .toLowerCase() !== "application/json"
      ) {
        code = "INVALID_REQUEST";
        return reply({ error: code }, 400);
      }
      try {
        const b = record(await jsonBody(request, 128));
        if (Object.keys(b).length) throw Error();
      } catch {
        code = "INVALID_REQUEST";
        return reply({ error: code }, 400);
      }
      // Disabled invocation still performs retention maintenance, but does not contact Resend.
      if (!settings.enabled) {
        await call("demo_email_maintenance", {});
        return reply({ processed: 0, retry: 0, disabled: true, demo: true });
      }
      if (
        settings.mode !== "portfolio_demo" ||
        !/^re_[A-Za-z0-9_-]{10,200}$/.test(settings.token)
      )
        throw Error("NOT_CONFIGURED");
      let allowed: Set<string>, key: CryptoKey, from: string;
      try {
        allowed = recipients(settings.allowed);
        key = await encryptionKey(settings.encryption);
        from = `VANTA Demo <${normalizeEmail(settings.from)}>`;
      } catch {
        throw Error("NOT_CONFIGURED");
      }
      const work = record(await call("demo_email_claim", {}));
      if (
        !Array.isArray(work.sends) ||
        !Array.isArray(work.polls) ||
        work.sends.length > 2 ||
        work.polls.length > 2
      )
        throw Error("RPC_UNAVAILABLE");
      let lastHttp = 0;
      async function provider(path: string, body?: string, id?: string) {
        const pause = 600 - (Date.now() - lastHttp);
        if (pause > 0) await sleep(pause);
        lastHttp = Date.now();
        const signal = AbortSignal.timeout(8000);
        let r: Response;
        try {
          r = await fetcher(`https://api.resend.com/emails${path}`, {
            method: body ? "POST" : "GET",
            headers: {
              Authorization: `Bearer ${settings.token}`,
              ...(body
                ? {
                    "Content-Type": "application/json",
                    "Idempotency-Key": `vanta-demo/${id}`,
                  }
                : {}),
            },
            ...(body ? { body } : {}),
            signal,
            redirect: "error",
          });
        } catch (e) {
          throw new MailFailure(
            signal.aborted ||
            ((e instanceof Error || e instanceof DOMException) &&
              ["AbortError", "TimeoutError"].includes(e.name))
              ? "TIMEOUT"
              : "NETWORK",
          );
        }
        let raw: unknown;
        try {
          raw = await jsonBody(r, 131072);
        } catch {
          throw new MailFailure(
            r.status >= 500 || r.status === 429
              ? "HTTP_RETRY"
              : [401, 403].includes(r.status)
                ? "PROVIDER_AUTH"
                : r.status === 409
                  ? "IDEMPOTENCY_CONFLICT"
                  : !r.ok
                    ? "PROVIDER_REJECTED"
                    : "INVALID_RESPONSE",
            retryAfter(r),
          );
        }
        if (!r.ok) {
          let name: unknown;
          try {
            name = record(raw).name;
          } catch {
            /* no raw bodies */
          }
          if (r.status === 409 && name === "concurrent_idempotent_requests")
            throw new MailFailure("HTTP_RETRY", retryAfter(r));
          if (r.status === 409) throw new MailFailure("IDEMPOTENCY_CONFLICT");
          if (r.status === 429 || r.status >= 500)
            throw new MailFailure("HTTP_RETRY", retryAfter(r));
          throw new MailFailure(
            [401, 403].includes(r.status)
              ? "PROVIDER_AUTH"
              : "PROVIDER_REJECTED",
          );
        }
        try {
          return record(raw);
        } catch {
          throw new MailFailure("INVALID_RESPONSE");
        }
      }
      for (const value of work.sends) {
        const job = record(value),
          id = String(job.id),
          lease = String(job.lease);
        if (!uuid.test(id) || !uuid.test(lease)) throw Error("RPC_UNAVAILABLE");
        try {
          let encrypted = job.request_ciphertext,
            expected = job.request_hash;
          if (encrypted === null) {
            const email = normalizeEmail(
              await unseal(
                job.recipient_ciphertext,
                key,
                `vanta-email-contact:${job.context_key}`,
              ),
            );
            if (
              !allowed.has(email) ||
              (await hash(email)) !== job.recipient_hash
            )
              throw new MailFailure("RECIPIENT_BLOCKED");
            const payload: RequestBody = {
              from,
              to: [email],
              ...emailTemplate(job.payload),
              tags: [
                { name: "vanta_demo_job", value: id },
                { name: "vanta_mode", value: "portfolio_demo" },
              ],
            };
            const text = JSON.stringify(payload);
            const frozen = record(
              await call("demo_email_freeze", {
                p_id: id,
                p_lease: lease,
                p_ciphertext: await seal(
                  text,
                  key,
                  `vanta-email-request:${id}`,
                ),
                p_hash: await hash(text),
              }),
            );
            encrypted = frozen.request_ciphertext;
            expected = frozen.request_hash;
          }
          const body = await unseal(
            encrypted,
            key,
            `vanta-email-request:${id}`,
          );
          if ((await hash(body)) !== expected)
            throw new MailFailure("INVALID_DATA");
          frozenBody(body, id, allowed);
          if (
            (await call("demo_email_begin", { p_id: id, p_lease: lease })) !==
            true
          )
            continue;
          const result = await provider("", body, id);
          if (typeof result.id !== "string" || !uuid.test(result.id))
            throw new MailFailure("INVALID_RESPONSE");
          if (
            (await call("demo_email_result", {
              p_id: id,
              p_lease: lease,
              p_outcome: "accepted",
              p_provider: result.id,
              p_delay: 60,
            })) !== true
          )
            throw Error("RPC_UNAVAILABLE");
          processed++;
        } catch (e) {
          const outcome = failure(e);
          code =
            e instanceof Error && e.message === "RPC_UNAVAILABLE"
              ? "RPC_UNAVAILABLE"
              : outcome;
          retry++;
          // An uncertain accepted response is retried with the identical frozen body/key, never a new key.
          try {
            await call("demo_email_result", {
              p_id: id,
              p_lease: lease,
              p_outcome: code === "RPC_UNAVAILABLE" ? "NETWORK" : outcome,
              p_provider: null,
              p_delay: e instanceof MailFailure ? e.delay : 60,
            });
          } catch {
            code = "RPC_UNAVAILABLE";
          }
        }
      }
      for (const value of work.polls) {
        const job = record(value),
          id = String(job.id),
          lease = String(job.lease),
          providerId = String(job.provider_id);
        if (!uuid.test(id) || !uuid.test(lease) || !uuid.test(providerId))
          throw Error("RPC_UNAVAILABLE");
        let outcome: string,
          delay = 300;
        try {
          const plain = await unseal(
            job.request_ciphertext,
            key,
            `vanta-email-request:${id}`,
          );
          if ((await hash(plain)) !== job.request_hash)
            throw new MailFailure("INVALID_DATA");
          const original = frozenBody(plain, id, allowed);
          const result = await provider(`/${providerId}`);
          const tags = result.tags;
          if (
            result.id !== providerId ||
            result.from !== original.from ||
            !Array.isArray(result.to) ||
            result.to.length !== 1 ||
            result.to[0] !== original.to[0] ||
            result.subject !== original.subject ||
            !Array.isArray(tags) ||
            !original.tags.every((tag) =>
              tags.some((value: unknown) => {
                const item = value as { name?: unknown; value?: unknown };
                return (
                  item && item.name === tag.name && item.value === tag.value
                );
              }),
            )
          )
            throw new MailFailure("INVALID_RESPONSE");
          const states: Record<string, string> = {
            sent: "sent",
            queued: "delayed",
            scheduled: "delayed",
            canceled: "failed",
            delivered: "delivered",
            delivery_delayed: "delayed",
            bounced: "bounced",
            complained: "complained",
            failed: "failed",
            suppressed: "suppressed",
            opened: "delivered",
            clicked: "delivered",
          };
          if (
            typeof result.last_event !== "string" ||
            !Object.hasOwn(states, result.last_event)
          )
            throw new MailFailure("INVALID_RESPONSE");
          outcome = states[result.last_event];
          processed++;
        } catch (e) {
          delay = e instanceof MailFailure ? e.delay : 300;
          outcome = failure(e);
          if (
            ![
              "NETWORK",
              "TIMEOUT",
              "HTTP_RETRY",
              "PROVIDER_AUTH",
              "PROVIDER_REJECTED",
              "INVALID_RESPONSE",
            ].includes(outcome)
          )
            outcome = "INVALID_RESPONSE";
          code = outcome;
          retry++;
        }
        if (
          (await call("demo_email_delivery", {
            p_id: id,
            p_lease: lease,
            p_provider: providerId,
            p_state: outcome,
            p_delay: delay,
          })) !== true
        )
          throw Error("RPC_UNAVAILABLE");
      }
      return reply({ processed, retry, demo: true });
    } catch (e) {
      code =
        e instanceof Error &&
        ["NOT_CONFIGURED", "RPC_UNAVAILABLE"].includes(e.message)
          ? e.message
          : "RPC_UNAVAILABLE";
      return reply({ error: code }, 503);
    } finally {
      try {
        sink({
          event: "demo_email_diagnostic",
          outcome: code,
          http_status: http,
          processed,
          retry,
        });
      } catch {
        /* diagnostics cannot change a committed result */
      }
    }
  };
}
const rpcNames = new Set([
  "demo_email_maintenance",
  "demo_email_claim",
  "demo_email_freeze",
  "demo_email_begin",
  "demo_email_result",
  "demo_email_delivery",
]);
export function createEmailRpc(
  url: string,
  key: string,
  fetcher: typeof fetch = fetch,
): EmailRpc {
  return async (name, args) => {
    if (!rpcNames.has(name)) throw Error("RPC_UNAVAILABLE");
    try {
      const r = await fetcher(`${url}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          apikey: key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      if (!r.ok) throw Error();
      // Only maintenance returns void. Data-bearing RPCs must still return JSON.
      if (r.status === 204) {
        if (name !== "demo_email_maintenance") throw Error();
        return null;
      }
      return await jsonBody(r, 524288);
    } catch {
      throw Error("RPC_UNAVAILABLE");
    }
  };
}
