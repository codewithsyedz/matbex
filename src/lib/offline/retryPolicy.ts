// =====================================================================
// Per-category retry scheduling for the offline sync queue.
// ---------------------------------------------------------------------
// Different transient failures deserve different backoff curves:
//   - network    : aggressive retries, the radio may flap
//   - server     : moderate backoff, the server is recovering
//   - rate_limit : long backoff, we were explicitly throttled
//   - dependency : short, the parent will sync momentarily
// Hard failures (validation/auth/terminal_revoked) are NOT scheduled.
// they require a human decision.
// =====================================================================

import type { ErrorCategoryId } from "./errorCategorization";

export interface RetryPolicy {
  /** Base delay for the first retry, ms. */
  baseMs: number;
  /** Multiplier applied per attempt. */
  factor: number;
  /** Hard cap on the backoff delay, ms. */
  capMs: number;
  /** ± jitter percentage (0..1) applied to the delay. */
  jitter: number;
  /** Max attempts before the item is parked as FAILED. */
  maxRetries: number;
}

const POLICIES: Record<ErrorCategoryId, RetryPolicy> = {
  network:    { baseMs: 5_000,   factor: 2,   capMs: 2 * 60_000,  jitter: 0.25, maxRetries: 12 },
  server:     { baseMs: 15_000,  factor: 2,   capMs: 5 * 60_000,  jitter: 0.20, maxRetries: 8  },
  rate_limit: { baseMs: 60_000,  factor: 2,   capMs: 15 * 60_000, jitter: 0.30, maxRetries: 6  },
  dependency: { baseMs: 3_000,   factor: 1.5, capMs: 30_000,      jitter: 0.10, maxRetries: 10 },
  unknown:    { baseMs: 10_000,  factor: 2,   capMs: 5 * 60_000,  jitter: 0.20, maxRetries: 6  },
  // Non-retryable categories: kept here so callers can read maxRetries=0.
  validation:        { baseMs: 0, factor: 1, capMs: 0, jitter: 0, maxRetries: 0 },
  auth:              { baseMs: 0, factor: 1, capMs: 0, jitter: 0, maxRetries: 0 },
  terminal_revoked:  { baseMs: 0, factor: 1, capMs: 0, jitter: 0, maxRetries: 0 },
  duplicate:         { baseMs: 0, factor: 1, capMs: 0, jitter: 0, maxRetries: 0 },
  none:              { baseMs: 0, factor: 1, capMs: 0, jitter: 0, maxRetries: 0 },
};

export function getRetryPolicy(category: ErrorCategoryId): RetryPolicy {
  return POLICIES[category] ?? POLICIES.unknown;
}

/** Compute the next retry delay (ms) for a given category and attempt count. */
export function nextRetryDelayMs(category: ErrorCategoryId, retryCount: number): number {
  const p = getRetryPolicy(category);
  if (p.maxRetries === 0) return 0;
  const raw = Math.min(p.baseMs * Math.pow(p.factor, Math.max(0, retryCount - 1)), p.capMs);
  const j = 1 + (Math.random() * 2 - 1) * p.jitter;
  return Math.max(500, Math.round(raw * j));
}

/** Convenience: ISO timestamp of next retry, or null if non-retryable. */
export function nextRetryAtIso(category: ErrorCategoryId, retryCount: number): string | null {
  const p = getRetryPolicy(category);
  if (p.maxRetries === 0) return null;
  return new Date(Date.now() + nextRetryDelayMs(category, retryCount)).toISOString();
}

/** Format a millisecond gap as a compact countdown ("2m 14s", "32s", "now"). */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r === 0 ? `${m}m` : `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}