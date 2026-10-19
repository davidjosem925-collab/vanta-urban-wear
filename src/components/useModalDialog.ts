import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";

/** Native inert background plus explicit focus containment and scroll preservation. */
export function useModalDialog(open: boolean, fallbackSelector?: string) {
  const dialog = useRef<HTMLDialogElement>(null);
  const initialFocus = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current!;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const { scrollX, scrollY } = window;
    const overflow = document.body.style.overflow;
    const padding = document.body.style.paddingRight;
    const width = document.documentElement.clientWidth;
    const gutter = width > 0 ? window.innerWidth - width : 0;
    document.body.style.overflow = "hidden";
    if (gutter > 0)
      document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight || "0") + gutter}px`;
    element.showModal();
    initialFocus.current?.focus({ preventScroll: true });
    const restoreScroll = () => {
      if (window.scrollX !== scrollX || window.scrollY !== scrollY)
        window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
    };
    restoreScroll();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = padding;
      const restoreFocus = () => {
        if (previous?.isConnected) previous.focus({ preventScroll: true });
        if (
          (!previous?.isConnected ||
            previous === document.body ||
            document.activeElement !== previous) &&
          fallbackSelector
        )
          document
            .querySelector<HTMLElement>(fallbackSelector)
            ?.focus({ preventScroll: true });
      };
      // Floating triggers become visible after observers process dialog.close().
      // Wait one frame only for a hidden opener, then restore without scrolling.
      if (previous?.isConnected && previous.hidden)
        requestAnimationFrame(restoreFocus);
      else restoreFocus();
      restoreScroll();
    };
  }, [open, fallbackSelector]);
  return { dialog, initialFocus };
}
export function trapModalFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const controls = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      "a[href], button:not(:disabled), input:not(:disabled), [tabindex]",
    ),
  ].filter((node) => node.tabIndex >= 0 && node.getClientRects().length > 0);
  const first = controls[0];
  const last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first && last) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last && first) {
    event.preventDefault();
    first.focus();
  }
}
export function isDialogBackdrop(event: MouseEvent<HTMLDialogElement>) {
  if (event.target !== event.currentTarget) return false;
  const rect = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
}
