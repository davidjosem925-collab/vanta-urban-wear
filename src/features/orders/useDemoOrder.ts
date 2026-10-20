import { useRef, useState } from "react";
import {
  newAttempt,
  OrderRequestError,
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
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const attempt = useRef<Attempt | null>(null);
  async function perform(
    payload: OrderPayload | null,
    challenge: string,
    queryOnly: boolean,
  ) {
    if (inFlight.current) return;
    setError("");
    setNotice("");
    if (!queryOnly && !challenge.trim()) {
      setError(orderMessages.CHALLENGE_REQUIRED);
      return;
    }
    inFlight.current = true;
    setPending(true);
    try {
      if (!attempt.current) {
        try {
          const raw = sessionStorage.getItem(storageKey);
          const recovered = readAttempt(raw);
          if (raw && !recovered) throw new Error("STORAGE");
          if (!recovered && queryOnly) {
            setRecoverable(false);
            setNotice(
              "No hay un intento pendiente. Revisá la selección para confirmar.",
            );
            return;
          }
          if (!recovered && !validPayload(payload))
            throw new Error("INVALID_REQUEST");
          attempt.current = recovered ?? newAttempt(payload!);
          sessionStorage.setItem(storageKey, JSON.stringify(attempt.current));
          setRecoverable(false);
        } catch (e) {
          if (e instanceof Error && e.message === "INVALID_REQUEST") throw e;
          throw new Error("STORAGE");
        }
      }
      const a = attempt.current;
      const result = queryOnly
        ? await service.recover(a)
        : await service.confirm(a, challenge);
      if (result === null) {
        // Keep identity/body even when absent: the original request may still commit.
        setRecoverable(false);
        setNotice(
          "Todavía no hay una confirmación registrada para este intento. Volvé a la revisión y completá una nueva verificación para retomar la selección original con la misma clave.",
        );
        return;
      }
      const r = receipt(result);
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
        code === "EXPIRED" ||
        (!queryOnly &&
          [
            "PRICE_CHANGED",
            "INSUFFICIENT_STOCK",
            "PRODUCT_UNAVAILABLE",
            "INVALID_REQUEST",
            "DEMO_CAPACITY",
            "EXPIRED",
          ].includes(code))
      ) {
        attempt.current = null;
        setRecoverable(false);
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* keep UI available */
        }
      }
      const uncertain = [
        "NETWORK_ERROR",
        "TIMEOUT_ERROR",
        "UNAVAILABLE",
        "INVALID_RESPONSE",
        "HTTP_REJECTED",
      ].includes(code);
      setRecoverable(uncertain && Boolean(attempt.current));
      setError(
        orderMessages[code] +
          (e instanceof OrderRequestError && e.status
            ? ` (HTTP ${e.status}).`
            : ""),
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return {
    pending,
    error,
    notice,
    recoverable,
    confirm: (payload: OrderPayload, challenge: string) =>
      perform(payload, challenge, false),
    recover: () => perform(null, "", true),
  };
}
