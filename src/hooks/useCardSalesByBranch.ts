import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { getRestaurantDayBoundsUTC } from "@/lib/timezone";

export interface CardSalesBranchRow {
  branchId: string | null;
  branchName: string;
  /** Card revenue captured on POS transactions (gross, VAT inclusive). */
  posGross: number;
  /** VAT portion of the POS card revenue. */
  posVat: number;
  /** Net (ex-VAT) card revenue. */
  posNet: number;
  /** Number of card transactions. */
  txnCount: number;
  /** Card totals declared on the day-end sales summary. */
  declared: number;
  /** declared − posGross. Positive = day-end declares more than POS captured. */
  variance: number;
  /** Gross card takings already settled by acquirer deposits in this period. */
  settledGross: number;
  /** Acquirer fees withheld on those deposits. */
  settlementFees: number;
  /** posGross − settledGross. What the acquirer still owes this branch. */
  unsettled: number;
}

export interface CardSalesDayRow {
  date: string;
  branchId: string | null;
  branchName: string;
  posGross: number;
  posVat: number;
  txnCount: number;
  declared: number;
  variance: number;
}

interface Args {
  from: Date;
  to: Date;
  /** "all" / null = consolidated across branches. */
  branchId?: string | null;
}

const key = (branchId: string | null) => branchId ?? "unassigned";

