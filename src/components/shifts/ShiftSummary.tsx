import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Loader2, TrendingUp, TrendingDown, Minus, Calculator } from "lucide-react";
import { cn } from "@/lib/utils";
import { DayEndAdjustedBadge } from "@/components/dayend/DayEndAdjustedBadge";

interface ShiftSummaryProps {
  /** The shift being summarized */
  shift: {
    id: string;
    opened_at: string;
    closed_at?: string | null;
    template_id?: string | null;
  } | null;
  /** Optional override end time (e.g. "now" while the shift is open) */
  endAtOverride?: string;
  /** Compact layout for embedding in cards */
  compact?: boolean;
  className?: string;
}

interface AccountRollup {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: "cogs" | "expense";
  actual: number;
  theoretical: number;
  variance: number;
  variancePct: number | null;
}

const HISTORICAL_SHIFT_COUNT = 5;

/**
 * ShiftSummary - rolls up expenses posted during a shift, grouped by
 * COGS (5000–) vs Other Expenses (6000–), with theoretical baselines
 * derived from the trailing average of the last N closed shifts of the
 * same template.
 *
 * Variance = actual − theoretical.  Negative = under budget (good for costs),
 * Positive = over budget (red flag).
 */
export function ShiftSummary({ shift, endAtOverride, compact = false, className }: ShiftSummaryProps) {
  const { restaurant } = useAuth();
  const { format: fmt } = useCurrency();
  const restaurantId = restaurant?.id;

  const endAt = endAtOverride || shift?.closed_at || new Date().toISOString();

  const { data, isLoading } = useQuery({
    queryKey: [
      "shift-summary",
      shift?.id,
      restaurantId,
      shift?.opened_at,
      endAt,
      shift?.template_id,
    ],
    enabled: !!shift && !!restaurantId,
    queryFn: async (): Promise<AccountRollup[]> => {
      if (!shift || !restaurantId) return [];

      // 1. Pull this shift's expenses (joined to chart_of_accounts)
      const { data: shiftExpenses, error: e1 } = await supabase
        .from("expenses")
        .select(
          `
          amount,
          account_id,
          chart_of_accounts:account_id (
            id,
            account_code,
            account_name,
            account_type
          )
        `,
        )
        .eq("restaurant_id", restaurantId)
        .eq("shift_id", shift.id)
        .is("deleted_at", null);

      if (e1) throw e1;

      // 2. Pull last N closed shifts of the same template (excluding this one) for baseline
      let historicalExpensesByAccount: Record<string, { total: number; shiftIds: Set<string> }> = {};

      let histShiftQuery = supabase
        .from("shifts")
        .select("id, opened_at, closed_at, template_id")
        .eq("restaurant_id", restaurantId)
        .eq("status", "closed")
        .neq("id", shift.id)
        .order("closed_at", { ascending: false })
        .limit(HISTORICAL_SHIFT_COUNT);

      if (shift.template_id) {
        histShiftQuery = histShiftQuery.eq("template_id", shift.template_id);
      } else {
        histShiftQuery = histShiftQuery.is("template_id", null);
      }

      const { data: histShifts } = await histShiftQuery;
      const histShiftIds = (histShifts || []).map((s) => s.id);

      if (histShiftIds.length > 0) {
        const { data: histExpenses } = await supabase
          .from("expenses")
          .select("amount, account_id, shift_id")
          .eq("restaurant_id", restaurantId)
          .in("shift_id", histShiftIds)
          .is("deleted_at", null)
          .not("account_id", "is", null);

        (histExpenses || []).forEach((e: any) => {
          if (!e.account_id) return;
          if (!historicalExpensesByAccount[e.account_id]) {
            historicalExpensesByAccount[e.account_id] = { total: 0, shiftIds: new Set() };
          }
          historicalExpensesByAccount[e.account_id].total += Number(e.amount) || 0;
          historicalExpensesByAccount[e.account_id].shiftIds.add(e.shift_id);
        });
      }

      // 3. Aggregate this shift's actuals by account
      const actualsByAccount: Record<string, AccountRollup> = {};
      (shiftExpenses || []).forEach((row: any) => {
        const coa = row.chart_of_accounts;
        if (!coa || !row.account_id) return;
        const type = coa.account_type;
        if (type !== "cogs" && type !== "expense") return;

        if (!actualsByAccount[row.account_id]) {
          actualsByAccount[row.account_id] = {
            account_id: row.account_id,
            account_code: coa.account_code,
            account_name: coa.account_name,
            account_type: type,
            actual: 0,
            theoretical: 0,
            variance: 0,
            variancePct: null,
          };
        }
        actualsByAccount[row.account_id].actual += Number(row.amount) || 0;
      });

      // 4. Also include accounts that *had* historical activity but no actuals (so user sees missed expected costs)
      const allAccountIds = new Set([
        ...Object.keys(actualsByAccount),
        ...Object.keys(historicalExpensesByAccount),
      ]);

      // Fetch metadata for any historical-only accounts
      const missingMetaIds = Array.from(allAccountIds).filter((id) => !actualsByAccount[id]);
      if (missingMetaIds.length > 0) {
        const { data: metaRows } = await supabase
          .from("chart_of_accounts")
          .select("id, account_code, account_name, account_type")
          .in("id", missingMetaIds);
        (metaRows || []).forEach((m: any) => {
          if (m.account_type !== "cogs" && m.account_type !== "expense") return;
          actualsByAccount[m.id] = {
            account_id: m.id,
            account_code: m.account_code,
            account_name: m.account_name,
            account_type: m.account_type,
            actual: 0,
            theoretical: 0,
            variance: 0,
            variancePct: null,
          };
        });
      }

      // 5. Apply theoretical (avg over the historical shifts that posted to that account)
      Object.values(actualsByAccount).forEach((r) => {
        const hist = historicalExpensesByAccount[r.account_id];
        if (hist && hist.shiftIds.size > 0) {
          r.theoretical = hist.total / hist.shiftIds.size;
        }
        r.variance = r.actual - r.theoretical;
        r.variancePct = r.theoretical > 0 ? (r.variance / r.theoretical) * 100 : null;
      });

      return Object.values(actualsByAccount).sort((a, b) =>
        a.account_code.localeCompare(b.account_code),
      );
    },
  });

  const { cogs, expenses, totals } = useMemo(() => {
    const rows = data || [];
    const cogs = rows.filter((r) => r.account_type === "cogs");
    const expenses = rows.filter((r) => r.account_type === "expense");
    const sum = (rs: AccountRollup[]) =>
      rs.reduce(
        (acc, r) => {
          acc.actual += r.actual;
          acc.theoretical += r.theoretical;
          return acc;
        },
        { actual: 0, theoretical: 0 },
      );
    const cogsTotal = sum(cogs);
    const expTotal = sum(expenses);
    return {
      cogs,
      expenses,
      totals: {
        cogs: { ...cogsTotal, variance: cogsTotal.actual - cogsTotal.theoretical },
        expenses: { ...expTotal, variance: expTotal.actual - expTotal.theoretical },
      },
    };
  }, [data]);

  if (!shift) return null;

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center py-6 text-muted-foreground", className)}>
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span className="text-xs">Loading shift summary…</span>
      </div>
    );
  }

  const hasAny = (data?.length || 0) > 0;

  return (
    <div className={cn("space-y-3", className)}>
      {!compact && (
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold">Shift Summary</h4>
          <DayEndAdjustedBadge
            scope="shift"
            scopeRefId={shift.id}
            businessDate={shift.opened_at?.slice(0, 10)}
            size="sm"
          />
          <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
            Theoretical = avg of last {HISTORICAL_SHIFT_COUNT} same-template shifts
          </span>
        </div>
      )}

      {!hasAny ? (
        <p className="text-xs text-muted-foreground py-3 text-center">
          No COGS or expense entries posted during this shift.
        </p>
      ) : (
        <>
          <RollupSection
            title="COGS (5000–)"
            rows={cogs}
            totals={totals.cogs}
            tone="cogs"
            fmt={fmt}
            compact={compact}
          />
          <RollupSection
            title="Other Expenses (6000–)"
            rows={expenses}
            totals={totals.expenses}
            tone="expense"
            fmt={fmt}
            compact={compact}
          />
        </>
      )}
    </div>
  );
}

