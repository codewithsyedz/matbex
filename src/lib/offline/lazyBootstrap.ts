// =====================================================================
// Lazy offline bootstrap
// ---------------------------------------------------------------------
// The full offline stack (IndexedDB, SW registration, sync engine,
// connectivity polling) is heavy. We only want to pay for it when the
// user actually needs offline mode - i.e. they open the Sync Center,
// the POS, the Terminals page, the Audit Report, OR the browser fires
// an `offline` event.
//
// This module is intentionally tiny so it can be imported eagerly
// without dragging the rest of the offline code into the main bundle.
// =====================================================================

let started: Promise<void> | null = null;
let lastBranchId: string | null = null;

/**
 * Switch the active branch on the already-running engine. We chain on
 * `started` so the update lands AFTER `bootstrapOffline()` has finished
 * - otherwise a fast second call could race the boot and clobber the
 * branch id back to the original value.
 */
function applyBranchChange(branchId: string | null) {
  if (!started) return;
  void started
    .then(() => import("./index"))
    .then((m) => m.setOfflineBranchId(branchId));
}

/**
 * Boot the offline layer on demand. Subsequent calls are no-ops, but a
 * changed branch id will be propagated to the already-running engine.
 */
export function ensureOfflineBootstrapped(branchId: string | null): Promise<void> {
  if (started) {
    // Allow null → switch back to "no active branch" too. We compare
    // strictly so toggling between branches is always honoured.
    if (branchId !== lastBranchId) {
      lastBranchId = branchId;
      applyBranchChange(branchId);
    }
    return started;
  }
  lastBranchId = branchId;
  started = import("./index").then((m) => m.bootstrapOffline(branchId));
  return started;
}

/**
 * Update the active branch id ONLY if the offline engine has already been
 * booted. Used by header/auth changes so we don't pay the boot cost for
 * users who never need offline mode.
 */
export function updateBranchIfOfflineStarted(branchId: string | null) {
  if (!started) return;
  if (branchId === lastBranchId) return;
  lastBranchId = branchId;
  applyBranchChange(branchId);
}

/**
 * Install a one-shot listener: if the browser ever reports it has gone
 * offline, eagerly boot the offline layer so we can queue work. This is
 * cheap because it only attaches a listener - no offline code is loaded
 * unless the event actually fires.
 */
export function armOfflineAutoBootstrap(getBranchId: () => string | null) {
  if (typeof window === "undefined") return () => {};
  const onOffline = () => {
    void ensureOfflineBootstrapped(getBranchId());
  };
  window.addEventListener("offline", onOffline);
  // If we're already offline at mount time, boot immediately.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    onOffline();
  }
  return () => window.removeEventListener("offline", onOffline);
}