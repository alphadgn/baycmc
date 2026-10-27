import { useEffect } from "react";

/**
 * Locks the document scroll for full-screen pages (lobby, chat rooms,
 * conference shell) so only their inner panels scroll.
 *
 * `overflow: hidden` alone is not enough on phones: when the keyboard opens
 * the browser scrolls the whole document to reveal the focused field, and
 * because scrolling is locked the user can never scroll back — the top bar
 * (menu button, wallet pill) stays pushed off-screen after the keyboard
 * closes. This hook snaps the document back to the top whenever it drifts
 * while no text field is focused.
 */
export function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    const nonText = ["checkbox", "radio", "range", "color", "button", "submit", "file", "reset"];
    return !nonText.includes(el.type);
  }
  return (el as HTMLElement).isContentEditable === true;
}

export function resetDocumentScroll(): void {
  if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
  const root = document.scrollingElement;
  if (root && root.scrollTop !== 0) root.scrollTop = 0;
}

export function useLockedPageScroll(): void {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
      bodyOverscroll: body.style.overscrollBehavior,
    };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";

    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };

    const snapIfIdle = () => {
      if (!isEditableElement(document.activeElement)) resetDocumentScroll();
    };

    const onFocusOut = () => {
      // Wait for the keyboard to finish closing (and for focus to land on
      // the next element) before restoring the page position.
      later(snapIfIdle, 50);
      later(snapIfIdle, 350);
    };

    const vv = window.visualViewport;
    let lastVvHeight = vv?.height ?? window.innerHeight;
    const onVvResize = () => {
      const h = vv?.height ?? window.innerHeight;
      if (h > lastVvHeight) later(snapIfIdle, 50);
      lastVvHeight = h;
    };

    resetDocumentScroll();
    window.addEventListener("scroll", snapIfIdle, { passive: true });
    window.addEventListener("focusout", onFocusOut);
    window.addEventListener("orientationchange", onFocusOut);
    vv?.addEventListener("resize", onVvResize);

    return () => {
      window.removeEventListener("scroll", snapIfIdle);
      window.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("orientationchange", onFocusOut);
      vv?.removeEventListener("resize", onVvResize);
      timers.forEach((id) => window.clearTimeout(id));
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
      html.style.overscrollBehavior = prev.htmlOverscroll;
      body.style.overscrollBehavior = prev.bodyOverscroll;
    };
  }, []);
}
