const APP_SW_URL = "/sw.js";

/**
 * Reload into the latest deployed version. After a deploy, the old build's lazy chunks are gone
 * (404), and the app-shell worker still serves its precached old index.html, so a plain reload
 * comes back to the same old page and fails again. Ask the worker to update first and wait (up to
 * `timeoutMs`) for the new one to take control (skipWaiting + clientsClaim), then reload.
 */
export async function reloadToLatestVersion(timeoutMs = 5000): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const reg = registrations.find((r) =>
        (r.active?.scriptURL ?? r.waiting?.scriptURL ?? r.installing?.scriptURL ?? "").endsWith(APP_SW_URL),
      );
      if (reg) {
        const changed = new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, timeoutMs);
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
        await reg.update();
        if (reg.installing || reg.waiting) await changed;
      }
    }
  } catch {
    // Fall through to a plain reload.
  }
  window.location.reload();
}
