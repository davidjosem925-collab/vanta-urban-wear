import { useCallback, useEffect, useRef, useState } from "react";
export type EditorSection =
  | "general"
  | "fotos"
  | "talles"
  | "stock"
  | "revision";
export type AdminView = {
  area: "productos" | "stock" | "pedidos";
  id?: string;
  section: EditorSection;
  query: URLSearchParams;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function adminView(hash: string): AdminView {
  const [path, query] = hash.replace(/^#/, "").split("?");
  const [, root, area, id, section] = path.split("/");
  const fallback: AdminView = {
    area: "productos",
    section: "general",
    query: new URLSearchParams(query),
  };
  if (root !== "admin" || !["productos", "stock", "pedidos"].includes(area))
    return fallback;
  return {
    area: area as AdminView["area"],
    id:
      (id === "nuevo" && area === "productos") || uuid.test(id ?? "")
        ? id
        : undefined,
    section:
      area === "stock"
        ? "stock"
        : ["general", "fotos", "talles", "stock", "revision"].includes(section)
          ? (section as EditorSection)
          : "general",
    query: new URLSearchParams(query),
  };
}
function context(hash: string) {
  const v = adminView(hash);
  return v.id && v.area !== "pedidos" ? `${v.area}/${v.id}` : hash;
}
export function useAdminNavigation() {
  const [hash, setHash] = useState(location.hash);
  const previous = useRef(location.hash),
    dirty = useRef(false),
    position = useRef(0),
    returning = useRef(false),
    approvedTarget = useRef<string | null>(null);
  const setDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  useEffect(() => {
    const readPosition = () => {
      const n = history.state?.vantaAdminPosition;
      return Number.isInteger(n) && n >= 0 && n <= 1000000
        ? (n as number)
        : null;
    };
    position.current = readPosition() ?? 0;
    history.replaceState(
      { ...history.state, vantaAdminPosition: position.current },
      "",
      location.href,
    );
    function approve(target: string) {
      if (context(target) === context(previous.current)) return true;
      const inFlight = Boolean(
        document.querySelector('[data-admin-saving="true"]'),
      );
      if (!dirty.current && !inFlight) return true;
      if (
        !window.confirm(
          inFlight
            ? "Hay una operación en curso. Si salís, puede completarse igual. ¿Querés continuar?"
            : "Tenés cambios sin guardar. ¿Querés descartarlos y continuar?",
        )
      )
        return false;
      dirty.current = false;
      return true;
    }
    function click(e: MouseEvent) {
      const link = (e.target as Element).closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (
        !link ||
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        link.target === "_blank"
      )
        return;
      const url = new URL(link.href);
      if (
        url.origin !== location.origin ||
        url.pathname !== location.pathname
      ) {
        if (dirty.current && !approve(url.href)) e.preventDefault();
      } else if (url.hash !== location.hash) {
        if (!approve(url.hash)) e.preventDefault();
        else approvedTarget.current = url.hash;
      }
    }
    function change(e: HashChangeEvent) {
      const target = location.hash,
        incoming = readPosition();
      const alreadyApproved = approvedTarget.current === target;
      approvedTarget.current = null;
      if (returning.current) {
        returning.current = false;
      } else if (!alreadyApproved && !approve(target)) {
        // Run before the public router: cancelling must not unmount the editor.
        e.stopImmediatePropagation();
        if (incoming !== null && incoming !== position.current) {
          returning.current = true;
          history.go(position.current - incoming);
        } else {
          // An older/untracked entry has no safe traversal delta.
          history.replaceState(
            { ...history.state, vantaAdminPosition: position.current },
            "",
            previous.current,
          );
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        }
        return;
      }
      position.current = incoming ?? position.current + 1;
      history.replaceState(
        { ...history.state, vantaAdminPosition: position.current },
        "",
        target,
      );
      previous.current = target;
      setHash(target);
    }
    function unload(e: BeforeUnloadEvent) {
      if (
        dirty.current ||
        document.querySelector('[data-admin-saving="true"]')
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("hashchange", change, true);
    document.addEventListener("click", click, true);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("hashchange", change, true);
      document.removeEventListener("click", click, true);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  const navigate = useCallback((target: string, replace = false) => {
    if (replace) {
      // A confirmed save replaces its creation URL; no unsaved operation is discarded.
      approvedTarget.current = target;
      history.replaceState(history.state, "", target);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } else location.hash = target;
  }, []);
  return { view: adminView(hash), navigate, setDirty };
}
