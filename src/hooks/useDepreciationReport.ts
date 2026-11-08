import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";

/** Untyped client: fixed asset tables are newer than the generated types. */
export interface DepreciationReportRow {
  assetId: string;
  assetTag: string | null;
  name: string;
  branchId: string | null;
  branchName: string;
  classId: string | null;
  className: string;
  method: "straight_line" | "reducing_balance";
  inServiceDate: string;
  usefulLifeMonths: number;
  status: string;
  /** Gross acquisition cost held on the register at period end. */
  cost: number;
  /** Depreciation charged in the selected period. */
  periodExpense: number;
  /** Depreciation charged before the selected period. */
  openingAccumulated: number;
  /** Depreciation charged up to and including the selected period. */
  closingAccumulated: number;
  /** Cost − closing accumulated depreciation. */
  netBookValue: number;
  disposedInPeriod: boolean;
}

export interface DepreciationGroup {
  key: string;
  label: string;
  sublabel?: string;
  cost: number;
  openingAccumulated: number;
  periodExpense: number;
  closingAccumulated: number;
  netBookValue: number;
  assetCount: number;
  rows: DepreciationReportRow[];
}

export interface DepreciationTotals {
  cost: number;
  openingAccumulated: number;
  periodExpense: number;
  closingAccumulated: number;
  netBookValue: number;
  assetCount: number;
}

export interface DepreciationTrendPoint {
  /** First day of the month, ISO date. */
  month: string;
  label: string;
  cost: number;
  periodExpense: number;
  accumulated: number;
  netBookValue: number;
}

const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;

const round2 = (n: number) => Math.round(n * 100) / 100;

interface Args {
  /** First day of the reporting month. */
  periodMonth: Date;
  /** null / "all" = consolidated across branches. */
  branchId?: string | null;
  classId?: string | null;
  includeDisposed?: boolean;
}

