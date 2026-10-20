import { useEffect, useRef, useState } from "react";
type Turnstile = {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
let loading: Promise<void> | undefined;
function load() {
  if (window.turnstile) return Promise.resolve();
  if (!loading)
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        loading = undefined;
        script.remove();
        reject(new Error("challenge"));
      };
      document.head.append(script);
    });
  return loading;
}
export function OrderChallenge({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken(token: string): void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let id: string | undefined;
    void load()
      .then(() => {
        if (active && el.current && window.turnstile)
          id = window.turnstile.render(el.current, {
            sitekey: siteKey,
            action: "demo-order",
            theme: "dark",
            size: "flexible",
            callback: (token: string) => onToken(token),
            "expired-callback": () => onToken(""),
            "error-callback": () => {
              onToken("");
              setFailed(true);
            },
          });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [siteKey, onToken]);
  return (
    <div className="checkout-challenge">
      <div ref={el} />
      {failed && (
        <p role="alert">
          No pudimos cargar la verificación. Revisá tu conexión y volvé a abrir
          la revisión.
        </p>
      )}
    </div>
  );
}
