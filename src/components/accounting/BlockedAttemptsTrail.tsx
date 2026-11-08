import { useMemo, useState } from "react";
import { format as formatDate } from "date-fns";
import { AlertTriangle, CheckCircle2, Download, RefreshCw, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useCurrency } from "@/hooks/useCurrency";
import { usePostingRejections } from "@/hooks/usePostingRejections";
import {
  REJECTION_RULE_LABELS,
  REJECTION_SOURCE_LABELS,
  rejectionsToCsv,
  summariseRejections,
} from "@/lib/postingRejectionLog";

/**
 * Read-only trail of every save that a posting rule refused: which rule fired,
 * which accounts and form fields caused it, and what the user had entered.
 */
export function BlockedAttemptsTrail() {
  const { format } = useCurrency();
  const [days, setDays] = useState("90");
  const [ruleFilter, setRuleFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const { data, isLoading, isFetching, refetch } = usePostingRejections({ days: Number(days) });

  const rows = data ?? [];
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (ruleFilter === "all" || r.rule === ruleFilter) &&
          (sourceFilter === "all" || r.source === sourceFilter),
      ),
    [rows, ruleFilter, sourceFilter],
  );
  const summary = useMemo(() => summariseRejections(rows), [rows]);

  const download = () => {
    const blob = new Blob([rejectionsToCsv(filtered)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blocked-posting-attempts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Blocked attempts</CardDescription>
            <CardTitle className="text-base font-medium">{summary.total}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {summary.last24h} in the last 24 hours
          </CardContent>
        </Card>
        {Object.keys(REJECTION_RULE_LABELS).map((rule) => (
          <Card key={rule}>
            <CardHeader className="pb-3">
              <CardDescription>{REJECTION_RULE_LABELS[rule]}</CardDescription>
              <CardTitle className="text-base font-medium">{summary.byRule[rule] ?? 0}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {summary.byRule[rule] ? "Users are hitting this rule" : "No blocks recorded"}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
          <div className="flex items-center gap-2">
            {rows.length === 0 ? (
              <CheckCircle2 className="h-5 w-5 text-primary" />
            ) : (
              <ShieldAlert className="h-5 w-5 text-destructive" />
            )}
            <CardTitle className="text-base font-medium">
              {rows.length === 0
                ? "No saves have been blocked in this period"
                : `${filtered.length} of ${rows.length} blocked attempts`}
            </CardTitle>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="365">Last 12 months</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All screens</SelectItem>
                {Object.entries(REJECTION_SOURCE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={ruleFilter} onValueChange={setRuleFilter}>
              <SelectTrigger className="h-8 w-[210px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All rules</SelectItem>
                {Object.entries(REJECTION_RULE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={download} disabled={filtered.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing recorded. Every blocked save — from a form check or from the ledger itself —
              will appear here with the rule and the fields that caused it.
            </p>
          ) : (
            <Accordion type="multiple" className="w-full">
              {filtered.map((r) => (
                <AccordionItem key={r.id} value={r.id}>
                  <AccordionTrigger className="text-left">
                    <div className="flex flex-1 flex-wrap items-center gap-2 pr-3 text-sm">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                      <span className="font-medium">{r.title}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {REJECTION_SOURCE_LABELS[r.source] ?? r.source}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {r.origin === "database" ? "Ledger" : "Form check"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(new Date(r.occurred_at), "dd MMM yyyy HH:mm")}
                      </span>
                      {typeof r.attempted_amount === "number" && r.attempted_amount > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {format(r.attempted_amount)}
                        </span>
                      )}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 text-sm">
                    <p className="text-muted-foreground">{r.message}</p>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-md border p-3">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Rule that blocked the save
                        </p>
                        <p className="text-xs">{REJECTION_RULE_LABELS[r.rule] ?? r.rule}</p>
                        {(r.offending_accounts ?? []).length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {r.offending_accounts.map((a) => (
                              <li key={a.label} className="text-xs">
                                <span className="font-medium">{a.label}</span>
                                <span className="block text-muted-foreground">{a.note}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div className="rounded-md border p-3">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Fields that caused the rejection
                        </p>
                        {(r.offending_fields ?? []).length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            No field-level detail was captured for this attempt.
                          </p>
                        ) : (
                          <ul className="space-y-1">
                            {r.offending_fields.map((f) => (
                              <li key={f.field} className="text-xs">
                                <span className="font-medium">{f.label}</span>{" "}
                                <span className="text-muted-foreground">({f.field})</span>
                                <span className="block">{f.value ?? "(empty)"}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground">
                      {r.attempted_date && <>Entry date: {r.attempted_date} · </>}
                      {r.route && <>Screen: <code>{r.route}</code> · </>}
                      Reference: <code>{r.id}</code>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
