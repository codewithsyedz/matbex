/**
 * Emergency kiosk-unlock PIN.
 *
 * The PIN is never stored anywhere in clear text. We keep a PBKDF2-SHA256
 * hash (per-restaurant random salt) in the database and mirror it into
 * localStorage so a tablet can verify the PIN with **no internet at all**.
 *
 * Offline verification is inherently brute-forceable, so we defend with:
 *  - a 6+ digit PIN minimum,
 *  - 150k PBKDF2 iterations (slow per guess),
 *  - a local attempt counter that locks entry for 15 minutes after 5 misses.
 */

export interface KioskPinMaterial {
  pin_hash: string;
  pin_salt: string;
  iterations: number;
  rotated_at?: string | null;
}

export const KIOSK_PIN_MIN_LENGTH = 6;
export const KIOSK_PIN_ITERATIONS = 150_000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const cacheKey = (restaurantId: string) => `matbex.kiosk.pin.${restaurantId}`;
const attemptsKey = (restaurantId: string) => `matbex.kiosk.pin.attempts.${restaurantId}`;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

function fromBase64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function generateSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toBase64(bytes);
}

/** PBKDF2-SHA256 hash of a PIN, returned base64-encoded. */
export async function hashPin(
  pin: string,
  salt: string,
  iterations: number = KIOSK_PIN_ITERATIONS,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Secure crypto is unavailable on this device");
  const key = await subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", salt: fromBase64(salt) as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

export function validatePinFormat(pin: string): string | null {
  if (!/^\d+$/.test(pin)) return "PIN must contain digits only";
  if (pin.length < KIOSK_PIN_MIN_LENGTH)
    return `PIN must be at least ${KIOSK_PIN_MIN_LENGTH} digits`;
  if (pin.length > 12) return "PIN must be 12 digits or fewer";
  if (/^(\d)\1+$/.test(pin)) return "PIN cannot be the same digit repeated";
  return null;
}

/* ------------------------------ local cache ------------------------------ */

export function cachePinMaterial(restaurantId: string, material: KioskPinMaterial): void {
  try {
    localStorage.setItem(cacheKey(restaurantId), JSON.stringify(material));
  } catch {
    /* ignore */
  }
}

export function readCachedPinMaterial(restaurantId: string): KioskPinMaterial | null {
  try {
    const raw = localStorage.getItem(cacheKey(restaurantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as KioskPinMaterial;
    return parsed?.pin_hash && parsed?.pin_salt ? parsed : null;
  } catch {
    return null;
  }
}

export function clearCachedPinMaterial(restaurantId: string): void {
  try {
    localStorage.removeItem(cacheKey(restaurantId));
  } catch {
    /* ignore */
  }
}

/* ------------------------------- lockout -------------------------------- */

interface AttemptState {
  count: number;
  lockedUntil: number | null;
}

function readAttempts(restaurantId: string): AttemptState {
  try {
    const raw = localStorage.getItem(attemptsKey(restaurantId));
    if (!raw) return { count: 0, lockedUntil: null };
    const parsed = JSON.parse(raw) as AttemptState;
    return { count: parsed.count ?? 0, lockedUntil: parsed.lockedUntil ?? null };
  } catch {
    return { count: 0, lockedUntil: null };
  }
}

function writeAttempts(restaurantId: string, state: AttemptState) {
  try {
    localStorage.setItem(attemptsKey(restaurantId), JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function getLockoutRemainingMs(restaurantId: string): number {
  const { lockedUntil } = readAttempts(restaurantId);
  if (!lockedUntil) return 0;
  return Math.max(0, lockedUntil - Date.now());
}

export function attemptsRemaining(restaurantId: string): number {
  return Math.max(0, MAX_ATTEMPTS - readAttempts(restaurantId).count);
}

export function resetAttempts(restaurantId: string): void {
  writeAttempts(restaurantId, { count: 0, lockedUntil: null });
}

export type PinVerifyResult =
  | { ok: true }
  | { ok: false; reason: "no_pin" | "locked" | "wrong" | "error"; message: string; retryInMs?: number };

/**
 * Verifies a PIN entirely offline against the cached hash and applies the
 * local lockout policy.
 */
export async function verifyPinOffline(
  restaurantId: string,
  pin: string,
): Promise<PinVerifyResult> {
  const remaining = getLockoutRemainingMs(restaurantId);
  if (remaining > 0) {
    return {
      ok: false,
      reason: "locked",
      retryInMs: remaining,
      message: `Too many wrong attempts. Try again in ${Math.ceil(remaining / 60000)} min.`,
    };
  }

  const material = readCachedPinMaterial(restaurantId);
  if (!material) {
    return {
      ok: false,
      reason: "no_pin",
      message:
        "No emergency PIN is stored on this tablet. Connect once while online so the PIN can be cached.",
    };
  }

  let candidate: string;
  try {
    candidate = await hashPin(pin, material.pin_salt, material.iterations || KIOSK_PIN_ITERATIONS);
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof Error ? e.message : String(e) };
  }

  if (candidate === material.pin_hash) {
    resetAttempts(restaurantId);
    return { ok: true };
  }

  const state = readAttempts(restaurantId);
  const count = state.count + 1;
  const locked = count >= MAX_ATTEMPTS;
  writeAttempts(restaurantId, {
    count: locked ? 0 : count,
    lockedUntil: locked ? Date.now() + LOCKOUT_MS : null,
  });

  return locked
    ? {
        ok: false,
        reason: "locked",
        retryInMs: LOCKOUT_MS,
        message: "Too many wrong attempts. PIN entry is locked for 15 minutes.",
      }
    : {
        ok: false,
        reason: "wrong",
        message: `Incorrect PIN. ${MAX_ATTEMPTS - count} attempt${
          MAX_ATTEMPTS - count === 1 ? "" : "s"
        } left.`,
      };
}

/* --------------------------- offline audit queue -------------------------- */

export interface QueuedUnlockEvent {
  restaurant_id: string;
  tenant_id: string | null;
  terminal_id: string;
  reason: string | null;
  succeeded: boolean;
  occurred_at: string;
  platform: string | null;
}

const QUEUE_KEY = "matbex.kiosk.unlock.queue";

export function queueUnlockEvent(event: QueuedUnlockEvent): void {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const list = raw ? (JSON.parse(raw) as QueuedUnlockEvent[]) : [];
    list.push(event);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(-50)));
  } catch {
    /* ignore */
  }
}

export function takeQueuedUnlockEvents(): QueuedUnlockEvent[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    localStorage.removeItem(QUEUE_KEY);
    return JSON.parse(raw) as QueuedUnlockEvent[];
  } catch {
    return [];
  }
}
