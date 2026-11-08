// =====================================================================
// Canonical JSON + SHA-256 checksum for offline records.
// ---------------------------------------------------------------------
// The checksum is stored on every OfflineRecord and re-verified on read;
// a mismatch quarantines the row in `failed_sync_items`.
// Canonicalisation:
//   - object keys are sorted lexicographically at every depth
//   - arrays keep insertion order
//   - `undefined` values are dropped (JSON.stringify already does this)
//   - the result is a plain UTF-8 string fed to crypto.subtle.digest
// =====================================================================

/** Deterministic JSON serialisation with sorted object keys. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[k];
    if (v === undefined) continue;
    out[k] = sortKeys(v);
  }
  return out;
}

function toHex(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < view.length; i++) s += view[i].toString(16).padStart(2, "0");
  return s;
}

/** SHA-256 hex of the canonicalised payload. */
export async function computeChecksum(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(digest);
}

/** Verify a stored checksum against the current payload. */
export async function verifyChecksum(payload: unknown, expected: string): Promise<boolean> {
  const actual = await computeChecksum(payload);
  return actual === expected;
}