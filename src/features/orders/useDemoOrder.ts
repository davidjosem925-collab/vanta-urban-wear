import { useRef, useState } from "react";
import {
  newAttempt,
  orderMessages,
  readAttempt,
  receipt,
  validPayload,
  type Attempt,
  type OrderPayload,
  type OrderService,
  type Receipt,
} from "./service";
const storageKey = "vanta.order-attempt.v1";
/** Persist only capability + variant IDs/quantities/expected prices + demo choices. Never contact. */
export function useDemoOrder(
  service: OrderService,
  onSuccess: (r: Receipt, p: OrderPayload) => void,
) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [recoverable, setRecoverable] = useState(() => {
    try {
      return Boolean(sessionStorage.getItem(storageKey));
    } catch {
      return false;
    }
  });
  const inFlight = useRef(false);
  const attempt = useRef<Attempt | null>(null);
  async function confirm(payload: OrderPayload | null, challenge: string) {
    if (inFlight.current) return;
    setError("");
    inFlight.current = true;
    setPending(true);
    try {
      if (!attempt.current) {
        try {
          const raw = sessionStorage.getItem(storageKey);
          const recovered = readAttempt(raw);
          if (raw && !recovered) throw new Error("STORAGE");
          if (!recovered && !validPayload(payload))
            throw new Error("INVALID_REQUEST");
          attempt.current = recovered ?? newAttempt(payload!);
          sessionStorage.setItem(storageKey, JSON.stringify(attempt.current));
          setRecoverable(true);
        } catch (e) {
          if (e instanceof Error && e.message === "INVALID_REQUEST") throw e;
          throw new Error("STORAGE");
        }
      }
      const a = attempt.current;
      const r = receipt(await service.confirm(a, challenge));
      if (["expired", "cancelled"].includes(r.status))
        throw new Error("EXPIRED");
      // Call only after a validated server receipt. Never mark uncertain network results as success.
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* No personal data; completed attempt can safely replay. */
      }
      attempt.current = null;
      setRecoverable(false);
      onSuccess(r, a.payload);
    } catch (e) {
      const code =
        e instanceof Error && Object.hasOwn(orderMessages, e.message)
          ? e.message
          : "UNAVAILABLE";
      if (
        [
          "PRICE_CHANGED",
          "INSUFFICIENT_STOCK",
          "PRODUCT_UNAVAILABLE",
          "INVALID_REQUEST",
          "DEMO_CAPACITY",
          "EXPIRED",
        ].includes(code)
      ) {
        attempt.current = null;
        setRecoverable(false);
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* keep UI available */
        }
      }
      setError(orderMessages[code]);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return {
    pending,
    error,
    recoverable,
    confirm,
    recover: () => confirm(null, ""),
  };
}
