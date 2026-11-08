/**
 * Per-staff till PIN.
 *
 * Each staff member gets a PBKDF2-SHA256 hashed PIN (per-user random salt).
 * The hashes are mirrored into localStorage so a paired terminal can identify
 * the person at the till with **no internet at all**.
 *
 * Brute force defences mirror the kiosk PIN: 4+ digits minimum, 150k PBKDF2
 * iterations, and a local attempt counter that locks entry for 5 minutes
 * after 5 consecutive misses.
 */

import { generateSalt, hashPin, KIOSK_PIN_ITERATIONS } from "@/lib/kioskPin";

export interface StaffPinRecord {
  user_id: string;
  display_name: string;
  pin_hash: string;
  pin_salt: string;
  iterations: number;
}

export const STAFF_PIN_MIN_LENGTH = 4;
export const STAFF_PIN_MAX_LENGTH = 8;
export const STAFF_PIN_ITERATIONS = KIOSK_PIN_ITERATIONS;

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

const rosterKey = (restaurantId: string) => `matbex.till.pins.${restaurantId}`;
const attemptsKey = (restaurantId: string) => `matbex.till.pins.attempts.${restaurantId}`;

export { generateSalt, hashPin };

export function validateStaffPinFormat(pin: string): string | null {
  if (!/^\d+$/.test(pin)) return "PIN must contain digits only";
  if (pin.length < STAFF_PIN_MIN_LENGTH)
    return `PIN must be at least ${STAFF_PIN_MIN_LENGTH} digits`;
  if (pin.length > STAFF_PIN_MAX_LENGTH)
    return `PIN must be ${STAFF_PIN_MAX_LENGTH} digits or fewer`;
  if (/^(\d)\1+$/.test(pin)) return "PIN cannot be the same digit repeated";
  if (pin === "1234" || pin === "0000") return "Choose a less predictable PIN";
  return null;
}

/* ------------------------------ local roster ----------------------------- */

export function cacheStaffPins(restaurantId: string, roster: StaffPinRecord[]): void {
  try {
    localStorage.setItem(rosterKey(restaurantId), JSON.stringify(roster));
  } catch {
    /* ignore */
  }
}

export function readCachedStaffPins(restaurantId: string): StaffPinRecord[] {
  try {
    const raw = localStorage.getItem(rosterKey(restaurantId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StaffPinRecord[]) : [];
  } catch {
    return [];
  }
}

export function clearCachedStaffPins(restaurantId: string): void {
  try {
    localStorage.removeItem(rosterKey(restaurantId));
  } catch {
    /* ignore */
  }
}

/* -------------------------------- lockout -------------------------------- */

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

function writeAttempts(restaurantId: string, state: AttemptState): void {
  try {
    localStorage.setItem(attemptsKey(restaurantId), JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/** Milliseconds remaining on the local lockout, or 0 when entry is allowed. */
export function lockoutRemainingMs(restaurantId: string): number {
  const { lockedUntil } = readAttempts(restaurantId);
  if (!lockedUntil) return 0;
  return Math.max(0, lockedUntil - Date.now());
}

function registerMiss(restaurantId: string): void {
  const state = readAttempts(restaurantId);
  const count = state.count + 1;
  writeAttempts(restaurantId, {
    count: count >= MAX_ATTEMPTS ? 0 : count,
    lockedUntil: count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : null,
  });
}

function clearAttempts(restaurantId: string): void {
  writeAttempts(restaurantId, { count: 0, lockedUntil: null });
}

/* ------------------------------ verification ----------------------------- */

export interface StaffPinVerification {
  ok: boolean;
  staff?: { user_id: string; display_name: string };
  /** Set when the device is locked out; milliseconds left. */
  lockedForMs?: number;
  error?: string;
}

/**
 * Match a typed PIN against the cached roster. Works fully offline.
 * When `expectUserId` is given only that person's PIN is accepted.
 */
export async function verifyStaffPin(
  restaurantId: string,
  pin: string,
  expectUserId?: string | null,
): Promise<StaffPinVerification> {
  const locked = lockoutRemainingMs(restaurantId);
  if (locked > 0) return { ok: false, lockedForMs: locked, error: "Too many attempts" };

  const roster = readCachedStaffPins(restaurantId).filter(
    (r) => !expectUserId || r.user_id === expectUserId,
  );
  if (roster.length === 0) {
    return { ok: false, error: "No till PIN is set up on this device yet" };
  }

  for (const record of roster) {
    try {
      const hash = await hashPin(pin, record.pin_salt, record.iterations || STAFF_PIN_ITERATIONS);
      if (hash === record.pin_hash) {
        clearAttempts(restaurantId);
        return {
          ok: true,
          staff: { user_id: record.user_id, display_name: record.display_name },
        };
      }
    } catch {
      return { ok: false, error: "This device cannot verify PINs securely" };
    }
  }

  registerMiss(restaurantId);
  const stillLocked = lockoutRemainingMs(restaurantId);
  return {
    ok: false,
    lockedForMs: stillLocked || undefined,
    error: stillLocked ? "Too many attempts" : "Incorrect PIN",
  };
}
