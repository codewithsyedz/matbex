// =====================================================================
// Offline image cache
// ---------------------------------------------------------------------
// Uses the Cache Storage API (available even without a Service Worker
// fetch handler) to keep menu / product images available offline.
//
// Flow:
//   - prefetchImages([...urls]) is called whenever the menu list loads
//     while online; each URL is fetched and stored in cache 'matbex-images-v1'.
//   - getCachedImageSrc(url) returns an object URL backed by the cached
//     blob if present, otherwise the original URL. Components call this
//     once per src and revoke the object URL on unmount.
// =====================================================================

const CACHE_NAME = "matbex-images-v1";

function cachesAvailable(): boolean {
  return typeof caches !== "undefined";
}

/** Prefetch a batch of image URLs into the offline cache. Best-effort: failures are swallowed. */
export async function prefetchImages(urls: Array<string | null | undefined>): Promise<void> {
  if (!cachesAvailable()) return;
  const list = Array.from(new Set(urls.filter((u): u is string => !!u)));
  if (list.length === 0) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(
      list.map(async (url) => {
        try {
          const existing = await cache.match(url);
          if (existing) return;
          // no-cors so cross-origin (object storage) responses can still be stored as opaque
          const res = await fetch(url, { mode: "no-cors" });
          await cache.put(url, res);
        } catch {
          /* ignore individual failures */
        }
      }),
    );
  } catch {
    /* ignore */
  }
}

/**
 * Returns a usable src for the given URL. If the URL is in the offline
 * cache, returns an object URL (caller MUST revoke it). Otherwise returns
 * the original URL unchanged.
 */
export async function getCachedImageSrc(
  url: string,
): Promise<{ src: string; revoke?: () => void }> {
  if (!cachesAvailable()) return { src: url };
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (!hit) return { src: url };
    const blob = await hit.blob();
    if (!blob || blob.size === 0) return { src: url };
    const obj = URL.createObjectURL(blob);
    return { src: obj, revoke: () => URL.revokeObjectURL(obj) };
  } catch {
    return { src: url };
  }
}

/** Add a single URL to the cache opportunistically (e.g. after a successful render). */
export async function rememberImage(url: string): Promise<void> {
  if (!cachesAvailable() || !url) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    const existing = await cache.match(url);
    if (existing) return;
    const res = await fetch(url, { mode: "no-cors" });
    await cache.put(url, res);
  } catch {
    /* ignore */
  }
}