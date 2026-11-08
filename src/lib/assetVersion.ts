/**
 * Cache-busting version for static brand assets (favicon, manifest icons).
 * Keep in sync with the `?v=` values in index.html and public/manifest.webmanifest.
 */
export const ASSET_VERSION = "20260814";

/** Append a stable version token to an asset URL (no-op for empty values). */
export function withAssetVersion(url: string | null | undefined, version: string = ASSET_VERSION) {
  if (!url) return url ?? "";
  const [base, hash = ""] = url.split("#");
  const sep = base.includes("?") ? "&" : "?";
  const versioned = /[?&]v=/.test(base) ? base.replace(/([?&]v=)[^&]*/, `$1${version}`) : `${base}${sep}v=${version}`;
  return hash ? `${versioned}#${hash}` : versioned;
}

/** Version token that changes on every call — use right after uploading a new asset. */
export function freshAssetVersion() {
  return `${ASSET_VERSION}-${Date.now()}`;
}
