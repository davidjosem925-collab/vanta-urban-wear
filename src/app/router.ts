import { useEffect, useRef, useState } from "react";
export type Route =
  | { kind: "admin" }
  | { kind: "home" }
  | { kind: "catalog" }
  | { kind: "category"; slug: string }
  | { kind: "product"; slug: string }
  | { kind: "checkout"; step: "details" | "review" | "complete" }
  | { kind: "missing" };
export function parseRoute(hash: string): Route {
  try {
    const path = hash.replace(/^#/, "") || "/";
    if (/^\/admin(?:\/|\?|$)/.test(path)) return { kind: "admin" };
    if (path === "/") return { kind: "home" };
    if (path === "/catalogo") return { kind: "catalog" };
    if (path === "/checkout") return { kind: "checkout", step: "details" };
    if (path === "/checkout/revision")
      return { kind: "checkout", step: "review" };
    if (path === "/checkout/finalizado")
      return { kind: "checkout", step: "complete" };
    const match = path.match(/^\/(categoria|producto)\/([^/]+)$/);
    if (!match) return { kind: "missing" };
    const slug = decodeURIComponent(match[2]);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return { kind: "missing" };
    return { kind: match[1] === "categoria" ? "category" : "product", slug };
  } catch {
    return { kind: "missing" };
  }
}
export function useRoute() {
  const [hash, setHash] = useState(() =>
    new URLSearchParams(window.location.search).get("admin_recovery") === "1"
      ? "#/admin"
      : window.location.hash,
  );
  const previousHash = useRef(hash);
  useEffect(() => {
    function change() {
      setHash(window.location.hash);
    }
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (previousHash.current === hash) return;
    previousHash.current = hash;
    document.getElementById("contenido")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [hash]);
  return { route: parseRoute(hash), routeKey: hash };
}
