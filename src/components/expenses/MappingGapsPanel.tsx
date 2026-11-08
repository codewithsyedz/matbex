import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface GapEvent {
  category_id: string;
  created_at: string;
}

interface ExpenseCategoryRow {
  id: string;
  name: string;
  color: string | null;
  account_id: string | null;
}

interface RankedCategory {
  id: string;
  name: string;
  color: string | null;
  hits: number;
  hitsLast30d: number;
  lastHitAt: string | null;
  isMapped: boolean;
}

/**
 * Shows owners/managers which expense categories are most frequently
 * saved without a Chart of Accounts mapping, so they can fix the worst
 * offenders first.
 */
export function MappingGapsPanel() {
  const { t } = useTranslation();
  const { restaurant, isManager } = useAuth();
  const navigate = useNavigate();

  const { data: categories = [] } = useQuery({
    queryKey: ["expense-categories-mapping", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [] as ExpenseCategoryRow[];
      const { data, error } = await supabase
        .from("expense_categories")
        .select("id, name, color, account_id")
        .eq("restaurant_id", restaurant.id);
      if (error) throw error;
      return data as ExpenseCategoryRow[];
    },
    enabled: !!restaurant?.id,
  });

  const { data: gaps = [], isLoading } = useQuery({
    queryKey: ["expense-mapping-gaps", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [] as GapEvent[];
      const sb = supabase as any;
      const { data, error } = await sb
        .from("expense_category_mapping_gaps")
        .select("category_id, created_at")
        .eq("restaurant_id", restaurant.id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as GapEvent[];
    },
    enabled: !!restaurant?.id && isManager,
    refetchInterval: 30_000,
  });

  if (!isManager) return null;

  const cutoff30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const byCategory = new Map<string, { hits: number; hits30d: number; lastHitAt: string | null }>();
  for (const g of gaps) {
    const entry = byCategory.get(g.category_id) ?? { hits: 0, hits30d: 0, lastHitAt: null };
    entry.hits += 1;
    if (new Date(g.created_at).getTime() >= cutoff30d) entry.hits30d += 1;
    if (!entry.lastHitAt || g.created_at > entry.lastHitAt) entry.lastHitAt = g.created_at;
    byCategory.set(g.category_id, entry);
  }

  const ranked: RankedCategory[] = categories
    .map((c) => {
      const stats = byCategory.get(c.id) ?? { hits: 0, hits30d: 0, lastHitAt: null };
      return {
        id: c.id,
        name: c.name,
        color: c.color,
        hits: stats.hits,
        hitsLast30d: stats.hits30d,
        lastHitAt: stats.lastHitAt,
        isMapped: !!c.account_id,
      };
    })
    .filter((c) => !c.isMapped && c.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.hitsLast30d - a.hitsLast30d);

  const totalUnmapped = categories.filter((c) => !c.account_id).length;
  const totalGapEvents = gaps.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            {t("app.expenses.mapping.title")}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {t("app.expenses.mapping.summary", { unmapped: totalUnmapped, events: totalGapEvents })}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : ranked.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            {t("app.expenses.mapping.empty")}
          </div>
        ) : (
          <div className="space-y-1.5">
            {ranked.slice(0, 8).map((c, idx) => (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(`/expenses?editCategory=${c.id}`)}
                className="w-full flex items-center gap-3 rounded-md border border-border bg-background hover:bg-muted/60 transition-colors px-3 py-2 text-start"
              >
                <span className="font-mono text-xs text-muted-foreground w-5">
                  #{idx + 1}
                </span>
                {c.color && (
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: c.color }}
                  />
                )}
                <span className="flex-1 text-sm font-medium truncate">{c.name}</span>
                <Badge
                  variant="outline"
                  className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px]"
                >
                  {t("app.expenses.mapping.hits", { count: c.hits })}
                </Badge>
                {c.hitsLast30d > 0 && (
                  <span className="text-[11px] text-muted-foreground hidden sm:inline">
                    {t("app.expenses.mapping.last30Days", { count: c.hitsLast30d })}
                  </span>
                )}
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground rtl:rotate-180" />
              </button>
            ))}
            {ranked.length > 8 && (
              <p className="text-[11px] text-muted-foreground pt-1">
                {t("app.expenses.mapping.more", { count: ranked.length - 8 })}
              </p>
            )}
            <div className="pt-2">
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => ranked[0] && navigate(`/expenses?editCategory=${ranked[0].id}`)}
              >
                {t("app.expenses.mapping.fixPriority", { name: ranked[0]?.name })}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}