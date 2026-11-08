import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { FileText, Users, ArrowRight, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

interface SettlementMetrics {
  totalUnpaidAmount: number;
  totalCustomersWithBalance: number;
  overdueInvoices: number;
  pendingInvoices: number;
}

export function PendingSettlementsCard() {
  const navigate = useNavigate();
  const { restaurant } = useAuth();
  const { activeBranchId, activeBranch } = useBranch();
  const { format: formatCurrency } = useCurrency();
  const { t } = useTranslation();

  const { data: metrics, isLoading } = useQuery({
    queryKey: ["settlement-metrics", restaurant?.id, activeBranchId],
    queryFn: async (): Promise<SettlementMetrics> => {
      if (!restaurant?.id) {
        return {
          totalUnpaidAmount: 0,
          totalCustomersWithBalance: 0,
          overdueInvoices: 0,
          pendingInvoices: 0,
        };
      }

      // Server-side aggregation: 1 row instead of 3 unbounded list queries.
      const { data, error } = await (supabase as any).rpc("dashboard_settlements_summary", {
        p_restaurant_id: restaurant.id,
        p_branch_id: activeBranchId,
      });
      if (error) throw error;
      const row = data?.[0];
      return {
        totalUnpaidAmount: Number(row?.total_unpaid_amount ?? 0),
        totalCustomersWithBalance: Number(row?.customers_with_balance ?? 0),
        overdueInvoices: Number(row?.overdue_invoices ?? 0),
        pendingInvoices: Number(row?.pending_invoices ?? 0),
      };
    },
    enabled: !!restaurant?.id,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="h-4 w-32 rounded skeleton-shimmer" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="h-8 w-24 rounded skeleton-shimmer" />
            <div className="h-2 w-full rounded skeleton-shimmer" />
            <div className="h-4 w-40 rounded skeleton-shimmer" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasOverdue = metrics && metrics.overdueInvoices > 0;

  return (
    <Card className={`h-full flex flex-col ${hasOverdue ? "border-destructive/50" : ""}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-3 text-[11px] font-bold uppercase text-muted-foreground">
          <span className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            {t("app.dashboard.settlements.title")}
          </span>
          {hasOverdue && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              {t("app.dashboard.settlements.overdue", { count: metrics.overdueInvoices })}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 flex-1 flex flex-col">
        {/* Total Unbilled Revenue */}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <span className="font-display text-2xl font-semibold tabular-nums">
              {formatCurrency(metrics?.totalUnpaidAmount || 0)}
            </span>
            <span className="text-xs text-muted-foreground">{t("app.dashboard.settlements.unbilled")}</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {activeBranchId ? activeBranch?.name ?? "Current branch" : "All branches"}
          </p>
          <Progress 
            value={Math.min((metrics?.totalUnpaidAmount || 0) / 10000 * 100, 100)} 
            className="h-2" 
          />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              {t("app.dashboard.settlements.customers", { count: metrics?.totalCustomersWithBalance || 0 })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              {t("app.dashboard.settlements.invoices", { count: metrics?.pendingInvoices || 0 })}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-auto">
          <Button
            variant="outline"
            size="sm"
            className="min-w-0 flex-1 gap-1"
            onClick={() => navigate("/customers")}
          >
            <Users className="h-4 w-4" />
            {t("app.dashboard.settlements.customersBtn")}
          </Button>
          <Button
            size="sm"
            className="min-w-0 flex-1 gap-1"
            onClick={() => navigate("/settlements")}
          >
            {t("app.dashboard.settlements.settlementsBtn")}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
