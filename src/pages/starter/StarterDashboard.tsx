import { Link } from "react-router-dom";
import { ShoppingCart, FileText, Clock, UtensilsCrossed, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useStarterDaily, formatMoney } from "@/hooks/useStarterDaily";

export default function StarterDashboard() {
  const { restaurant } = useAuth();
  const { data, isLoading, today } = useStarterDaily(7);
  const todayRow = data?.find((r) => r.date === today);
  const week = (data ?? []).reduce(
    (a, r) => ({ sales: a.sales + r.total, exp: a.exp + r.expenses }),
    { sales: 0, exp: 0 },
  );

  const tiles = [
    { label: "Today's sales", value: todayRow?.total ?? 0 },
    { label: "Cash", value: todayRow?.cash ?? 0 },
    { label: "Card", value: todayRow?.card ?? 0 },
    { label: "Today's profit", value: (todayRow?.total ?? 0) - (todayRow?.expenses ?? 0) },
  ];

  const actions = [
    { to: "/record-sale", label: "Open till", icon: ShoppingCart },
    { to: "/daily-report", label: "Daily report", icon: FileText },
    { to: "/shifts", label: "Shifts & cash drawer", icon: Clock },
    { to: "/menu", label: "Menu", icon: UtensilsCrossed },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Starter plan</p>
          <h1 className="text-2xl font-semibold">{restaurant?.name ?? "Dashboard"}</h1>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/pricing"><Sparkles className="me-2 h-4 w-4" />Upgrade to Growth</Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{t.label}</p>
              {isLoading ? <Skeleton className="mt-2 h-7 w-24" /> : (
                <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(t.value)}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {actions.map((a) => (
          <Button key={a.to} asChild variant="secondary" className="h-20 flex-col gap-2">
            <Link to={a.to}><a.icon className="h-5 w-5" />{a.label}</Link>
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Last 7 days</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Sales</span><span className="tabular-nums">{formatMoney(week.sales)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Expenses</span><span className="tabular-nums">{formatMoney(week.exp)}</span></div>
          <div className="flex justify-between font-medium"><span>Profit</span><span className="tabular-nums">{formatMoney(week.sales - week.exp)}</span></div>
        </CardContent>
      </Card>
    </div>
  );
}
