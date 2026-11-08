import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, Wallet, Receipt } from "lucide-react";
import { getRestaurantDayBoundsUTC } from "@/lib/timezone";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { useDashboardFilterStore } from "@/stores/dashboardFilterStore";
import { startOfDay, endOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface TodayTickerBadgesProps {
  /** Hide uppercase metric labels (Today Sales / Expenses / Transactions). */
  compact?: boolean;
}

type ChangeKind = "up" | "down" | null;

/** Tracks deltas for a numeric value and returns the latest change direction. */
function useChangeFlash(value: number) {
  const prev = useRef<number | null>(null);
  const [flash, setFlash] = useState<ChangeKind>(null);
  const [pulseKey, setPulseKey] = useState(0);

  useEffect(() => {
    if (prev.current === null) {
      prev.current = value;
      return;
    }
    if (value === prev.current) return;
    const dir: ChangeKind = value > prev.current ? "up" : "down";
    prev.current = value;
    setFlash(dir);
    setPulseKey((k) => k + 1);
    const t = window.setTimeout(() => setFlash(null), 1400);
    return () => window.clearTimeout(t);
  }, [value]);

  return { flash, pulseKey };
}

export function TodayTickerBadges({ compact = false }: TodayTickerBadgesProps = {}) {
  const { restaurant } = useAuth();
  const { isCashierOnly } = useRoleGuard();
  if (!restaurant || isCashierOnly) return null;

  const { activeBranchId } = useBranch();
  const { format: formatCurrency } = useCurrency();
  const timezone = restaurant?.timezone || "Asia/Riyadh";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const setStoredRange = useDashboardFilterStore((s) => s.setDateRange);

  const focusDashboard = (section: "section-sales" | "section-expenses") => {
    // Pre-seed the dashboard filter store so the dashboard renders "today"
    // immediately, then deep-link via hash so Index.tsx scrolls to the card.
    const today = new Date();
    setStoredRange({
      from: startOfDay(today).toISOString(),
      to: endOfDay(today).toISOString(),
      preset: "today",
    });
    navigate(`/dashboard#${section}`);
  };

  const { data, isLoading } = useQuery({
    queryKey: ["today-ticker", restaurant?.id, activeBranchId],
    enabled: !!restaurant?.id,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const today = new Date();
      const { start, endExclusive } = getRestaurantDayBoundsUTC(today, timezone);
      const startISO = start.toISOString();
      const endISO = endExclusive.toISOString();
      const startDate = format(today, "yyyy-MM-dd");

      const [salesRes, expensesRes] = await Promise.all([
        (supabase as any).rpc("dashboard_sales_summary", {
          p_restaurant_id: restaurant!.id,
          p_start: startISO,
          p_end: endISO,
          p_branch_id: activeBranchId,
        }),
        (supabase as any).rpc("dashboard_expense_summary", {
          p_restaurant_id: restaurant!.id,
          p_start_date: startDate,
          p_end_date: startDate,
          p_branch_id: activeBranchId,
        }),
      ]);

      const s = salesRes.data?.[0] || {};
      const e = expensesRes.data?.[0] || {};

      return {
        netSales: Number(s.net_sales || 0),
        totalTransactions: Number(s.total_transactions || 0),
        totalExpenses: Number(e.total_expenses || 0),
      };
    },
  });

  // Real-time refresh: invalidate the ticker whenever a sale or expense
  // is created, updated, or deleted for this restaurant.
  useEffect(() => {
    if (!restaurant?.id) return;
    const filter = `restaurant_id=eq.${restaurant.id}`;
    const channel = supabase
      .channel(`ticker-rt-${restaurant.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_transactions", filter }, () => {
        qc.invalidateQueries({ queryKey: ["today-ticker", restaurant.id, activeBranchId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses", filter }, () => {
        qc.invalidateQueries({ queryKey: ["today-ticker", restaurant.id, activeBranchId] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [restaurant?.id, qc, activeBranchId]);

  if (isLoading) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-7 w-24" />
      </div>
    );
  }

  const sales = data?.netSales || 0;
  const expenses = data?.totalExpenses || 0;
  const txns = data?.totalTransactions || 0;

  // Net positive when sales exceed expenses; "off" when expenses outpace sales.
  const isPerfect = sales > 0 && sales >= expenses;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <AnimatedTickerBadge
        kind="sales"
        value={sales}
        formatted={formatCurrency(sales)}
        label="Today Sales"
        compact={compact}
        Icon={DollarSign}
        state={isPerfect ? "perfect" : "off"}
        onClick={() => focusDashboard("section-sales")}
        ariaLabel="View today's sales on dashboard"
      />
      <AnimatedTickerBadge
        kind="expenses"
        value={expenses}
        formatted={formatCurrency(expenses)}
        label="Expenses"
        compact={compact}
        Icon={Wallet}
        state={expenses > sales && expenses > 0 ? "off" : "neutral"}
        onClick={() => focusDashboard("section-expenses")}
        ariaLabel="View today's expenses on dashboard"
      />
      <AnimatedTickerBadge
        kind="txns"
        value={txns}
        formatted={String(txns)}
        label="Transactions"
        compact={compact}
        Icon={Receipt}
        state="neutral"
        onClick={() => focusDashboard("section-sales")}
        ariaLabel="View today's transactions on dashboard"
      />
    </div>
  );
}

type BadgeState = "perfect" | "off" | "neutral";

interface AnimatedTickerBadgeProps {
  kind: "sales" | "expenses" | "txns";
  value: number;
  formatted: string;
  label: string;
  compact: boolean;
  Icon: React.ComponentType<{ className?: string }>;
  state: BadgeState;
  onClick: () => void;
  ariaLabel: string;
}

function AnimatedTickerBadge({
  kind,
  value,
  formatted,
  label,
  compact,
  Icon,
  state,
  onClick,
  ariaLabel,
}: AnimatedTickerBadgeProps) {
  const { flash, pulseKey } = useChangeFlash(value);

  // Base palette per metric kind (resting state).
  const basePalette =
    kind === "sales"
      ? "bg-success/10 border-success/30 hover:bg-success/15 focus:ring-success/40"
      : kind === "expenses"
        ? "bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/15 focus:ring-amber-500/40"
        : "bg-primary/10 border-primary/30 hover:bg-primary/15 focus:ring-primary/40";

  // State accent overlays (perfect = success ring, off = destructive ring).
  const stateAccent =
    state === "perfect"
      ? "ring-1 ring-success/40"
      : state === "off"
        ? "ring-1 ring-destructive/40"
        : "";

  const iconColor =
    kind === "sales" ? "text-success" : kind === "expenses" ? "text-amber-600" : "text-primary";

  // Flash accent on update - green tint for "up", red for "down".
  const flashClass =
    flash === "up"
      ? "bg-success/25 border-success/50"
      : flash === "down"
        ? "bg-destructive/20 border-destructive/50"
        : "";

  return (
    <motion.div
      layout
      animate={
        flash
          ? { scale: [1, 1.06, 1] }
          : state === "off"
            ? { x: [0, -1.5, 1.5, -1, 1, 0] }
            : { scale: 1, x: 0 }
      }
      transition={{ duration: flash ? 0.45 : 0.6, ease: "easeOut" }}
    >
      <Badge
        variant="outline"
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()}
        className={cn(
          "relative h-7 gap-1.5 px-2.5 cursor-pointer transition-all duration-300 focus:outline-none focus:ring-2",
          basePalette,
          stateAccent,
          flashClass,
        )}
        aria-label={ariaLabel}
      >
        {/* Soft pulse ring on each update */}
        <AnimatePresence>
          {flash && (
            <motion.span
              key={pulseKey}
              initial={{ opacity: 0.6, scale: 1 }}
              animate={{ opacity: 0, scale: 1.35 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className={cn(
                "pointer-events-none absolute inset-0 rounded-full",
                flash === "up" ? "bg-success/30" : "bg-destructive/25",
              )}
              aria-hidden
            />
          )}
        </AnimatePresence>

        <Icon className={cn("h-3.5 w-3.5 relative z-10", iconColor)} />
        {!compact && (
          <span className="relative z-10 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            {label}
          </span>
        )}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={formatted}
            initial={{ y: -6, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 6, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className={cn(
              "relative z-10 text-xs font-semibold tabular-nums",
              flash === "up"
                ? "text-success"
                : flash === "down"
                  ? "text-destructive"
                  : "text-foreground",
            )}
          >
            {formatted}
          </motion.span>
        </AnimatePresence>
      </Badge>
    </motion.div>
  );
}
