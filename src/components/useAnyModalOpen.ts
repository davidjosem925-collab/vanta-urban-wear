import { useSyncExternalStore } from "react";

function subscribe(update: () => void) {
  const observer = new MutationObserver(update);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["open", "aria-modal", "hidden"],
  });
  return () => observer.disconnect();
}
export function useAnyModalOpen() {
  return useSyncExternalStore(
    subscribe,
    () =>
      Boolean(
        document.querySelector(
          'dialog[open], [role="dialog"][aria-modal="true"]:not([hidden])',
        ),
      ),
    () => false,
  );
}
