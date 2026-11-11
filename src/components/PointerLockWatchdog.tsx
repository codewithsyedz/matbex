import { useEffect } from "react";

/**
 * Global watchdog that detects when <body> is left with `pointer-events: none`
 * (typically by a Radix Popover/Dialog that closed mid-unmount while the page
 * was busy), restores interactivity, and logs the cause for debugging.
 *
 * The lock is considered "stuck" if it persists for longer than STUCK_MS while
 * no Radix overlay (`[data-state="open"]` on dialog/popover/dropdown) is
 * actually mounted in the DOM.
 */
const STUCK_MS = 500;
const OVERLAY_SELECTOR =
  '[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"], [data-state="open"][data-radix-portal], [data-radix-focus-guard]';

export const PointerLockWatchdog = () => {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let stuckSince: number | null = null;
    let rafId: number | null = null;

    const release = (reason: string) => {
      const body = document.body;
      const prevInline = body.style.pointerEvents;
      const prevLocked = body.getAttribute("data-scroll-locked");
      body.style.pointerEvents = "";
      body.removeAttribute("data-scroll-locked");
       
      console.warn(
        "[PointerLockWatchdog] Restored interactivity:",
        {
          reason,
          previousInlinePointerEvents: prevInline,
          previousDataScrollLocked: prevLocked,
          activeElement: document.activeElement?.tagName,
          openOverlays: document.querySelectorAll(OVERLAY_SELECTOR).length,
          url: window.location.pathname,
        },
      );
    };

    const check = () => {
      const body = document.body;
      const inline = body.style.pointerEvents;
      const computed = window.getComputedStyle(body).pointerEvents;
      const isLocked = inline === "none" || computed === "none";
      const hasOverlay = document.querySelector(OVERLAY_SELECTOR) !== null;

      if (isLocked && !hasOverlay) {
        if (stuckSince === null) {
          stuckSince = performance.now();
        } else if (performance.now() - stuckSince > STUCK_MS) {
          release(
            `body pointer-events was 'none' for >${STUCK_MS}ms with no open Radix overlay`,
          );
          stuckSince = null;
        }
      } else {
        stuckSince = null;
      }
    };

    const interval = window.setInterval(check, 250);

    // Re-check immediately on common "something just closed" signals.
    const onActivity = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        check();
      });
    };

    window.addEventListener("pointerup", onActivity, true);
    window.addEventListener("keyup", onActivity, true);
    window.addEventListener("focus", onActivity, true);

    return () => {
      window.clearInterval(interval);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.removeEventListener("pointerup", onActivity, true);
      window.removeEventListener("keyup", onActivity, true);
      window.removeEventListener("focus", onActivity, true);
    };
  }, []);

  return null;
};

export default PointerLockWatchdog;