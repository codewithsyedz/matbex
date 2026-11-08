// Terminal identity: stable per-device UUID + sequence counter for receipt numbers.

import { kvGet, kvSet } from "./db";

const KEY_TERMINAL = "pos.terminal_id";
const KEY_SEQ = "pos.local_seq";
const LS_KEY = "matbex.pos.terminal_id";
const COOKIE_KEY = "matbex_terminal_id";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 5; // 5 years

function readLocalStorage(): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
  } catch {
    return null;
  }
}
function writeLocalStorage(id: string) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(LS_KEY, id);
  } catch {
    /* ignore */
  }
}
function readCookie(): string | null {
  try {
    if (typeof document === "undefined") return null;
    const m = document.cookie.match(
      new RegExp("(?:^|; )" + COOKIE_KEY + "=([^;]+)"),
    );
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}
function writeCookie(id: string) {
  try {
    if (typeof document === "undefined") return;
    const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${COOKIE_KEY}=${encodeURIComponent(id)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
  } catch {
    /* ignore */
  }
}

async function readIndexedDB(): Promise<string | null> {
  try {
    return (await kvGet<string>(KEY_TERMINAL)) ?? null;
  } catch {
    return null;
  }
}
async function writeIndexedDB(id: string) {
  try {
    await kvSet(KEY_TERMINAL, id);
  } catch {
    /* ignore */
  }
}

/**
 * Persist the terminal id to every layer we have. The same physical device
 * may have any subset of these wiped (incognito sweeps, IndexedDB eviction,
 * cookie clear), so we always reconcile across all three: IndexedDB,
 * localStorage, and a long-lived first-party cookie.
 */
async function persistEverywhere(id: string) {
  writeLocalStorage(id);
  writeCookie(id);
  await writeIndexedDB(id);
}

export async function getTerminalId(): Promise<string> {
  // Prefer the first surviving id across all layers. Order: IndexedDB
  // (richest, survives browser restarts), then localStorage, then cookie.
  const fromIdb = await readIndexedDB();
  const fromLs = readLocalStorage();
  const fromCookie = readCookie();
  const existing = fromIdb || fromLs || fromCookie;

  if (existing) {
    // Heal any layer that was missing so a future wipe of one store does
    // not orphan this device into a brand-new seat.
    if (existing !== fromIdb) await writeIndexedDB(existing);
    if (existing !== fromLs) writeLocalStorage(existing);
    if (existing !== fromCookie) writeCookie(existing);
    return existing;
  }

  const id = crypto.randomUUID();
  await persistEverywhere(id);
  return id;
}

/** Reset this device's terminal UID - used when re-registering after revocation. */
export async function regenerateTerminalId(): Promise<string> {
  const id = crypto.randomUUID();
  await persistEverywhere(id);
  return id;
}

export async function nextLocalSequence(): Promise<number> {
  const cur = (await kvGet<number>(KEY_SEQ)) ?? 0;
  const next = cur + 1;
  await kvSet(KEY_SEQ, next);
  return next;
}

/** Generates an offline receipt number: TER-<short>-<yyyyMMdd>-<seq>. */
export async function generateLocalReceiptNumber(now = new Date()): Promise<string> {
  const tid = await getTerminalId();
  const seq = await nextLocalSequence();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `OFF-${tid.slice(0, 6).toUpperCase()}-${ymd}-${String(seq).padStart(4, "0")}`;
}

/** Stable idempotency key per offline record: terminal + entity + local_id. */
export function buildIdempotencyKey(terminalId: string, entity: string, localId: string): string {
  return `${terminalId}:${entity}:${localId}`;
}