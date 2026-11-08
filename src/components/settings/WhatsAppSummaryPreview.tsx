import { useState } from "react";
import { Loader2, MessageSquare, Eye, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWhatsAppSubscription } from "@/hooks/useWhatsAppSubscription";
import { useCurrency } from "@/hooks/useCurrency";

function ymdRiyadhToday(): string {
  const shifted = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between text-xs ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

export function WhatsAppSummaryPreview() {
  const { preview } = useWhatsAppSubscription();
  const { format } = useCurrency();
  const [date, setDate] = useState(ymdRiyadhToday());

  const data = preview.data;
  const today = data?.today;
  const b = today?.breakdown;

  const fmt = (n: number) => format(Number(n) || 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-primary/10 text-primary">
            <Eye className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base font-medium">Daily summary preview</CardTitle>
            <CardDescription className="text-xs">
              Inspect the WhatsApp message and how every figure was calculated for a chosen day
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-2 flex-wrap">
          <div className="space-y-1">
            <Label htmlFor="wa-preview-date" className="text-xs">Date (Riyadh)</Label>
            <Input
              id="wa-preview-date"
              type="date"
              value={date}
              max={ymdRiyadhToday()}
              onChange={(e) => setDate(e.target.value)}
              className="w-44"
            />
          </div>
          <Button
            onClick={() => preview.mutate({ date })}
            disabled={!date || preview.isPending}
          >
            {preview.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <MessageSquare className="h-4 w-4 mr-2" />
            )}
            Load preview
          </Button>
          {today?.isEstimated && (
            <Badge variant="outline" className="text-warning border-warning/40">
              COGS estimated
            </Badge>
          )}
          {data && (
            <Button asChild variant="ghost" size="sm" className="ml-auto">
              <Link to={`/cockpit/summary/${data.ymd ?? date}`}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Open full drilldown
              </Link>
            </Button>
          )}
        </div>

        {data && (
          <>
            <div className="rounded-md border bg-[#ECE5DD]/40 dark:bg-muted/30 p-3">
              <div className="rounded-md bg-background border p-3 shadow-sm max-w-md">
                <pre className="whitespace-pre-wrap break-words text-xs font-sans leading-relaxed text-foreground">
                  {data.message}
                </pre>
              </div>
            </div>

            {b && (
              <Accordion type="multiple" defaultValue={["cogs"]} className="w-full">
                <AccordionItem value="revenue">
                  <AccordionTrigger className="text-sm">
                    Revenue · {fmt(b.sales.total)}
                  </AccordionTrigger>
                  <AccordionContent className="space-y-1">
                    <Row label="Sales transactions" value={String(b.sales.count)} />
                    <Row label="Sum of sales_transactions.total" value={fmt(b.sales.total)} />
                    <p className="text-[11px] text-muted-foreground pt-1">
                      Window: {date} 00:00 → 24:00 Asia/Riyadh
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="cogs">
                  <AccordionTrigger className="text-sm">
                    COGS · {fmt(today.totalCOGS)} ({today.cogsPct.toFixed(1)}%)
                    {today.isEstimated && (
                      <Badge variant="outline" className="ml-2 text-[10px]">est.</Badge>
                    )}
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2">
                    <Row label="Source" value={b.cogs.source} />
                    {b.cogs.source === "stocktake" && b.cogs.submissions.length > 0 ? (
                      <ScrollArea className="max-h-48">
                        <div className="space-y-2">
                          {b.cogs.submissions.map((s: any, i: number) => (
                            <div key={i} className="rounded border p-2 space-y-1">
                              <p className="text-xs font-medium capitalize">{s.shift_type} shift</p>
                              <Row label="Opening" value={fmt(s.opening)} muted />
                              <Row label="+ Purchases" value={fmt(s.purchases)} muted />
                              <Row label="− Closing" value={fmt(s.closing)} muted />
                              <Row label="= COGS" value={fmt(s.cogs)} />
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    ) : (
                      <div className="space-y-1">
                        <Row
                          label={`Food (${(b.cogs.fallbackFoodPct * 100).toFixed(0)}% × revenue)`}
                          value={fmt(b.cogs.foodCost)}
                        />
                        <Row
                          label={`Beverage (${(b.cogs.fallbackBeveragePct * 100).toFixed(0)}% × revenue)`}
                          value={fmt(b.cogs.beverageCost)}
                        />
                        <p className="text-[11px] text-warning pt-1">
                          No approved stocktake - using fallback percentages. Submit today's stocktake for exact figures.
                        </p>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="labor">
                  <AccordionTrigger className="text-sm">
                    Labor (allocated) · {fmt(today.dailyLabor)}
                  </AccordionTrigger>
                  <AccordionContent className="space-y-1">
                    <Row label="Active staff" value={String(b.labor.staffCount)} />
                    <Row label="Monthly payroll" value={fmt(b.labor.monthlyPayroll)} />
                    <Row label="÷ 30 days" value={fmt(b.labor.dailyLabor)} />
                    <p className="text-[11px] text-muted-foreground pt-1">
                      Sum of staff.monthly_salary (or hourly_rate × 160 if none).
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="overhead">
                  <AccordionTrigger className="text-sm">
                    Overhead (allocated) · {fmt(today.dailyOverhead)}
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2">
                    {b.overhead.items.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No active overhead allocations.</p>
                    ) : (
                      <ScrollArea className="max-h-48">
                        <div className="space-y-1">
                          {b.overhead.items.map((o: any, i: number) => (
                            <Row
                              key={i}
                              label={`${o.name} (${fmt(o.monthly)}/mo)`}
                              value={fmt(o.daily)}
                            />
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                    <div className="pt-1 border-t">
                      <Row label="Total monthly" value={fmt(b.overhead.monthlyOverhead)} muted />
                      <Row label="÷ 30 days" value={fmt(b.overhead.dailyOverhead)} />
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="expenses">
                  <AccordionTrigger className="text-sm">
                    Other expenses · {fmt(b.expenses.total)}
                  </AccordionTrigger>
                  <AccordionContent className="space-y-1">
                    {b.expenses.items.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No approved expenses for this date.</p>
                    ) : (
                      <ScrollArea className="max-h-48">
                        <div className="space-y-1">
                          {b.expenses.items.map((e: any, i: number) => (
                            <Row key={i} label={e.description} value={fmt(e.amount)} />
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                    <p className="text-[11px] text-muted-foreground pt-1">
                      Approved, non-deleted expenses with expense_date = {date}.
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="shifts">
                  <AccordionTrigger className="text-sm">
                    Cash variance · {fmt(Math.abs(b.shifts.variance))}
                  </AccordionTrigger>
                  <AccordionContent className="space-y-1">
                    <Row label="Shifts opened today" value={String(b.shifts.total)} />
                    <Row label="Still open" value={String(b.shifts.open)} />
                    <Row label="Sum of variance_amount" value={fmt(b.shifts.variance)} />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="profit">
                  <AccordionTrigger className="text-sm">
                    Net profit · {fmt(today.profit)}
                  </AccordionTrigger>
                  <AccordionContent className="space-y-1">
                    <Row label="Revenue" value={fmt(today.totalSales)} />
                    <Row label="− COGS" value={fmt(today.totalCOGS)} muted />
                    <Row label="− Labor" value={fmt(today.dailyLabor)} muted />
                    <Row label="− Overhead" value={fmt(today.dailyOverhead)} muted />
                    <Row label="− Other expenses" value={fmt(today.totalExpenses)} muted />
                    <div className="pt-1 border-t">
                      <Row label="= Net profit" value={fmt(today.profit)} />
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
          </>
        )}

        {!data && !preview.isPending && (
          <p className="text-xs text-muted-foreground">
            Pick a date and click <span className="font-medium">Load preview</span> to see the exact message
            and the source of every number.
          </p>
        )}
      </CardContent>
    </Card>
  );
}