export function useDepreciationReport({
  periodMonth,
  branchId,
  classId,
  includeDisposed = true,
}: Args) {
  const { profile, tenant } = useAuth();
  const { branches } = useBranch();
  const tenantId = profile?.tenant_id;
  const branchKey = branchId && branchId !== "all" ? branchId : null;
  const classKey = classId && classId !== "all" ? classId : null;
  const period = monthKey(periodMonth);
  const periodEnd = new Date(periodMonth.getFullYear(), periodMonth.getMonth() + 1, 0);
  const periodEndKey = `${periodEnd.getFullYear()}-${String(periodEnd.getMonth() + 1).padStart(2, "0")}-${String(periodEnd.getDate()).padStart(2, "0")}`;

  const assetsQuery = useQuery({
    queryKey: ["depreciation-report-assets", tenantId],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 2,
    queryFn: async () => {
      const { data, error } = await db
        .from("fixed_assets")
        .select(
          "id, name, asset_tag, branch_id, class_id, cost, salvage_value, useful_life_months, depreciation_method, in_service_date, status, disposal_date",
        )
        .eq("tenant_id", tenantId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const classesQuery = useQuery({
    queryKey: ["depreciation-report-classes", tenantId],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await db
        .from("fixed_asset_classes")
        .select("id, code, name, branch_id, sort_order")
        .eq("tenant_id", tenantId)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const depreciationQuery = useQuery({
    queryKey: ["depreciation-report-entries", tenantId, period],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 2,
    queryFn: async () => {
      const { data, error } = await db
        .from("fixed_asset_depreciation")
        .select("asset_id, period_month, amount")
        .eq("tenant_id", tenantId)
        .lte("period_month", period);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const branchName = (id: string | null) =>
    id ? branches.find((b) => b.id === id)?.name ?? "Unknown branch" : "Unassigned / head office";

  const rows = useMemo<DepreciationReportRow[]>(() => {
    const assets = assetsQuery.data ?? [];
    const classes = classesQuery.data ?? [];
    const entries = depreciationQuery.data ?? [];

    const opening = new Map<string, number>();
    const current = new Map<string, number>();
    for (const e of entries) {
      const amount = Number(e.amount || 0);
      if (e.period_month === period) {
        current.set(e.asset_id, (current.get(e.asset_id) ?? 0) + amount);
      } else {
        opening.set(e.asset_id, (opening.get(e.asset_id) ?? 0) + amount);
      }
    }

    const classNameById = new Map<string, string>(
      classes.map((c) => [c.id as string, c.name as string]),
    );

    return assets
      // Only assets already on the register at period end.
      .filter((a) => String(a.in_service_date) <= periodEndKey)
      // Assets disposed before the period no longer carry cost or NBV.
      .filter((a) => !a.disposal_date || String(a.disposal_date) >= period)
      .filter((a) => (branchKey ? a.branch_id === branchKey : true))
      .filter((a) => (classKey ? a.class_id === classKey : true))
      .map((a) => {
        const cost = Number(a.cost || 0);
        const open = round2(opening.get(a.id) ?? 0);
        const periodExpense = round2(current.get(a.id) ?? 0);
        const closing = round2(open + periodExpense);
        return {
          assetId: a.id,
          assetTag: a.asset_tag ?? null,
          name: a.name,
          branchId: a.branch_id ?? null,
          branchName: branchName(a.branch_id ?? null),
          classId: a.class_id ?? null,
          className: a.class_id
            ? classNameById.get(a.class_id) ?? "Unclassified"
            : "Unclassified",
          method: (a.depreciation_method ?? "straight_line") as DepreciationReportRow["method"],
          inServiceDate: a.in_service_date,
          usefulLifeMonths: Number(a.useful_life_months || 0),
          status: a.status,
          cost,
          openingAccumulated: open,
          periodExpense,
          closingAccumulated: closing,
          netBookValue: round2(cost - closing),
          disposedInPeriod:
            !!a.disposal_date &&
            String(a.disposal_date) >= period &&
            String(a.disposal_date) <= periodEndKey,
        };
      })
      .filter((r) => (includeDisposed ? true : r.status !== "disposed"))
      .sort(
        (a, b) =>
          a.branchName.localeCompare(b.branchName) ||
          a.className.localeCompare(b.className) ||
          a.name.localeCompare(b.name),
      );
  }, [
    assetsQuery.data,
    classesQuery.data,
    depreciationQuery.data,
    period,
    periodEndKey,
    branchKey,
    classKey,
    includeDisposed,
    branches,
  ]);

  const group = (by: "branch" | "class"): DepreciationGroup[] => {
    const map = new Map<string, DepreciationGroup>();
    for (const r of rows) {
      const key = by === "branch" ? r.branchId ?? "unassigned" : r.classId ?? "unclassified";
      const label = by === "branch" ? r.branchName : r.className;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          label,
          cost: 0,
          openingAccumulated: 0,
          periodExpense: 0,
          closingAccumulated: 0,
          netBookValue: 0,
          assetCount: 0,
          rows: [],
        };
        map.set(key, g);
      }
      g.cost = round2(g.cost + r.cost);
      g.openingAccumulated = round2(g.openingAccumulated + r.openingAccumulated);
      g.periodExpense = round2(g.periodExpense + r.periodExpense);
      g.closingAccumulated = round2(g.closingAccumulated + r.closingAccumulated);
      g.netBookValue = round2(g.netBookValue + r.netBookValue);
      g.assetCount += 1;
      g.rows.push(r);
    }
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost || a.label.localeCompare(b.label));
  };

  const byBranch = useMemo(() => group("branch"), [rows]);
  const byClass = useMemo(() => group("class"), [rows]);

  /** Branch → class matrix, the restaurant-wide breakdown used by the export. */
  const byBranchClass = useMemo<DepreciationGroup[]>(() => {
    const map = new Map<string, DepreciationGroup>();
    for (const r of rows) {
      const key = `${r.branchId ?? "unassigned"}::${r.classId ?? "unclassified"}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          label: r.className,
          sublabel: r.branchName,
          cost: 0,
          openingAccumulated: 0,
          periodExpense: 0,
          closingAccumulated: 0,
          netBookValue: 0,
          assetCount: 0,
          rows: [],
        };
        map.set(key, g);
      }
      g.cost = round2(g.cost + r.cost);
      g.openingAccumulated = round2(g.openingAccumulated + r.openingAccumulated);
      g.periodExpense = round2(g.periodExpense + r.periodExpense);
      g.closingAccumulated = round2(g.closingAccumulated + r.closingAccumulated);
      g.netBookValue = round2(g.netBookValue + r.netBookValue);
      g.assetCount += 1;
      g.rows.push(r);
    }
    return Array.from(map.values()).sort(
      (a, b) => (a.sublabel ?? "").localeCompare(b.sublabel ?? "") || a.label.localeCompare(b.label),
    );
  }, [rows]);

  const totals = useMemo<DepreciationTotals>(
    () =>
      rows.reduce<DepreciationTotals>(
        (acc, r) => ({
          cost: round2(acc.cost + r.cost),
          openingAccumulated: round2(acc.openingAccumulated + r.openingAccumulated),
          periodExpense: round2(acc.periodExpense + r.periodExpense),
          closingAccumulated: round2(acc.closingAccumulated + r.closingAccumulated),
          netBookValue: round2(acc.netBookValue + r.netBookValue),
          assetCount: acc.assetCount + 1,
        }),
        {
          cost: 0,
          openingAccumulated: 0,
          periodExpense: 0,
          closingAccumulated: 0,
          netBookValue: 0,
          assetCount: 0,
        },
      ),
    [rows],
  );

  const classOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of classesQuery.data ?? []) seen.set(c.id as string, c.name as string);
    return Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [classesQuery.data]);

  /** Rolling 12-month series of cost, monthly charge, accumulated depreciation and NBV. */
  const trend = useMemo<DepreciationTrendPoint[]>(() => {
    const assets = (assetsQuery.data ?? [])
      .filter((a) => (branchKey ? a.branch_id === branchKey : true))
      .filter((a) => (classKey ? a.class_id === classKey : true))
      .filter((a) => (includeDisposed ? true : a.status !== "disposed"));
    if (assets.length === 0) return [];

    const assetIds = new Set(assets.map((a) => a.id as string));
    const entries = (depreciationQuery.data ?? []).filter((e) => assetIds.has(e.asset_id));

    // Monthly charge per month key (only entries for the assets in scope).
    const chargeByMonth = new Map<string, number>();
    for (const e of entries) {
      const key = String(e.period_month).slice(0, 7);
      chargeByMonth.set(key, (chargeByMonth.get(key) ?? 0) + Number(e.amount || 0));
    }

    const points: DepreciationTrendPoint[] = [];
    let runningAccumulated = 0;
    const months: Date[] = [];
    for (let i = 11; i >= 0; i--) {
      months.push(new Date(periodMonth.getFullYear(), periodMonth.getMonth() - i, 1));
    }

    // Accumulated depreciation charged before the first month in the window.
    const windowStart = monthKey(months[0]);
    for (const e of entries) {
      if (String(e.period_month) < windowStart) runningAccumulated += Number(e.amount || 0);
    }

    for (const m of months) {
      const mKey = monthKey(m);
      const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0);
      const mEndKey = `${mEnd.getFullYear()}-${String(mEnd.getMonth() + 1).padStart(2, "0")}-${String(mEnd.getDate()).padStart(2, "0")}`;
      const charge = round2(chargeByMonth.get(mKey.slice(0, 7)) ?? 0);
      runningAccumulated = round2(runningAccumulated + charge);

      const cost = round2(
        assets
          .filter(
            (a) =>
              String(a.in_service_date) <= mEndKey &&
              (!a.disposal_date || String(a.disposal_date) >= mKey),
          )
          .reduce((sum, a) => sum + Number(a.cost || 0), 0),
      );

      points.push({
        month: mKey,
        label: `${m.toLocaleString("en", { month: "short" })} ${String(m.getFullYear()).slice(2)}`,
        cost,
        periodExpense: charge,
        accumulated: runningAccumulated,
        netBookValue: round2(Math.max(cost - runningAccumulated, 0)),
      });
    }

    return points;
  }, [
    assetsQuery.data,
    depreciationQuery.data,
    periodMonth,
    branchKey,
    classKey,
    includeDisposed,
  ]);

  return {
    restaurantName: tenant?.name ?? "",
    rows,
    byBranch,
    byClass,
    byBranchClass,
    totals,
    classOptions,
    trend,
    period,
    periodEndKey,
    isLoading:
      assetsQuery.isLoading || classesQuery.isLoading || depreciationQuery.isLoading,
    error: assetsQuery.error ?? classesQuery.error ?? depreciationQuery.error ?? null,
  };
}
