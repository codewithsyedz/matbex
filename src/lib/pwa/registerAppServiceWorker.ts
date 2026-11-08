/**
 * Single, guarded registrar for the app-shell service worker (/sw.js).
 *
 * NEVER registers in dev, inside an iframe, or on a preview host.
 * In those contexts (and with ?sw=off) it unregisters any existing /sw.js
 * registration so stale caches cannot serve deleted chunks.
 *
 * The POS sync worker (/sw-pos-sync.js) and push worker (/sw-push.js) are
 * separate registrations and are intentionally left untouched.
 */
const APP_SW_URL = "/sw.js";

function isPreviewHost(hostname: string): boolean {
  return (
    hostname.startsWith("id-preview--") ||
    hostname.startsWith("preview--") ||
    hostname.startsWith("preview.")
  );
}

function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

async function unregisterAppServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(
      registrations
        .filter((registration) => {
          const scriptURL =
            registration.active?.scriptURL ??
            registration.waiting?.scriptURL ??
            registration.installing?.scriptURL ??
            "";
          return scriptURL.endsWith(APP_SW_URL);
        })
        .map((registration) => registration.unregister()),
    );
  } catch {
    // Nothing actionable — never block app boot on SW cleanup.
  }
}

export async function registerAppServiceWorker(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  const killSwitch = new URLSearchParams(window.location.search).get("sw") === "off";
  const refused =
    !import.meta.env.PROD || isInIframe() || isPreviewHost(window.location.hostname) || killSwitch;

  if (refused) {
    await unregisterAppServiceWorker();
    return;
  }

  try {
    const { registerSW } = await import("virtual:pwa-register");
    registerSW({ immediate: true });
  } catch {
    // Offline caching is a progressive enhancement.
  }
}