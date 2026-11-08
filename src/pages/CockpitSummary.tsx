import { useEffect, useMemo } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ClipboardCheck, Loader2, AlertTriangle, CheckCircle2, Sun, Moon } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useWhatsAppSubscription } from "@/hooks/useWhatsAppSubscription";
import { useCurrency } from "@/hooks/useCurrency";
import { useTranslation } from "react-i18next";

function ymdRiyadhToday(): string {
  const shifted = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function fmtTime(iso: string | null): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Riyadh",
    });
  } catch {
    return "-";
  }
}

function StatCell({ label, value, accent }: { label: string; value: string; accent?: "good" | "bad" | "warn" }) {
  const tone =
    accent === "good"
      ? "text-success"
      : accent === "bad"
      ? "text-destructive"
      : accent === "warn"
      ? "text-warning"
      : "text-foreground";
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-medium ${tone}`}>{value}</p>
    </div>
  );
}

export default function CockpitSummary() {
  const { ymd } = useParams<{ ymd: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { preview } = useWhatsAppSubscription();
  const { format: fmt } = useCurrency();
  const { t } = useTranslation();

  const date = useMemo(() => ymd ?? ymdRiyadhToday(), [ymd]);

  useEffect(() => {
    preview.mutate({ date });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Scroll to deep-linked section (e.g. #shifts from the WhatsApp message)
  // once data has rendered. We re-run when data loads so the target exists.
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.replace(/^#/, "");
    if (!id) return;
    // Defer to next frame so layout is settled after data renders.
    const t = window.setTimeout(() => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        el.classList.add("ring-2", "ring-primary/40", "rounded-lg");
        window.setTimeout(() => {
          el.classList.remove("ring-2", "ring-primary/40", "rounded-lg");
        }, 1800);
      }
    }, 150);
    return () => window.clearTimeout(t);
  }, [location.hash, preview.data]);

  const data = preview.data;
  const today = data?.today;
  const b = today?.breakdown;

  const dateLabel = (() => {
    try {
      return format(parseISO(date), "EEEE, d MMM yyyy");
    } catch {
      return date;
    }
  })();

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap min-h-[56px]">
        <div className="flex items-center gap-3 min-w-[240px] flex-1">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">{t("app.cockpitSummary.title")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("app.cockpitSummary.subtitle", { date: dateLabel })}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {today?.isEstimated && (
            <Badge variant="outline" className="text-warning border-warning/40">
              {t("app.cockpitSummary.cogsEstimated")}
            </Badge>
          )}
          <Button asChild variant="outline" size="sm">
            <Link to="/cockpit/stocktake">
              <ClipboardCheck className="h-4 w-4 mr-2" />
              {t("app.cockpitSummary.submitStocktake")}
            </Link>
          </Button>
        </div>
      </div>

      {preview.isPending && !data && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          {t("app.cockpitSummary.loading")}
        </div>
      )}

      {data && today && b && (
        <>
          {/* Headline KPI strip */}
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
                <StatCell label={t("app.cockpitSummary.kpi.revenue")} value={fmt(today.totalSales)} />
                <StatCell label={t("app.cockpitSummary.kpi.cogs")} value={`${fmt(today.totalCOGS)} (${today.cogsPct.toFixed(1)}%)`} />
                <StatCell label={t("app.cockpitSummary.kpi.laborOverhead")} value={fmt(today.dailyLabor + today.dailyOverhead)} />
                <StatCell label={t("app.cockpitSummary.kpi.otherExpenses")} value={fmt(today.totalExpenses)} />
                <StatCell
                  label={t("app.cockpitSummary.kpi.netProfit")}
                  value={fmt(today.profit)}
                  accent={today.profit >= 0 ? "good" : "bad"}
                />
              </div>
            </CardContent>
          </Card>

          {/* Net profit formula */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">{t("app.cockpitSummary.netProfitCompTitle")}</CardTitle>
              <CardDescription>{t("app.cockpitSummary.netProfitCompDesc", { value: fmt(today.profit) })}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span>{t("app.cockpitSummary.kpi.revenue")}</span><span className="font-mono">{fmt(today.totalSales)}</span></div>
                <div className="flex justify-between text-muted-foreground"><span>{t("app.cockpitSummary.minusCogs")}</span><span className="font-mono">{fmt(today.totalCOGS)}</span></div>
                <div className="flex justify-between text-muted-foreground"><span>{t("app.cockpitSummary.minusLabor", { count: b.labor.staffCount })}</span><span className="font-mono">{fmt(today.dailyLabor)}</span></div>
                <div className="flex justify-between text-muted-foreground"><span>{t("app.cockpitSummary.minusOverhead", { count: b.overhead.items.length })}</span><span className="font-mono">{fmt(today.dailyOverhead)}</span></div>
                <div className="flex justify-between text-muted-foreground"><span>{t("app.cockpitSummary.minusOtherExpenses", { count: b.expenses.items.length })}</span><span className="font-mono">{fmt(today.totalExpenses)}</span></div>
                <Separator className="my-2" />
                <div className="flex justify-between font-medium"><span>{t("app.cockpitSummary.equalsNetProfit")}</span><span className="font-mono">{fmt(today.profit)}</span></div>
              </div>
            </CardContent>
          </Card>

          {/* Shifts drilldown */}
          <Card id="shifts" className="scroll-mt-20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="text-base font-medium">{t("app.cockpitSummary.shiftsTitle")}</CardTitle>
                  <CardDescription>
                    {t("app.cockpitSummary.shiftsDesc", { total: b.shifts.total, open: b.shifts.open, variance: fmt(b.shifts.variance) })}
                  </CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/shifts">{t("app.cockpitSummary.viewAllShifts")}</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {(b.shifts.items?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground py-4">{t("app.cockpitSummary.noShifts")}</p>
              ) : (
                <ScrollArea className="max-h-[420px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10"></TableHead>
                        <TableHead>{t("app.cockpitSummary.col.cashier")}</TableHead>
                        <TableHead>{t("app.cockpitSummary.col.opened")}</TableHead>
                        <TableHead>{t("app.cockpitSummary.col.closed")}</TableHead>
                        <TableHead className="text-right">{t("app.cockpitSummary.col.expected")}</TableHead>
                        <TableHead className="text-right">{t("app.cockpitSummary.col.counted")}</TableHead>
                        <TableHead className="text-right">{t("app.cockpitSummary.col.variance")}</TableHead>
                        <TableHead>{t("app.cockpitSummary.col.status")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {b.shifts.items.map((s: any) => {
                        const v = Number(s.variance ?? 0);
                        const tone =
                          Math.abs(v) < 1 ? "text-muted-foreground" : v < 0 ? "text-destructive" : "text-success";
                        const Icon = s.sales_mode === "night" ? Moon : Sun;
                        return (
                          <TableRow key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/shifts?shift=${s.id}`)}>
                            <TableCell><Icon className="h-4 w-4 text-muted-foreground" /></TableCell>
                            <TableCell className="font-medium">{s.cashier_name ?? "-"}</TableCell>
                            <TableCell className="font-mono text-xs">{fmtTime(s.opened_at)}</TableCell>
                            <TableCell className="font-mono text-xs">{fmtTime(s.closed_at)}</TableCell>
                            <TableCell className="text-right font-mono">{s.expected_cash == null ? "-" : fmt(s.expected_cash)}</TableCell>
                            <TableCell className="text-right font-mono">{s.counted_cash == null ? "-" : fmt(s.counted_cash)}</TableCell>
                            <TableCell className={`text-right font-mono ${tone}`}>{fmt(v)}</TableCell>
                            <TableCell>
                              <Badge variant={s.status === "open" ? "outline" : "secondary"} className="capitalize">
                                {s.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
              {b.shifts.open > 0 && (
                <div className="flex items-center gap-2 mt-3 text-warning text-xs">
                  <AlertTriangle className="h-4 w-4" />
                  {t("app.cockpitSummary.shiftsStillOpen", { count: b.shifts.open })}
                </div>
              )}
              {b.shifts.open === 0 && b.shifts.total > 0 && (
                <div className="flex items-center gap-2 mt-3 text-success text-xs">
                  <CheckCircle2 className="h-4 w-4" />
                  {t("app.cockpitSummary.allShiftsClosed")}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Expenses drilldown */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="text-base font-medium">{t("app.cockpitSummary.otherExpensesTitle")}</CardTitle>
                  <CardDescription>
                    {t("app.cockpitSummary.otherExpensesDesc", { count: b.expenses.items.length, total: fmt(b.expenses.total) })}
                  </CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/expenses">{t("app.cockpitSummary.viewAllExpenses")}</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {b.expenses.items.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">{t("app.cockpitSummary.noExpenses")}</p>
              ) : (
                <ScrollArea className="max-h-[420px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("app.cockpitSummary.expCol.description")}</TableHead>
                        <TableHead>{t("app.cockpitSummary.expCol.category")}</TableHead>
                        <TableHead>{t("app.cockpitSummary.expCol.payment")}</TableHead>
                        <TableHead>{t("app.cockpitSummary.expCol.status")}</TableHead>
                        <TableHead className="text-right">{t("app.cockpitSummary.expCol.amount")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {b.expenses.items.map((e: any) => (
                        <TableRow
                          key={e.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => navigate(`/expenses?expense=${e.id}`)}
                        >
                          <TableCell className="font-medium">{e.description}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">{e.category ?? "-"}</TableCell>
                          <TableCell className="text-muted-foreground text-xs capitalize">{e.payment_method ?? "-"}</TableCell>
                          <TableCell>
                            <Badge variant={e.status === "paid" ? "secondary" : "outline"} className="capitalize">
                              {e.status ?? "-"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">{fmt(e.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {preview.isError && (
        <Card>
          <CardContent className="pt-6 text-center text-sm text-destructive">
            {t("app.cockpitSummary.loadFailed")} {(preview.error as any)?.message ?? ""}
          </CardContent>
        </Card>
      )}
    </div>
  );
}