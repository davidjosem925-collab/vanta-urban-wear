import { useRef, useState } from "react";
import type { Attempt, Receipt } from "../orders/service";
import {
  checkoutUrl,
  paymentMessages,
  paymentStorageKey,
  paymentView,
  readPaymentSession,
  type PaymentService,
  type PaymentSession,
  type PaymentView,
} from "./service";

export function usePayment(
  service: PaymentService,
  redirect: (url: string) => void = (url) => window.location.assign(url),
) {
  const [initial] = useState(() => {
    try {
      return {
        session: readPaymentSession(sessionStorage.getItem(paymentStorageKey)),
        error: "",
      };
    } catch {
      return { session: null, error: paymentMessages.STORAGE };
    }
  });
  const [session, setSession] = useState(initial.session);
  const [view, setView] = useState<PaymentView | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(initial.error);
  const [absent, setAbsent] = useState(false);
  const busy = useRef(false);
  const lastQuery = useRef(0);
  const [queried, setQueried] = useState(false);
  async function run(
    action: "create" | "recover",
    navigate = false,
    target = session,
  ) {
    if (!target || busy.current) return;
    // Shared server rate limit is six/hour. Never background-poll or auto-retry.
    if (action === "recover" && Date.now() - lastQuery.current < 10000) {
      setError(
        "Esperá al menos diez segundos entre consultas para conservar el límite de intentos.",
      );
      return;
    }
    busy.current = true;
    setPending(true);
    setError("");
    setView(null);
    setAbsent(false);
    lastQuery.current = Date.now();
    try {
      const raw = await service.request(target, action);
      if (raw === null) {
        setAbsent(true);
        return;
      }
      const p = paymentView(raw, target.reference);
      setView(p);
      if (
        navigate &&
        target.attempt.payload.payment === "mercado_pago" &&
        p.checkout_url &&
        p.order_status === "pending" &&
        p.payment_status === "pending" &&
        ["unlinked", "awaiting"].includes(p.reconciliation) &&
        Date.parse(p.expires_at) > Date.now()
      )
        redirect(checkoutUrl(p.checkout_url));
    } catch (e) {
      setError(
        paymentMessages[
          e instanceof Error && Object.hasOwn(paymentMessages, e.message)
            ? e.message
            : "UNAVAILABLE"
        ],
      );
    } finally {
      busy.current = false;
      setPending(false);
      setQueried(true);
    }
  }
  function attach(r: Receipt, a: Attempt) {
    if (initial.error) throw new Error("STORAGE");
    const next: PaymentSession = {
      version: 1,
      reference: r.reference,
      attempt: a,
    };
    // Persist before the original creation attempt is removed or the cart is cleared.
    try {
      readPaymentSession(JSON.stringify(next));
      sessionStorage.setItem(paymentStorageKey, JSON.stringify(next));
    } catch {
      throw new Error("STORAGE");
    }
    setSession(next);
    setView(null);
    setError("");
    setQueried(false);
    void run("create", true, next);
  }
  return {
    enabled: service.enabled,
    blocked: Boolean(initial.error),
    session,
    view,
    error,
    absent,
    pending,
    queried,
    attach,
    recover: () => run("recover"),
    resume: () => run("create", true),
    finish() {
      if (
        busy.current ||
        !view ||
        view.reconciliation === "review" ||
        ![
          "confirmed",
          "preparing",
          "delivered",
          "expired",
          "cancelled",
        ].includes(view.order_status)
      )
        return;
      try {
        sessionStorage.removeItem(paymentStorageKey);
      } catch {
        setError(paymentMessages.STORAGE);
        return;
      }
      setSession(null);
      setView(null);
      setQueried(false);
      setAbsent(false);
      setError("");
      window.location.hash = "/catalogo";
    },
  };
}