export function useCardSalesByBranch({ from, to, branchId }: Args) {
  const { profile, restaurant } = useAuth();
  const tenantId = profile?.tenant_id;
  const restaurantId = restaurant?.id;
  const tz = restaurant?.timezone || "Asia/Riyadh";
  const fromKey = format(from, "yyyy-MM-dd");
  const toKey = format(to, "yyyy-MM-dd");
  const branchKey = branchId && branchId !== "all" ? branchId : null;

  const query = useQuery({
    queryKey: ["card-sales-by-branch", tenantId, restaurantId, fromKey, toKey, branchKey, tz],
    enabled: !!tenantId && !!restaurantId,
    staleTime: 1000 * 60 * 2,
    queryFn: async () => {
      const { start } = getRestaurantDayBoundsUTC(new Date(`${fromKey}T12:00:00Z`), tz);
      const { endExclusive } = getRestaurantDayBoundsUTC(new Date(`${toKey}T12:00:00Z`), tz);

      // 1. POS card transactions (paged past the 1000-row cap)
      const pageSize = 1000;
      let page = 0;
      const txns: {
        branch_id: string | null;
        total: number | null;
        tax: number | null;
        created_at: string;
      }[] = [];
      while (true) {
        let q: any = (db as any)
          .from("sales_transactions")
          .select("branch_id, total, tax, created_at")
          .eq("restaurant_id", restaurantId!)
          .eq("payment_method", "card")
          .gte("created_at", start.toISOString())
          .lt("created_at", endExclusive.toISOString());
        if (branchKey) q = q.eq("branch_id", branchKey);
        const { data, error } = await q
          .order("created_at", { ascending: true })
          .range(page * pageSize, page * pageSize + pageSize - 1);
        if (error) throw error;
        const batch = (data ?? []) as any[];
        txns.push(...batch);
        if (batch.length < pageSize) break;
        page += 1;
        if (page > 50) break;
      }

      // 2. Declared card sales from day-end summaries
      let sq = db
        .from("daily_sales_summary")
        .select("branch_id, sales_date, card_sales")
        .eq("tenant_id", tenantId!)
        .gte("sales_date", fromKey)
        .lte("sales_date", toKey);
      if (branchKey) sq = sq.eq("branch_id", branchKey);
      const { data: summaries, error: sumErr } = await sq;
      if (sumErr) throw sumErr;

      // 3. Acquirer settlement deposits covering this period
      let dq = (db as any)
        .from("card_settlement_deposits")
        .select("branch_id, deposit_date, gross_amount, fee_amount, is_reversed")
        .eq("tenant_id", tenantId!)
        .eq("is_reversed", false)
        .gte("deposit_date", fromKey)
        .lte("deposit_date", toKey);
      if (branchKey) dq = dq.eq("branch_id", branchKey);
      const { data: deposits, error: depErr } = await dq;
      if (depErr) throw depErr;

      // 4. Branch names
      const { data: branchRows } = await db.from("branches").select("id, name");
      const branchNames: Record<string, string> = {};
      (branchRows ?? []).forEach((b: any) => (branchNames[b.id] = b.name));

      // 5. Aggregate per branch + per day
      const byBranch = new Map<string, CardSalesBranchRow>();
      const byDay = new Map<string, CardSalesDayRow>();

      const branchRow = (bid: string | null) => {
        const k = key(bid);
        let row = byBranch.get(k);
        if (!row) {
          row = {
            branchId: bid,
            branchName: bid ? branchNames[bid] ?? "Unknown branch" : "Unassigned",
            posGross: 0,
            posVat: 0,
            posNet: 0,
            txnCount: 0,
            declared: 0,
            variance: 0,
            settledGross: 0,
            settlementFees: 0,
            unsettled: 0,
          };
          byBranch.set(k, row);
        }
        return row;
      };

      const dayRow = (bid: string | null, date: string) => {
        const k = `${date}|${key(bid)}`;
        let row = byDay.get(k);
        if (!row) {
          row = {
            date,
            branchId: bid,
            branchName: bid ? branchNames[bid] ?? "Unknown branch" : "Unassigned",
            posGross: 0,
            posVat: 0,
            txnCount: 0,
            declared: 0,
            variance: 0,
          };
          byDay.set(k, row);
        }
        return row;
      };

      for (const t of txns) {
        const gross = Number(t.total ?? 0);
        const vat = Number(t.tax ?? 0);
        const b = branchRow(t.branch_id ?? null);
        b.posGross += gross;
        b.posVat += vat;
        b.txnCount += 1;

        // Business date in restaurant timezone
        const { start: dayStart } = getRestaurantDayBoundsUTC(new Date(t.created_at), tz);
        const businessDate = format(dayStart, "yyyy-MM-dd");
        const d = dayRow(t.branch_id ?? null, businessDate);
        d.posGross += gross;
        d.posVat += vat;
        d.txnCount += 1;
      }

      for (const s of (summaries ?? []) as any[]) {
        const declared = Number(s.card_sales ?? 0);
        if (!declared) continue;
        branchRow(s.branch_id ?? null).declared += declared;
        dayRow(s.branch_id ?? null, s.sales_date).declared += declared;
      }

      for (const d of (deposits ?? []) as any[]) {
        const row = branchRow(d.branch_id ?? null);
        row.settledGross += Number(d.gross_amount ?? 0);
        row.settlementFees += Number(d.fee_amount ?? 0);
      }

      const branchRowsOut = Array.from(byBranch.values()).map((r) => ({
        ...r,
        posNet: r.posGross - r.posVat,
        variance: r.declared - r.posGross,
        unsettled: r.posGross - r.settledGross,
      }));
      branchRowsOut.sort((a, b) => b.posGross - a.posGross);

      const dayRowsOut = Array.from(byDay.values()).map((r) => ({
        ...r,
        variance: r.declared - r.posGross,
      }));
      dayRowsOut.sort((a, b) => (a.date === b.date ? a.branchName.localeCompare(b.branchName) : a.date < b.date ? 1 : -1));

      return { branchRows: branchRowsOut, dayRows: dayRowsOut };
    },
  });

  const branchRows = query.data?.branchRows ?? [];
  const dayRows = query.data?.dayRows ?? [];

  const totals = useMemo(
    () =>
      branchRows.reduce(
        (acc, r) => ({
          posGross: acc.posGross + r.posGross,
          posVat: acc.posVat + r.posVat,
          posNet: acc.posNet + r.posNet,
          txnCount: acc.txnCount + r.txnCount,
          declared: acc.declared + r.declared,
          variance: acc.variance + r.variance,
          settledGross: acc.settledGross + r.settledGross,
          settlementFees: acc.settlementFees + r.settlementFees,
          unsettled: acc.unsettled + r.unsettled,
        }),
        {
          posGross: 0,
          posVat: 0,
          posNet: 0,
          txnCount: 0,
          declared: 0,
          variance: 0,
          settledGross: 0,
          settlementFees: 0,
          unsettled: 0,
        },
      ),
    [branchRows],
  );

  return { branchRows, dayRows, totals, isLoading: query.isLoading, error: query.error };
}
