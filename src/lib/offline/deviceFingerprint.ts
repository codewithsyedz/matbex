// Stable per-device fingerprint used as a server-side dedup key so a single
// physical browser/device always maps to the same licensed seat, even when
// IndexedDB + localStorage + cookies all get wiped and the terminal_id is
// regenerated. Intentionally coarse-grained: shared by all incognito windows
// of the same browser install, which is the behavior we want for seat usage.

let cached: string | null = null;

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getDeviceFingerprint(): Promise<string> {
  if (cached) return cached;
  if (typeof navigator === "undefined") return "";
  const parts: string[] = [
    navigator.userAgent || "",
    navigator.platform || "",
    navigator.language || "",
    (navigator.languages || []).join(","),
    String(navigator.hardwareConcurrency ?? ""),
    String((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? ""),
    typeof screen !== "undefined"
      ? `${screen.width}x${screen.height}x${screen.colorDepth}`
      : "",
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
  ];
  cached = await sha256Hex(parts.join("|"));
  return cached;
}