function RollupSection({
  title,
  rows,
  totals,
  tone,
  fmt,
  compact,
}: {
  title: string;
  rows: AccountRollup[];
  totals: { actual: number; theoretical: number; variance: number };
  tone: "cogs" | "expense";
  fmt: (n: number) => string;
  compact: boolean;
}) {
  if (rows.length === 0) return null;
  const accent = tone === "cogs" ? "border-primary/30 bg-primary/5" : "border-border bg-muted/30";

  return (
    <div className={cn("rounded-lg border p-3", accent)}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <span className="text-[10px] text-muted-foreground">{rows.length} account{rows.length === 1 ? "" : "s"}</span>
      </div>

      <div className="space-y-1">
        {rows.map((r) => (
          <RollupRow key={r.account_id} row={r} fmt={fmt} compact={compact} />
        ))}
      </div>

      <div className="mt-2 pt-2 border-t border-border/60 flex items-center justify-between text-xs">
        <span className="font-semibold">Total</span>
        <div className="flex items-center gap-3 font-mono">
          <span className="text-muted-foreground">Theo {fmt(totals.theoretical)}</span>
          <span className="font-semibold">{fmt(totals.actual)}</span>
          <VarianceBadge variance={totals.variance} variancePct={totals.theoretical > 0 ? (totals.variance / totals.theoretical) * 100 : null} fmt={fmt} />
        </div>
      </div>
    </div>
  );
}

