import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCardSalesByBranch, type CardSalesBranchRow } from "@/hooks/useCardSalesByBranch";

export interface BranchAdjustmentRow {
  id: string;
  branchId: string | null;
  businessDate: string;
  amount: number;
  reason: string;
  scope: string;
  notes: string;
  ledgerPosted: boolean;
}

export interface BranchPayoutRow {
  id: string;
  branchId: string | null;
  depositDate: string;
  gross: number;
  fee: number;
  net: number;
  reference: string | null;
  notes: string | null;
  periodFrom: string | null;
  periodTo: string | null;
}

export interface BranchLedgerRow extends CardSalesBranchRow {
  /** Sum of active (unreversed) day-end adjustments for the period. */
  adjustments: number;
  adjustmentCount: number;
  /** Net bank amount received from acquirer payouts. */
  payoutsNet: number;
  payoutCount: number;
}

interface Args {
  from: Date;
  to: Date;
  branchId?: string | null;
}

const key = (branchId: string | null) => branchId ?? "unassigned";

/**
 * Consolidated per-branch ledger view: card takings, day-end adjustments and
 * acquirer payouts for a date range.
 */
export function useBranchLedger({ from, to, branchId }: Args) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const fromKey = format(from, "yyyy-MM-dd");
  const toKey = format(to, "yyyy-MM-dd");
  const branchKey = branchId && branchId !== "all" ? branchId : null;

  const cards = useCardSalesByBranch({ from, to, branchId });

  const extras = useQuery({
    queryKey: ["branch-ledger-extras", tenantId, fromKey, toKey, branchKey],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 2,
    queryFn: async () => {
      let aq = (supabase as any)
        .from("day_end_adjustments")
        .select(
          "id, branch_id, business_date, amount, reason, scope, notes, ledger_posted, reversed_at, reversal_of_id",
        )
        .eq("tenant_id", tenantId!)
        .gte("business_date", fromKey)
        .lte("business_date", toKey)
        .is("reversed_at", null)
        .is("reversal_of_id", null)
        .order("business_date", { ascending: false });
      if (branchKey) aq = aq.eq("branch_id", branchKey);
      const { data: adjData, error: adjErr } = await aq;
      if (adjErr) throw adjErr;

      let dq = (supabase as any)
        .from("card_settlement_deposits")
        .select(
          "id, branch_id, deposit_date, gross_amount, fee_amount, net_amount, reference, notes, period_from, period_to",
        )
        .eq("tenant_id", tenantId!)
        .eq("is_reversed", false)
        .gte("deposit_date", fromKey)
        .lte("deposit_date", toKey)
        .order("deposit_date", { ascending: false });
      if (branchKey) dq = dq.eq("branch_id", branchKey);
      const { data: depData, error: depErr } = await dq;
      if (depErr) throw depErr;

      const adjustments: BranchAdjustmentRow[] = ((adjData ?? []) as any[]).map((a) => ({
        id: a.id,
        branchId: a.branch_id ?? null,
        businessDate: a.business_date,
        amount: Number(a.amount ?? 0),
        reason: String(a.reason ?? ""),
        scope: String(a.scope ?? ""),
        notes: a.notes ?? "",
        ledgerPosted: !!a.ledger_posted,
      }));

      const payouts: BranchPayoutRow[] = ((depData ?? []) as any[]).map((d) => ({
        id: d.id,
        branchId: d.branch_id ?? null,
        depositDate: d.deposit_date,
        gross: Number(d.gross_amount ?? 0),
        fee: Number(d.fee_amount ?? 0),
        net: Number(d.net_amount ?? Number(d.gross_amount ?? 0) - Number(d.fee_amount ?? 0)),
        reference: d.reference ?? null,
        notes: d.notes ?? null,
        periodFrom: d.period_from ?? null,
        periodTo: d.period_to ?? null,
      }));

      return { adjustments, payouts };
    },
  });

  const adjustments = extras.data?.adjustments ?? [];
  const payouts = extras.data?.payouts ?? [];

  const rows: BranchLedgerRow[] = useMemo(() => {
    const adjByBranch = new Map<string, { total: number; count: number }>();
    for (const a of adjustments) {
      const k = key(a.branchId);
      const cur = adjByBranch.get(k) ?? { total: 0, count: 0 };
      cur.total += a.amount;
      cur.count += 1;
      adjByBranch.set(k, cur);
    }
    const payByBranch = new Map<string, { net: number; count: number }>();
    for (const p of payouts) {
      const k = key(p.branchId);
      const cur = payByBranch.get(k) ?? { net: 0, count: 0 };
      cur.net += p.net;
      cur.count += 1;
      payByBranch.set(k, cur);
    }

    const base = cards.branchRows.map((r) => {
      const k = key(r.branchId);
      const adj = adjByBranch.get(k);
      const pay = payByBranch.get(k);
      adjByBranch.delete(k);
      payByBranch.delete(k);
      return {
        ...r,
        adjustments: adj?.total ?? 0,
        adjustmentCount: adj?.count ?? 0,
        payoutsNet: pay?.net ?? 0,
        payoutCount: pay?.count ?? 0,
      };
    });

    // Branches with adjustments/payouts but no card sales in the period.
    const leftovers = new Set([...adjByBranch.keys(), ...payByBranch.keys()]);
    for (const k of leftovers) {
      const sample =
        adjustments.find((a) => key(a.branchId) === k) ?? payouts.find((p) => key(p.branchId) === k);
      const adj = adjByBranch.get(k);
      const pay = payByBranch.get(k);
      base.push({
        branchId: sample?.branchId ?? null,
        branchName: k === "unassigned" ? "Unassigned" : k,
        posGross: 0,
        posVat: 0,
        posNet: 0,
        txnCount: 0,
        declared: 0,
        variance: 0,
        settledGross: 0,
        settlementFees: 0,
        unsettled: 0,
        adjustments: adj?.total ?? 0,
        adjustmentCount: adj?.count ?? 0,
        payoutsNet: pay?.net ?? 0,
        payoutCount: pay?.count ?? 0,
      });
    }

    return base;
  }, [cards.branchRows, adjustments, payouts]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          posGross: acc.posGross + r.posGross,
          posVat: acc.posVat + r.posVat,
          posNet: acc.posNet + r.posNet,
          txnCount: acc.txnCount + r.txnCount,
          declared: acc.declared + r.declared,
          settledGross: acc.settledGross + r.settledGross,
          settlementFees: acc.settlementFees + r.settlementFees,
          unsettled: acc.unsettled + r.unsettled,
          adjustments: acc.adjustments + r.adjustments,
          payoutsNet: acc.payoutsNet + r.payoutsNet,
        }),
        {
          posGross: 0,
          posVat: 0,
          posNet: 0,
          txnCount: 0,
          declared: 0,
          settledGross: 0,
          settlementFees: 0,
          unsettled: 0,
          adjustments: 0,
          payoutsNet: 0,
        },
      ),
    [rows],
  );

  const branchNameById = useMemo(() => {
    const map: Record<string, string> = {};
    rows.forEach((r) => {
      if (r.branchId) map[r.branchId] = r.branchName;
    });
    return map;
  }, [rows]);

  return {
    rows,
    adjustments,
    payouts,
    totals,
    branchNameById,
    isLoading: cards.isLoading || extras.isLoading,
    error: cards.error ?? extras.error,
  };
}
