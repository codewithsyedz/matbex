// =====================================================================
// Monotonic Lamport clock per device.
// ---------------------------------------------------------------------
// Persisted in the `kv` store so it survives reload and is never reset.
// Only guarantee: strictly increasing within a single device. Combined
// with the device_id (from terminal.ts) this gives us a global version
// vector { device, lamport } that the server uses to detect concurrent
// writes (see docs/architecture/offline-first-pos.md §9).
// =====================================================================

import { kvGet, kvSet } from "./db";

const KEY = "pos.lamport";

// In-memory cache so back-to-back writes don't race on IDB round-trips.
let _current: number | null = null;
let _initPromise: Promise<void> | null = null;

async function init(): Promise<void> {
  if (_current !== null) return;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const stored = await kvGet<number>(KEY);
    _current = typeof stored === "number" && Number.isFinite(stored) ? stored : 0;
  })();
  return _initPromise;
}

/** Return the next lamport tick and persist it. Strictly monotonic. */
export async function nextLamport(): Promise<number> {
  await init();
  // Increment + capture BEFORE the async persist so concurrent callers each
  // see their own tick (otherwise they'd all return the final _current).
  const tick = (_current ?? 0) + 1;
  _current = tick;
  await kvSet(KEY, tick);
  return tick;
}

/** Peek without incrementing — for diagnostics only. */
export async function currentLamport(): Promise<number> {
  await init();
  return _current ?? 0;
}

/** Test-only reset. Not exported from the barrel. */
export function __resetLamportForTests(): void {
  _current = null;
  _initPromise = null;
}