import { db } from "@/integrations/db/client";

export type SalePostingSource =
  | "daily_sales"
  | "night_shift"
  | "pos_sale"
  | "adjustment";

export interface LogSalePostingFailureArgs {
  restaurantId: string;
  businessDate: string; // yyyy-MM-dd
  errorMessage: string;
  branchId?: string | null;
  shiftId?: string | null;
  source?: SalePostingSource;
  errorCode?: string | null;
  context?: Record<string, unknown>;
}

/**
 * Records a sale-to-ledger posting failure so it shows up on the
 * Sale Posting Monitor and triggers in-app alerts for owners/managers.
 * Never throws — monitoring must not mask the original error.
 */
export async function logSalePostingFailure(args: LogSalePostingFailureArgs) {
  try {
    const { error } = await db.rpc("log_sale_posting_failure" as never, {
      _restaurant_id: args.restaurantId,
      _business_date: args.businessDate,
      _error_message: args.errorMessage?.slice(0, 2000) ?? "Unknown error",
      _branch_id: args.branchId ?? null,
      _shift_id: args.shiftId ?? null,
      _source: args.source ?? "daily_sales",
      _error_code: args.errorCode ?? null,
      _context: args.context ?? {},
    } as never);
    if (error) console.warn("[salePostingMonitor] log failed", error.message);
  } catch (e) {
    console.warn("[salePostingMonitor] log threw", e);
  }
}

export interface SalePostingMonitorStats {
  failures_total: number;
  failures_unresolved: number;
  unposted_closed_days: number;
  unposted_night_shifts: number;
  idempotency_replays: number;
  idempotency_replayed_keys: number;
  affected_shift_ids: string[];
}

export const EMPTY_MONITOR_STATS: SalePostingMonitorStats = {
  failures_total: 0,
  failures_unresolved: 0,
  unposted_closed_days: 0,
  unposted_night_shifts: 0,
  idempotency_replays: 0,
  idempotency_replayed_keys: 0,
  affected_shift_ids: [],
};

export function normaliseMonitorStats(raw: unknown): SalePostingMonitorStats {
  const r = (raw ?? {}) as Partial<SalePostingMonitorStats>;
  return {
    ...EMPTY_MONITOR_STATS,
    ...r,
    affected_shift_ids: Array.isArray(r.affected_shift_ids)
      ? (r.affected_shift_ids as string[]).filter(Boolean)
      : [],
  };
}
