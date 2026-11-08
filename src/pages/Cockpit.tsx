import { useMemo } from "react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { Smartphone, TrendingUp, TrendingDown, DollarSign, AlertTriangle, Receipt, Wallet, ArrowRight, ClipboardCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDailyProfit } from "@/hooks/useDailyProfit";
import { useCurrency } from "@/hooks/useCurrency";
import { useAuth } from "@/contexts/AuthContext";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

const card = "rounded-2xl border bg-card/80 backdrop-blur-sm shadow-sm";

function Trend({ curr, prev }: { curr: number; prev: number }) {
  if (!prev) return <span className="text-xs text-muted-foreground">-</span>;
  const d = ((curr - prev) / Math.abs(prev)) * 100;
  const up = d >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", up ? "text-success" : "text-destructive")}>
      <Icon className="h-3 w-3" />
      {Math.abs(d).toFixed(0)}%
    </span>
  );
}

export default function Cockpit() {
  const { restaurant } = useAuth();
  const { format: fmt } = useCurrency();
  const { t } = useTranslation();
  const today = new Date();
  const { today: state, yesterday, isLoading } = useDailyProfit(today);

  const cogsPct = state?.netSales ? ((state.foodCost + state.beverageCost) / state.netSales) * 100 : 0;
  const cogsColor = cogsPct < 32 ? "text-success" : cogsPct < 38 ? "text-warning" : "text-destructive";

  const tiles = useMemo(
    () => [
      { label: t("app.cockpit.revenue"), value: state?.netSales ?? 0, prev: yesterday?.netSales ?? 0 },
      { label: t("app.cockpit.netProfit"), value: state?.operatingProfit ?? 0, prev: yesterday?.operatingProfit ?? 0 },
    ],
    [state, yesterday, t]
  );

  return (
    <>
      <div className="min-h-screen bg-gradient-to-b from-success/5 via-background to-background">
        <div className="max-w-md mx-auto p-4 space-y-4">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="flex items-center justify-between"
          >
            <div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                <Smartphone className="h-3 w-3" />
                {t("app.cockpit.header")}
              </div>
              <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">{restaurant?.name ?? t("app.cockpit.today")}</h1>
              <p className="text-sm text-muted-foreground mt-1">{format(today, "EEEE, d MMM yyyy")}</p>
            </div>
            <Badge variant="outline" className="text-[10px]">{t("app.cockpit.live")}</Badge>
          </motion.div>

          {/* Profit hero */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25, delay: 0.05 }}
            className={cn(card, "p-6 bg-gradient-to-br from-success/10 to-success/0")}
          >
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t("app.cockpit.todaysProfit")}</div>
            {isLoading ? (
              <Skeleton className="h-10 w-40 mt-2" />
            ) : (
              <div className="mt-2 flex items-baseline gap-3">
                <div className="text-4xl font-semibold tracking-tight">
                  {fmt(state?.operatingProfit ?? 0)}
                </div>
                <Trend curr={state?.operatingProfit ?? 0} prev={yesterday?.operatingProfit ?? 0} />
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">{t("app.cockpit.vsYesterday")}</p>
          </motion.div>

          {/* KPI tiles */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.1 }}
            className="grid grid-cols-2 gap-3"
          >
            {tiles.map((t) => (
              <Card key={t.label} className="rounded-2xl">
                <CardContent className="pt-6">
                  <div className="text-[11px] uppercase text-muted-foreground">{t.label}</div>
                  <div className="text-lg font-semibold mt-1 tabular-nums">{fmt(t.value)}</div>
                  <Trend curr={t.value} prev={t.prev} />
                </CardContent>
              </Card>
            ))}
            <Card className="rounded-2xl col-span-2">
              <CardContent className="pt-6 flex items-center justify-between">
                <div>
                  <div className="text-[11px] uppercase text-muted-foreground">{t("app.cockpit.estCogs")}</div>
                  <div className={cn("text-lg font-semibold mt-1 tabular-nums", cogsColor)}>
                    {cogsPct.toFixed(1)}%
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {fmt((state?.foodCost ?? 0) + (state?.beverageCost ?? 0))}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Status row */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.15 }}
            className={cn(card, "p-4")}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{t("app.cockpit.primeCost")}</span>
              </div>
              <span className="tabular-nums text-sm">{(state?.primeCostPercentage ?? 0).toFixed(1)}%</span>
            </div>
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{t("app.cockpit.unpaidExpenses")}</span>
              </div>
              <span className="tabular-nums text-sm">{fmt(state?.unpaidExpenses ?? 0)}</span>
            </div>
          </motion.div>

          {/* Quick actions */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.2 }}
            className="grid grid-cols-2 gap-3"
          >
            <Button asChild variant="default" className="h-14 rounded-2xl">
              <NavLink to="/record-sale">
                <Receipt className="h-4 w-4 mr-2" /> {t("app.cockpit.recordSale")}
              </NavLink>
            </Button>
            <Button asChild variant="outline" className="h-14 rounded-2xl">
              <NavLink to="/shifts">
                <DollarSign className="h-4 w-4 mr-2" /> {t("app.cockpit.shifts")}
              </NavLink>
            </Button>
            <Button asChild variant="secondary" className="h-14 rounded-2xl col-span-2">
              <NavLink to="/cockpit/stocktake">
                <ClipboardCheck className="h-4 w-4 mr-2" /> {t("app.cockpit.submitStocktake")}
              </NavLink>
            </Button>
            <Button asChild variant="outline" className="h-14 rounded-2xl col-span-2">
              <NavLink to="/daily-profit">
                {t("app.cockpit.fullPnl")}
                <ArrowRight className="h-4 w-4 ml-2" />
              </NavLink>
            </Button>
          </motion.div>

          <p className="text-center text-[10px] text-muted-foreground pt-2">
            {t("app.cockpit.optimizedHint")}
          </p>
        </div>
      </div>
    </>
  );
}