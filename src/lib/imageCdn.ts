/**
 * Image CDN URL normalization.
 *
 * Menu item images are stored in backend storage and served from a
 * host like `https://api.matbex.com/storage/v1/object/public/menu-images/...`.
 * To serve them through our own domain (e.g. https://cdn.matbex.com) via a
 * Cloudflare Worker / reverse proxy, we rewrite only the origin and keep the
 * rest of the path (including query strings used for image transforms).
 *
 * The CDN origin is configurable via `VITE_STORAGE_CDN_HOST` and defaults to
 * https://cdn.matbex.com. URLs that are not backend-storage public URLs are
 * returned unchanged, so the helper is safe to apply to any image URL and is
 * idempotent (CDN URLs pass through untouched).
 */

const CDN_HOST =
  (import.meta.env.VITE_STORAGE_CDN_HOST as string | undefined)?.replace(/\/+$/, "") ||
  "https://cdn.matbex.com";

// Matches `<API_URL>/storage/v1/object/public/...` (and legacy hosted-storage
// URLs still stored in old rows), capturing the path + query so we can
// re-host it on the CDN origin.
const STORAGE_PUBLIC_RE =
  /^https?:\/\/[^/]+(\/storage\/v1\/object\/public\/.*)$/i;

/**
 * Rewrite a backend storage public URL to the CDN origin. Non-matching URLs
 * (already-CDN, relative, data:, external) are returned untouched.
 */
export function toCdnUrl(url?: string | null): string | null | undefined {
  if (!url || typeof url !== "string") return url;
  const match = url.match(STORAGE_PUBLIC_RE);
  if (!match) return url;
  return `${CDN_HOST}${match[1]}`;
}
