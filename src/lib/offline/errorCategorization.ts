// =====================================================================
// Per-transaction error categorization for the offline sync queue.
// ---------------------------------------------------------------------
// Inspects the queue item's status, retry count and error_message and
// returns a structured category + suggested fix so cashiers/managers
// can quickly distinguish *retryable transient* failures from *hard
// validation/auth* failures that need a human decision.
// =====================================================================

import type { SyncQueueItem } from "./types";

export type ErrorCategoryId =
  | "none"
  | "validation"
  | "duplicate"
  | "auth"
  | "terminal_revoked"
  | "dependency"
  | "rate_limit"
  | "server"
  | "network"
  | "unknown";

export type ErrorSeverity = "info" | "warning" | "critical";

export interface ErrorCategory {
  id: ErrorCategoryId;
  label: string;
  severity: ErrorSeverity;
  /** Whether automatic retry is likely to help. */
  retryable: boolean;
  /** One-line cause explanation in plain English. */
  description: string;
  /** Concrete next step the user should take. */
  suggestion: string;
}

const NONE: ErrorCategory = {
  id: "none",
  label: "No error",
  severity: "info",
  retryable: false,
  description: "This item is queued normally.",
  suggestion: "No action required.",
};

/** Pattern-match the raw error string against known failure modes. */
function matchByMessage(message: string): ErrorCategory {
  const m = message.toLowerCase();

  if (/terminal.*(revoked|inactive|disabled)|403.*terminal/.test(m)) {
    return {
      id: "terminal_revoked",
      label: "Terminal revoked",
      severity: "critical",
      retryable: false,
      description: "This device is no longer authorized to sync.",
      suggestion:
        "Open POS Terminals and re-register this device, or ask an owner to re-activate it.",
    };
  }
  if (/401|unauthor|jwt|token.*expired|invalid.*token/.test(m)) {
    return {
      id: "auth",
      label: "Authentication",
      severity: "critical",
      retryable: false,
      description: "The cashier session is no longer valid.",
      suggestion: "Sign out and back in, then press Retry.",
    };
  }
  if (/duplicate|already exists|conflict|409/.test(m)) {
    return {
      id: "duplicate",
      label: "Already synced",
      severity: "info",
      retryable: false,
      description: "The server already has this transaction.",
      suggestion: "Safe to dismiss - this item will be cleared on the next sync sweep.",
    };
  }
  if (/depend|missing.*order|parent.*not.*found/.test(m)) {
    return {
      id: "dependency",
      label: "Waiting on parent",
      severity: "warning",
      retryable: true,
      description: "This item depends on another transaction that hasn't synced yet.",
      suggestion: "Resolve the parent ORDER first, then retry this row.",
    };
  }
  if (/rate.?limit|429|too many requests/.test(m)) {
    return {
      id: "rate_limit",
      label: "Rate limited",
      severity: "warning",
      retryable: true,
      description: "The server throttled this device temporarily.",
      suggestion: "Wait 1–2 minutes and press Force sync.",
    };
  }
  if (/validation|invalid|missing.*field|422|forbidden|schema/.test(m)) {
    return {
      id: "validation",
      label: "Validation",
      severity: "critical",
      retryable: false,
      description: "The payload was rejected by the server's rules.",
      suggestion:
        "Export the JSON, fix the bad field (e.g. negative price, missing menu item), then retry.",
    };
  }
  if (/5\d\d|server error|internal|gateway|timeout|timed out/.test(m)) {
    return {
      id: "server",
      label: "Server error",
      severity: "warning",
      retryable: true,
      description: "The server returned a transient error.",
      suggestion: "Will retry automatically. Use Force sync to retry now.",
    };
  }
  if (
    /network|fetch|offline|failed to fetch|disconnected|name.?not.?resolved|dns|cors/.test(m)
  ) {
    return {
      id: "network",
      label: "Network",
      severity: "warning",
      retryable: true,
      description: "The device couldn't reach the server.",
      suggestion: "Check Wi-Fi/4G. Sync will resume automatically when online.",
    };
  }
  return {
    id: "unknown",
    label: "Unknown",
    severity: "warning",
    retryable: true,
    description: "An unrecognized error occurred.",
    suggestion: "Press Retry. If it persists, export JSON and contact support.",
  };
}

/** Public: categorise a queue item. */
export function categorizeQueueError(qi: SyncQueueItem): ErrorCategory {
  if (!qi.error_message && qi.status !== "FAILED" && qi.status !== "FAILED_VALIDATION") {
    return NONE;
  }
  // FAILED_VALIDATION is always a hard validation error regardless of message.
  if (qi.status === "FAILED_VALIDATION") {
    const cat = matchByMessage(qi.error_message ?? "validation");
    return cat.id === "unknown" || cat.id === "network" || cat.id === "server"
      ? {
          id: "validation",
          label: "Validation",
          severity: "critical",
          retryable: false,
          description: "The payload was rejected by the server's rules.",
          suggestion:
            "Export the JSON, fix the bad field, then retry - automatic retries won't help.",
        }
      : cat;
  }
  return matchByMessage(qi.error_message ?? "");
}

export const SEVERITY_BADGE_VARIANT: Record<
  ErrorSeverity,
  "default" | "secondary" | "destructive" | "outline"
> = {
  info: "outline",
  warning: "secondary",
  critical: "destructive",
};