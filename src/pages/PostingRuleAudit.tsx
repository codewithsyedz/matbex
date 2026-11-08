import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Download, RefreshCw, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PostingRuleAlert } from "@/components/accounting/PostingRuleAlert";
import { BlockedAttemptsTrail } from "@/components/accounting/BlockedAttemptsTrail";
import { usePostingRuleScan } from "@/hooks/usePostingRuleScan";
import { findingsToCsv } from "@/lib/postingRuleScan";
import { useCurrency } from "@/hooks/useCurrency";

const RULE_LABELS: Record<string, string> = {
  partner_funding_as_revenue: "Partner funding vs revenue",
  expense_to_fixed_asset: "Expense charged to a fixed asset",
  partner_account_as_expense: "Partner account used as expense",
};

export default function PostingRuleAudit() {
  const { format } = useCurrency();
  const [ruleFilter, setRuleFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const { data, isLoading, isFetching, refetch } = usePostingRuleScan();

  const all = useMemo(
    () => [...(data?.accountIssues ?? []), ...(data?.findings ?? [])],
    [data],
  );
  const filtered = useMemo(
    () =>
      all.filter(
        (f) =>
          (ruleFilter === "all" || f.violation.rule === ruleFilter) &&
          (sourceFilter === "all" || f.source === sourceFilter),
      ),
    [all, ruleFilter, sourceFilter],
  );

  const download = () => {
    const blob = new Blob([findingsToCsv(filtered)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `posting-rule-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Posting rule audit</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Replays the partner-loan and fixed-asset rules over your existing expenses and journal
            entries, so historical rows that would now be rejected can be corrected before your next
            close.
          </p>
        </div>
      </header>

      <Tabs defaultValue="scan" className="space-y-6">
        <TabsList>
          <TabsTrigger value="scan">Historical scan</TabsTrigger>
          <TabsTrigger value="blocked">Blocked attempts</TabsTrigger>
        </TabsList>

        <TabsContent value="scan" className="space-y-6">
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Re-scan
            </Button>
            <Button size="sm" onClick={download} disabled={filtered.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Rows scanned</CardDescription>
                <CardTitle className="text-base font-medium">
                  {(data?.expensesScanned ?? 0) + (data?.ledgerLinesScanned ?? 0)}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {data?.expensesScanned ?? 0} expenses · {data?.ledgerLinesScanned ?? 0} ledger lines
              </CardContent>
            </Card>
            {(["partner_funding_as_revenue", "expense_to_fixed_asset", "partner_account_as_expense"] as const).map(
              (rule) => (
                <Card key={rule}>
                  <CardHeader className="pb-3">
                    <CardDescription>{RULE_LABELS[rule]}</CardDescription>
                    <CardTitle className="text-base font-medium">
                      {all.filter((f) => f.violation.rule === rule).length}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    {all.some((f) => f.violation.rule === rule) ? "Needs correction" : "Clean"}
                  </CardContent>
                </Card>
              ),
            )}
          </div>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
              <div className="flex items-center gap-2">
                {all.length === 0 ? (
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                ) : (
                  <ShieldAlert className="h-5 w-5 text-destructive" />
                )}
                <CardTitle className="text-base font-medium">
                  {all.length === 0
                    ? "No historical rows break the new rules"
                    : `${filtered.length} of ${all.length} findings`}
                </CardTitle>
              </div>
              <div className="flex gap-2">
                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                  <SelectTrigger className="h-8 w-[150px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sources</SelectItem>
                    <SelectItem value="expense">Expenses</SelectItem>
                    <SelectItem value="journal_batch">Journal entries</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={ruleFilter} onValueChange={setRuleFilter}>
                  <SelectTrigger className="h-8 w-[210px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All rules</SelectItem>
                    {Object.entries(RULE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {filtered.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nothing to fix here. Re-run this scan after a bulk import or a chart of accounts
                  change.
                </p>
              ) : (
                <Accordion type="multiple" className="w-full">
                  {filtered.map((f) => (
                    <AccordionItem key={f.key} value={f.key}>
                      <AccordionTrigger className="text-left">
                        <div className="flex flex-1 flex-wrap items-center gap-2 pr-3 text-sm">
                          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                          <span className="font-medium">{f.label}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {f.source === "expense" ? "Expense" : "Journal entry"}
                          </Badge>
                          {f.date && (
                            <span className="text-xs text-muted-foreground">{f.date}</span>
                          )}
                          {f.amount > 0 && (
                            <span className="text-xs text-muted-foreground">{format(f.amount)}</span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {f.accounts.join(", ")}
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <PostingRuleAlert violation={f.violation} />
                        <div className="mt-2 text-xs text-muted-foreground">
                          Record reference: <code>{f.recordId}</code>{" "}
                          {f.source === "expense" && (
                            <Link className="underline" to="/expenses">
                              Open Expenses
                            </Link>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </CardContent>
          </Card>
        </>
      )}
        </TabsContent>

        <TabsContent value="blocked">
          <BlockedAttemptsTrail />
        </TabsContent>
      </Tabs>
    </div>
  );
}
