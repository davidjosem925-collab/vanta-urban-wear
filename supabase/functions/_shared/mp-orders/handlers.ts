import {
  context,
  hash,
  identifier,
  jsonBody,
  PaymentError,
  publicPayment,
  record,
  sameSecret,
  uuid,
  validateSettings,
  type Context,
  type Operation,
  type Rpc,
  type Settings,
  type Sink,
} from "./core.ts";
import { Provider, snapshot } from "./provider.ts";
import { verifySignature } from "./signature.ts";
export function makePaymentHandler(
  operation: Operation,
  settings: Settings,
  rpc: Rpc,
  fetcher: typeof fetch = fetch,
  sink: Sink = () => {},
) {
  const provider = new Provider(settings, fetcher);
  async function apply(raw: unknown, c: Context) {
    const s = snapshot(raw, c, settings);
    return context(
      await rpc("mp_test_apply", {
        p_id: c.payment_id,
        p_resource: s.id,
        p_url: s.url,
        p_snapshot: s.value,
      }),
    );
  }
  async function create(c: Context, claimed = false) {
    if (c.provider_order_id)
      return apply(await provider.get(c.provider_order_id), c);
    if (c.order_status !== "pending" || Date.parse(c.expires_at) <= Date.now())
      return c;
    if (
      !claimed &&
      (await rpc("mp_test_claim_create", { p_id: c.payment_id })) !== true
    )
      return c;
    return apply(await provider.create(c), c);
  }
  async function reconcile(c: Context) {
    if (!c.provider_order_id) {
      const found = await provider.find(c);
      if (found) return apply(found, c);
      const config = record(await rpc("mp_test_settings", {}));
      if (
        settings.enabled &&
        config.enabled === true &&
        c.reconciliation !== "review" &&
        c.attempts <= 8 &&
        c.order_status === "pending" &&
        Date.parse(c.expires_at) > Date.now()
      )
        return create(c, true);
      return context(
        await rpc("mp_test_unlinked_result", { p_id: c.payment_id }),
      );
    }
    let raw = await provider.get(c.provider_order_id);
    const state = snapshot(raw, c, settings);
    if (
      state.value.state === "pending" &&
      (Date.parse(c.expires_at) <= Date.now() ||
        ["expired", "cancelled"].includes(c.order_status))
    ) {
      // Cancellation can race with approval: always fetch again, never infer success from HTTP alone.
      try {
        await provider.cancel(c);
      } catch {
        /* A fresh authoritative GET below decides the result. */
      }
      raw = await provider.get(c.provider_order_id);
    }
    return apply(raw, c);
  }
  async function event(id: string, resource: string) {
    try {
      const raw = record(await provider.get(resource));
      if (
        typeof raw.external_reference !== "string" ||
        !uuid.test(raw.external_reference)
      )
        throw new PaymentError("INVALID_PROVIDER_RESPONSE");
      const candidate = await rpc("mp_test_lookup", {
        p_reference: raw.external_reference,
      });
      if (!candidate) {
        await rpc("mp_test_finish_event", {
          p_id: id,
          p_outcome: "unknown_resource",
        });
        return;
      }
      const c = await apply(raw, context(candidate));
      await rpc("mp_test_finish_event", {
        p_id: id,
        p_outcome: c.reconciliation === "review" ? "review" : "ok",
        p_payment: c.payment_id,
      });
    } catch (e) {
      try {
        await rpc("mp_test_finish_event", { p_id: id, p_outcome: "retry" });
      } catch {
        /* Inbox remains durable if the dependency is down. */
      }
      throw e;
    }
  }
  return async (request: Request): Promise<Response> => {
    let code: "ok" | PaymentError["code"] = "ok",
      status = 200;
    let dependency: import("./core.ts").Dependency | undefined,
      upstream: number | undefined;
    function failedDependency(error: unknown) {
      const failure =
        error instanceof PaymentError
          ? error
          : new PaymentError("PROVIDER_UNAVAILABLE");
      code = failure.code;
      dependency = failure.dependency;
      upstream = failure.upstreamStatus;
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    };
    if (operation === "checkout" && /^[^\r\n]{1,300}$/.test(settings.origin)) {
      headers["Access-Control-Allow-Origin"] = settings.origin;
      headers.Vary = "Origin";
      headers["Access-Control-Allow-Headers"] =
        "authorization,apikey,content-type";
      headers["Access-Control-Allow-Methods"] = "POST,OPTIONS";
    }
    async function input(limit: number) {
      const value = await jsonBody(request, limit);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new PaymentError("INVALID_REQUEST", 400);
      return value as Record<string, unknown>;
    }
    const reply = (body: unknown, s = 200) => {
      status = s;
      return new Response(JSON.stringify(body), { status: s, headers });
    };
    try {
      validateSettings(settings);
      if (
        operation === "checkout" &&
        request.headers.get("origin") !== settings.origin
      )
        throw new PaymentError("FORBIDDEN", 403);
      if (operation === "checkout" && request.method === "OPTIONS") {
        status = 204;
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== "POST")
        throw new PaymentError("INVALID_REQUEST", 405);
      if (
        request.headers
          .get("content-type")
          ?.split(";")[0]
          .trim()
          .toLowerCase() !== "application/json"
      )
        throw new PaymentError("INVALID_REQUEST", 415);
      if (operation === "worker") {
        const authorization = request.headers.get("authorization") ?? "";
        if (
          authorization.length > 1200 ||
          !(await sameSecret(authorization, `Bearer ${settings.workerSecret}`))
        )
          throw new PaymentError("FORBIDDEN", 403);
        const b = await input(128);
        if (Object.keys(b).length)
          throw new PaymentError("INVALID_REQUEST", 400);
        const work = record(await rpc("mp_test_claim_work", {}));
        let done = 0,
          failed = 0;
        if (
          !Array.isArray(work.events) ||
          !Array.isArray(work.payments) ||
          work.events.length > 2 ||
          work.payments.length > 2
        )
          throw new PaymentError("RPC_UNAVAILABLE");
        for (const v of work.events) {
          const e = record(v);
          try {
            await event(String(e.event_id), String(e.resource));
            done++;
          } catch (e) {
            failedDependency(e);
            failed++;
          }
        }
        for (const v of work.payments) {
          try {
            await reconcile(context(v));
            done++;
          } catch (e) {
            failedDependency(e);
            if (e instanceof PaymentError && e.code === "PAYMENT_CONFLICT") {
              try {
                await rpc("mp_test_unlinked_result", {
                  p_id: context(v).payment_id,
                });
              } catch {
                /* Preserve the lease for retry. */
              }
            }
            failed++;
          }
        }
        return reply({ processed: done, retry: failed, demo: true });
      }
      if (operation === "webhook") {
        const signed = await verifySignature(request, settings.webhookSecret);
        const b = await input(32768);
        if (
          b.type !== "order" ||
          b.live_mode !== false ||
          identifier(b.application_id) !== settings.application ||
          identifier(b.user_id) !== settings.seller ||
          record(b.data).id !== signed.id
        )
          throw new PaymentError("INVALID_REQUEST", 400);
        const id = await rpc("mp_test_accept_event", {
          p_event: `mp:${await hash(signed.manifest)}`,
          p_resource: signed.id,
        });
        if (typeof id !== "string" || !uuid.test(id))
          throw new PaymentError("RPC_UNAVAILABLE");
        if ((await rpc("mp_test_claim_event", { p_id: id })) === true)
          await event(id, signed.id);
        return reply({ received: true });
      }
      const b = await input(1024);
      if (
        Object.keys(b).sort().join(",") !== "action,capability,reference" ||
        !["create", "recover"].includes(String(b.action)) ||
        typeof b.reference !== "string" ||
        !uuid.test(b.reference) ||
        typeof b.capability !== "string" ||
        !/^[a-f0-9]{64}$/.test(b.capability)
      )
        throw new PaymentError("INVALID_REQUEST", 400);
      if (b.action === "create" && !settings.enabled)
        throw new PaymentError("DISABLED");
      const hop =
        request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
        "unknown";
      if (
        (await rpc("demo_rate_limit", {
          p_actor: await hash(`${settings.actorSecret}:${hop}`),
        })) !== true
      )
        throw new PaymentError("RATE_LIMITED", 429);
      const config = record(await rpc("mp_test_settings", {}));
      if (
        config.seller_id !== settings.seller ||
        config.application_id !== settings.application
      )
        throw new PaymentError("NOT_CONFIGURED");
      if (b.action === "create") {
        if (config.enabled !== true) throw new PaymentError("DISABLED");
        await provider.verifyIdentity();
      }
      const raw = await rpc("mp_test_prepare", {
        p_reference: b.reference,
        p_owner: await hash(b.capability),
        p_create: b.action === "create",
        p_return_origin: settings.origin,
      });
      if (raw === null) return reply({ found: false });
      let c = context(raw);
      if (b.action === "create") c = await create(c);
      else if (c.provider_order_id)
        c = await apply(await provider.get(c.provider_order_id), c);
      return reply(
        publicPayment(c),
        !c.provider_order_id && b.action === "create" ? 202 : 200,
      );
    } catch (e) {
      const failure =
        e instanceof PaymentError
          ? e
          : new PaymentError("PROVIDER_UNAVAILABLE");
      code = failure.code;
      dependency = failure.dependency;
      upstream = failure.upstreamStatus;
      return reply({ error: code }, failure.http);
    } finally {
      try {
        sink({
          event: "mp_test_diagnostic",
          operation,
          outcome: code,
          http_status: status,
          ...(dependency ? { dependency } : {}),
          ...(upstream && upstream >= 100 && upstream <= 599
            ? { upstream_status: upstream }
            : {}),
        });
      } catch {
        /* Diagnostics must never change a committed result. */
      }
    }
  };
}
