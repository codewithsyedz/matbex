import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { endOfMonth, format, startOfMonth } from "date-fns";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
export type DayEndStatus =
  | "open"
  | "draft"
  | "closed"
  | "partially_reversed"
  | "reversed"
  | "reopened";

export const DAY_END_STATUS_LABEL: Record<DayEndStatus, string> = {
  open: "Not started",
  draft: "Recorded, unposted",
  closed: "Closed & posted",
  partially_reversed: "Partially reversed",
  reversed: "Fully reversed",
  reopened: "Reopened",
};

export interface DayEndCell {
  date: string;
  branchId: string;
  status: DayEndStatus;
  totalSales: number | null;
  ledgerPosted: boolean;
  voidedLines: number;
  reversedAdjustments: number;
  overheadStatus: string | null;
}

interface Args {
  /** Any date inside the month to display. */
  month: Date;
  /** Optional single-branch restriction. */
  branchIds: string[];
}

export function useDayEndStatusMatrix({ month, branchIds }: Args) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const from = format(startOfMonth(month), "yyyy-MM-dd");
  const to = format(endOfMonth(month), "yyyy-MM-dd");

  const queryClient = useQueryClient();
  const queryKey = ["day-end-status-matrix", tenantId, from, to, branchIds.join(",")];

  const query = useQuery({
    queryKey,
    enabled: !!tenantId,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, DayEndCell>> => {
      const [salesRes, adjRes, overheadRes, voidRes] = await Promise.all([
        db
          .from("daily_sales_summary")
          .select("sales_date, branch_id, status, total_sales, ledger_posted, ledger_batch_id")
          .eq("tenant_id", tenantId)
          .gte("sales_date", from)
          .lte("sales_date", to),
        db
          .from("day_end_adjustments")
          .select("business_date, branch_id, reversed_at, reversal_of_id")
          .eq("tenant_id", tenantId)
          .gte("business_date", from)
          .lte("business_date", to),
        db
          .from("daily_overhead_closures")
          .select("business_date, branch_id, status")
          .eq("tenant_id", tenantId)
          .gte("business_date", from)
          .lte("business_date", to),
        db
          .from("account_transactions")
          .select("transaction_date, branch_id, is_voided, reference_type")
          .eq("tenant_id", tenantId)
          .eq("is_voided", true)
          .in("reference_type", ["sale", "day_end_adjustment", "daily_overhead"])
          .gte("transaction_date", from)
          .lte("transaction_date", to)
          .limit(5000),
      ]);

      const cells: Record<string, DayEndCell> = {};
      const keyOf = (date: string, branchId: string | null) => `${date}|${branchId ?? "unassigned"}`;
      const ensure = (date: string, branchId: string | null): DayEndCell => {
        const k = keyOf(date, branchId);
        if (!cells[k]) {
          cells[k] = {
            date,
            branchId: branchId ?? "unassigned",
            status: "open",
            totalSales: null,
            ledgerPosted: false,
            voidedLines: 0,
            reversedAdjustments: 0,
            overheadStatus: null,
          };
        }
        return cells[k];
      };

      (salesRes.data || []).forEach((s: any) => {
        const c = ensure(s.sales_date, s.branch_id);
        c.totalSales = Number(s.total_sales) || 0;
        c.ledgerPosted = !!s.ledger_posted && !!s.ledger_batch_id;
        c.status = c.ledgerPosted ? "closed" : "draft";
      });

      (adjRes.data || []).forEach((a: any) => {
        if (!a.reversed_at && !a.reversal_of_id) return;
        ensure(a.business_date, a.branch_id).reversedAdjustments += 1;
      });

      (overheadRes.data || []).forEach((o: any) => {
        ensure(o.business_date, o.branch_id).overheadStatus = o.status ?? null;
      });

      (voidRes.data || []).forEach((v: any) => {
        ensure(v.transaction_date, v.branch_id).voidedLines += 1;
      });

      Object.values(cells).forEach((c) => {
        const touched = c.voidedLines > 0 || c.reversedAdjustments > 0;
        if (c.overheadStatus === "reopened") {
          c.status = "reopened";
        } else if (touched && !c.ledgerPosted && c.totalSales == null) {
          c.status = "reversed";
        } else if (touched) {
          c.status = "partially_reversed";
        }
      });

      return cells;
    },
  });

  // Live refresh: re-fetch whenever a day-end related record is posted, voided,
  // reversed or reopened anywhere in the tenant.
  const invalidateRef = useRef<() => void>(() => {});
  invalidateRef.current = () => {
    queryClient.invalidateQueries({ queryKey: ["day-end-status-matrix"] });
  };

  useEffect(() => {
    if (!tenantId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => invalidateRef.current(), 600);
    };

    const channel = db.channel(`day-end-status-${tenantId}`);
    ["daily_sales_summary", "day_end_adjustments", "daily_overhead_closures", "journal_entry_batches"].forEach(
      (table) => {
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table, filter: `tenant_id=eq.${tenantId}` } as any,
          schedule,
        );
      },
    );
    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      db.removeChannel(channel);
    };
  }, [tenantId]);

  return {
    cells: query.data ?? {},
    isLoading: query.isLoading,
    refetch: query.refetch,
    range: { from, to },
  };
}
