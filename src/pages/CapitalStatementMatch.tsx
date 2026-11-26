import { useMemo, useState } from "react";
import { format, startOfYear } from "date-fns";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Download,
  EyeOff,
  Link2,
  Trash2,
  Unlink,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useOwnerCapital } from "@/hooks/useOwnerCapital";
import {
  useCapitalStatementMatch,
  useReconciliation,
  type StatementLineInput,
} from "@/hooks/useCapitalStatementMatch";
import { exportToCSV } from "@/lib/exportUtils";
import { StatementCsvImportDialog } from "@/components/accounting/capital/StatementCsvImportDialog";

export default function CapitalStatementMatch() {
  const { activeBranchId, pinnedBranchId } = useBranch();
  const scopedBranchId = pinnedBranchId ?? activeBranchId ?? null;
  const { format: money } = useCurrency();

  const [from, setFrom] = useState(format(startOfYear(new Date()), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [accountId, setAccountId] = useState<string>("all");

  const { summaries, movements, isLoading: capitalLoading } = useOwnerCapital({
    branchId: scopedBranchId,
    from,
    to,
  });

  const {
    lines,
    isLoading: linesLoading,
    addLines,
    linkLine,
    unlinkLine,
    setIgnored,
    deleteLine,
  } = useCapitalStatementMatch({ capitalAccountId: accountId, from, to });

  const scopedMovements = useMemo(
    () =>
      accountId === "all"
        ? movements
        : movements.filter((m) => m.capital_account_id === accountId),
    [movements, accountId],
  );

  const { withSuggestions, unmatchedMovements, totals } = useReconciliation(
    lines,
    scopedMovements,
  );

  const accountLabel = (id: string) => {
    const a = summaries.find((s) => s.id === id);
    return a ? `${a.partner_name} — ${a.bank_name} ..${a.account_last4}` : "—";
  };

  // ---- import dialog --------------------------------------------------
  const [importOpen, setImportOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [importAccount, setImportAccount] = useState("");
  const [pasted, setPasted] = useState("");

  const parsePasted = (): StatementLineInput[] => {
    const acct = importAccount;
    const rows: StatementLineInput[] = [];
    for (const raw of pasted.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const cells = line.split(/[\t,;]/).map((c) => c.trim().replace(/^"|"$/g, ""));
      if (cells.length < 3) continue;
      const [date, description, amountRaw, reference] = cells;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const num = Number(String(amountRaw).replace(/[^0-9.-]/g, ""));
      if (!Number.isFinite(num) || num === 0) continue;
      rows.push({
        capitalAccountId: acct,
        branchId: summaries.find((s) => s.id === acct)?.branch_id ?? null,
        statementDate: date,
        description: description || null,
        reference: reference || null,
        amount: Math.abs(num),
        direction: num >= 0 ? "credit" : "debit",
      });
    }
    return rows;
  };

  const submitImport = async () => {
    if (!importAccount) {
      toast.error("Pick the capital account this statement belongs to");
      return;
    }
    const rows = parsePasted();
    if (!rows.length) {
      toast.error("No valid rows found. Use: YYYY-MM-DD, description, amount, reference");
      return;
    }
    try {
      await addLines.mutateAsync(rows);
      toast.success(`Imported ${rows.length} statement line(s)`);
      setImportOpen(false);
      setPasted("");
    } catch (e: any) {
      toast.error(e.message ?? "Could not import statement lines");
    }
  };

  const doLink = async (lineId: string, movementId: string) => {
    try {
      await linkLine.mutateAsync({ lineId, movementId });
      toast.success("Statement line matched to capital movement");
    } catch (e: any) {
      toast.error(e.message ?? "Could not match this line");
    }
  };

  const exportLines = () => {
    exportToCSV({
      filename: `capital-statement-match-${from}-to-${to}`,
      headers: [
        "Date",
        "Account",
        "Description",
        "Reference",
        "Direction",
        "Amount",
        "Status",
        "Matched movement",
      ],
      rows: lines.map((l) => [
        l.statement_date,
        accountLabel(l.capital_account_id),
        l.description ?? "",
        l.reference ?? "",
        l.direction === "credit" ? "Money in" : "Money out",
        Number(l.amount).toFixed(2),
        l.match_status,
        l.matched_movement_id ?? "",
      ]),
    });
  };

  const isLoading = capitalLoading || linesLoading;

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Link2 className="h-7 w-7" />
            Bank Statement Match
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Reconcile partner bank statement lines against recorded capital injections and
            withdrawals.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportLines} disabled={!lines.length}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            Paste rows
          </Button>
          <Button onClick={() => setCsvOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>Capital account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder="All accounts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All capital accounts</SelectItem>
                {summaries.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.partner_name} — {s.bank_name} ..{s.account_last4}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Statement lines</CardDescription>
            <CardTitle className="text-base font-medium">{totals.lines}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {totals.ignored} ignored
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Matched</CardDescription>
            <CardTitle className="text-base font-medium text-emerald-600">{totals.matched}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {totals.unmatched} still unmatched
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Statement money in / out</CardDescription>
            <CardTitle className="text-base font-medium">
              {money(totals.statementIn)} / {money(totals.statementOut)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Unmatched movements</CardDescription>
            <CardTitle className="text-base font-medium">{totals.unmatchedMovementCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {money(totals.unmatchedMovementValue)} recorded with no statement line
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="statement" className="space-y-4">
        <TabsList>
          <TabsTrigger value="statement">Statement lines</TabsTrigger>
          <TabsTrigger value="movements">
            Unmatched movements ({totals.unmatchedMovementCount})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="statement">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Statement lines</CardTitle>
              <CardDescription>
                Suggestions match on direction, amount (±﷼0.50), date (±7 days) and reference.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[560px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status / suggestion</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          Loading…
                        </TableCell>
                      </TableRow>
                    )}
                    {!isLoading && !withSuggestions.length && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No statement lines yet — import a statement to start matching.
                        </TableCell>
                      </TableRow>
                    )}
                    {withSuggestions.map(({ line, suggestions }) => (
                      <TableRow key={line.id}>
                        <TableCell className="whitespace-nowrap">{line.statement_date}</TableCell>
                        <TableCell className="text-xs">
                          {accountLabel(line.capital_account_id)}
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          <div className="truncate">{line.description ?? "—"}</div>
                          {line.reference && (
                            <div className="text-xs text-muted-foreground truncate">
                              Ref {line.reference}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <span
                            className={
                              line.direction === "credit" ? "text-emerald-600" : "text-destructive"
                            }
                          >
                            {line.direction === "credit" ? "+" : "−"}
                            {money(Number(line.amount))}
                          </span>
                        </TableCell>
                        <TableCell>
                          {line.match_status === "matched" && (
                            <Badge variant="secondary" className="gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Matched
                            </Badge>
                          )}
                          {line.match_status === "ignored" && (
                            <Badge variant="outline" className="gap-1">
                              <EyeOff className="h-3 w-3" /> Ignored
                            </Badge>
                          )}
                          {line.match_status === "unmatched" && (
                            <div className="space-y-1">
                              {!suggestions.length && (
                                <span className="text-xs text-muted-foreground">
                                  No candidate movement found
                                </span>
                              )}
                              {suggestions.map((s) => (
                                <div key={s.movement.id} className="flex items-center gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => doLink(line.id, s.movement.id)}
                                  >
                                    <Link2 className="h-3 w-3 mr-1" />
                                    {s.movement.movement_date} · {money(Number(s.movement.amount))}
                                  </Button>
                                  <span className="text-xs text-muted-foreground">
                                    {s.score}% · {s.reasons.join(", ")}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {line.match_status === "matched" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => unlinkLine.mutate(line.id)}
                            >
                              <Unlink className="h-4 w-4 mr-1" /> Unmatch
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setIgnored.mutate({
                                  lineId: line.id,
                                  ignored: line.match_status !== "ignored",
                                })
                              }
                            >
                              <EyeOff className="h-4 w-4 mr-1" />
                              {line.match_status === "ignored" ? "Restore" : "Ignore"}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteLine.mutate(line.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="movements">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Recorded movements without a statement line</CardTitle>
              <CardDescription>
                These capital injections and withdrawals are in the ledger but have not been seen on
                an imported statement.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!unmatchedMovements.length && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        Every recorded movement is matched to a statement line.
                      </TableCell>
                    </TableRow>
                  )}
                  {unmatchedMovements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>{m.movement_date}</TableCell>
                      <TableCell className="text-xs">
                        {accountLabel(m.capital_account_id)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="gap-1">
                          {m.movement_type === "injection" ? (
                            <ArrowDownLeft className="h-3 w-3 text-emerald-600" />
                          ) : (
                            <ArrowUpRight className="h-3 w-3 text-destructive" />
                          )}
                          {m.movement_type === "injection" ? "Injection" : "Withdrawal"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{m.reference_number ?? "—"}</TableCell>
                      <TableCell className="text-right">{money(Number(m.amount))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <StatementCsvImportDialog
        open={csvOpen}
        onOpenChange={setCsvOpen}
        accounts={summaries}
        existingLines={lines}
        defaultAccountId={accountId !== "all" ? accountId : null}
        isSaving={addLines.isPending}
        onImport={(rows) => addLines.mutateAsync(rows)}
      />

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import bank statement lines</DialogTitle>
            <DialogDescription>
              Paste rows as <code>date, description, amount, reference</code>. Use a negative amount
              for money leaving the account (withdrawals).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Capital account</Label>
              <Select value={importAccount} onValueChange={setImportAccount}>
                <SelectTrigger>
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {summaries.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.partner_name} — {s.bank_name} ..{s.account_last4}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Statement rows</Label>
              <Textarea
                rows={10}
                className="font-mono text-xs"
                placeholder={"2026-07-01, Capital transfer, 50000, TRF9931\n2026-07-08, Owner drawing, -12000, TRF9987"}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {parsePasted().length} valid row(s) detected
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitImport} disabled={addLines.isPending}>
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