function RollupRow({ row, fmt, compact }: { row: AccountRollup; fmt: (n: number) => string; compact: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs py-1">
      <span className="font-mono text-[10px] text-muted-foreground w-12 shrink-0">{row.account_code}</span>
      <span className={cn("flex-1 truncate", compact && "text-[11px]")}>{row.account_name}</span>
      <span className="font-mono text-muted-foreground w-20 text-right shrink-0">{fmt(row.theoretical)}</span>
      <span className="font-mono w-20 text-right shrink-0">{fmt(row.actual)}</span>
      <div className="w-24 flex justify-end shrink-0">
        <VarianceBadge variance={row.variance} variancePct={row.variancePct} fmt={fmt} />
      </div>
    </div>
  );
}

function VarianceBadge({
  variance,
  variancePct,
  fmt,
}: {
  variance: number;
  variancePct: number | null;
  fmt: (n: number) => string;
}) {
  const eps = 0.005;
  const isOver = variance > eps;
  const isUnder = variance < -eps;
  const Icon = isOver ? TrendingUp : isUnder ? TrendingDown : Minus;
  const tone = isOver
    ? "bg-destructive/10 text-destructive border-destructive/30"
    : isUnder
      ? "bg-success/10 text-success border-success/30"
      : "bg-muted text-muted-foreground border-border";
  const sign = isOver ? "+" : isUnder ? "−" : "";
  const label = `${sign}${fmt(Math.abs(variance))}`;
  const pct =
    variancePct === null
      ? "-"
      : `${variancePct > 0 ? "+" : ""}${variancePct.toFixed(0)}%`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium font-mono",
        tone,
      )}
      title={`Variance ${label} (${pct}) vs theoretical baseline`}
    >
      <Icon className="h-3 w-3" />
      {label}
      {variancePct !== null && <span className="opacity-70">({pct})</span>}
    </span>
  );
}