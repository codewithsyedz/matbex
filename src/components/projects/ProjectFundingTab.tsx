import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileText, FileUp, HandCoins, Search, UserPlus, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useCurrency } from "@/hooks/useCurrency";
import { FUNDING_LABELS, type FundingClassification, type useProjects } from "@/hooks/useProjects";
import { PartnerDrilldownDialog } from "@/components/projects/PartnerDrilldownDialog";
import { PartnerFundingImportDialog } from "@/components/projects/PartnerFundingImportDialog";
import { PartnerRepaymentAuditPanel } from "@/components/projects/PartnerRepaymentAuditPanel";
import { ProjectPartnerAuditPanel } from "@/components/projects/ProjectPartnerAuditPanel";
import { AddProjectPartnerDialog } from "@/components/projects/AddProjectPartnerDialog";
import { PartnerBalancesTable } from "@/components/projects/PartnerBalancesTable";
import {
  exportPartnerFundingCsv,
  exportPartnerFundingPdf,
  type PartnerFundingExportRow,
} from "@/lib/partnerFundingExport";

type ProjectsApi = ReturnType<typeof useProjects>;

export function ProjectFundingTab({ api }: { api: ProjectsApi }) {
  const { format: money, currencyInfo, displayCurrency } = useCurrency();
  const { accounts } = useChartOfAccounts();
  const { funding, partners, reconciliation, totals, transactions, reimbursePartner, activeProject } =
    api;

  const [payTarget, setPayTarget] = useState<string | null>(null);
  const [drillId, setDrillId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [addPartnerOpen, setAddPartnerOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<FundingClassification>("payable");
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");

  const cashAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === "asset" && a.is_active),
    [accounts],
  );

  const rows = useMemo(
    () =>
      funding.map((f) => {
        const expected = (totals.totalInvestment * Number(f.ownership_pct)) / 100;
        const funded = Number(f.total_funded);
        return {
          ...f,
          expected,
          variance: funded - expected,
          /** Still owed back to the partner by the company. */
          repayable: Number(f.loan_balance) + Number(f.payable_balance),
        };
      }),
    [funding, totals.totalInvestment],
  );

  const unclassified = useMemo(
    () =>
      transactions.filter(
        (t) => t.paid_by === "partner" && !t.funding_classification && t.status !== "voided",
      ),
    [transactions],
  );

  const partnerName = (id: string | null) =>
    partners.find((p) => p.id === id)?.partner_name ?? "—";

  const exportArgs = () => {
    const exportRows: PartnerFundingExportRow[] = rows.map((r) => ({
      partnerName: r.partner_name,
      ownershipPct: Number(r.ownership_pct),
      capital: Number(r.capital_balance),
      loan: Number(r.loan_balance),
      payable: Number(r.payable_balance),
      totalFunded: Number(r.total_funded),
      expected: r.expected,
      variance: r.variance,
      repayable: r.repayable,
      unclassified: Number(r.unclassified_amount),
    }));
    const projectName = activeProject?.name ?? "Project";
    return {
      projectName,
      currencyLabel: currencyInfo?.code ?? displayCurrency,
      rows: exportRows,
      summary: { ...reconciliation, totalInvestment: totals.totalInvestment },
      fileName: `partner-funding-${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${
        new Date().toISOString().slice(0, 10)
      }`,
    };
  };

  const downloadCsv = () => {
    exportPartnerFundingCsv(exportArgs());
    toast.success("CSV downloaded.");
  };

  const downloadPdf = async () => {
    try {
      await exportPartnerFundingPdf(exportArgs());
      toast.success("PDF summary downloaded.");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not build the PDF.");
    }
  };

  const submitReimbursement = async () => {
    const value = Number(amount);
    if (!payTarget || !accountId || !value || value <= 0) {
      toast.error("Enter an amount and a payment account.");
      return;
    }
    try {
      await reimbursePartner.mutateAsync({
        partnerId: payTarget,
        amount: value,
        paymentAccountId: accountId,
        kind,
        notes: notes || undefined,
      });
      toast.success("Partner repayment posted to the ledger.");
      setPayTarget(null);
      setAmount("");
      setNotes("");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not post the repayment.");
    }
  };

  const kpis = [
    { label: "Partner capital (equity)", value: reconciliation.partnerCapital },
    { label: "Partner loans (liability)", value: reconciliation.partnerLoans },
    { label: "Due to partners (payable)", value: reconciliation.partnerPayables },
    { label: "Company funded", value: reconciliation.companyFunded },
    {
      label: "Total repayable to partners",
      value: reconciliation.partnerLoans + reconciliation.partnerPayables,
      accent: true,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.map((k) => (
          <Card key={k.label} className={k.accent ? "border-primary/40" : undefined}>
            <CardContent className="pt-6">
              <p className="text-xs font-light text-muted-foreground">{k.label}</p>
              <p className={`mt-1 text-lg font-medium ${k.accent ? "text-primary" : ""}`}>
                {money(k.value)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {reconciliation.balanced ? (
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          Project cost {money(reconciliation.costTotal)} reconciles with total funding{" "}
          {money(reconciliation.fundingTotal)}.
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Cost {money(reconciliation.costTotal)} vs funding {money(reconciliation.fundingTotal)} —
          difference {money(Math.abs(reconciliation.difference))}. Clear unclassified partner-paid
          transactions first.
        </div>
      )}

      <PartnerBalancesTable funding={funding} partners={partners} />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" /> Funding by partner
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setAddPartnerOpen(true)} disabled={!activeProject}>
                <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Add partner
              </Button>
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                <FileUp className="mr-1.5 h-3.5 w-3.5" /> Import CSV
              </Button>
              <Button size="sm" variant="outline" onClick={downloadCsv} disabled={rows.length === 0}>
                <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
              </Button>
              <Button size="sm" variant="outline" onClick={downloadPdf} disabled={rows.length === 0}>
                <FileText className="mr-1.5 h-3.5 w-3.5" /> Export PDF
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
                <TableHead className="text-right">Ownership</TableHead>
                <TableHead className="text-right">Capital</TableHead>
                <TableHead className="text-right">Loan</TableHead>
                <TableHead className="text-right">Payable</TableHead>
                <TableHead className="text-right">Total funded</TableHead>
                <TableHead className="text-right">Expected share</TableHead>
                <TableHead className="text-right">Over / (under)</TableHead>
                <TableHead className="text-right">Repayable</TableHead>
                <TableHead className="text-right">Unclassified</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.partner_id}>
                  <TableCell className="font-medium">{r.partner_name}</TableCell>
                  <TableCell className="text-right">{Number(r.ownership_pct).toFixed(2)}%</TableCell>
                  <TableCell className="text-right">{money(Number(r.capital_balance))}</TableCell>
                  <TableCell className="text-right">{money(Number(r.loan_balance))}</TableCell>
                  <TableCell className="text-right">{money(Number(r.payable_balance))}</TableCell>
                  <TableCell className="text-right font-medium">{money(Number(r.total_funded))}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{money(r.expected)}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={r.variance < 0 ? "destructive" : "secondary"}>
                      {money(r.variance)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{money(r.repayable)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {money(Number(r.unclassified_amount))}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mr-1"
                      onClick={() => setDrillId(r.partner_id)}
                    >
                      <Search className="mr-1.5 h-3.5 w-3.5" /> View
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={r.repayable <= 0}
                      onClick={() => {
                        setPayTarget(r.partner_id);
                        setKind(Number(r.payable_balance) > 0 ? "payable" : "loan");
                        setAmount(String(r.repayable.toFixed(2)));
                      }}
                    >
                      <HandCoins className="mr-1.5 h-3.5 w-3.5" /> Repay
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-sm text-muted-foreground">
                    No partners yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Expected share is ownership × total project investment. A funding difference does not change
            ownership percentages — it settles through capital, loan or payable balances.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">
            Unclassified partner-paid transactions ({unclassified.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Partner</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unclassified.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{t.txn_date}</TableCell>
                  <TableCell>{partnerName(t.partner_id)}</TableCell>
                  <TableCell>{t.vendor_name ?? "—"}</TableCell>
                  <TableCell className="max-w-[280px] truncate">{t.description ?? "—"}</TableCell>
                  <TableCell className="text-right">{money(Number(t.amount))}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{t.status.replace("_", " ")}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {unclassified.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    Every partner-paid transaction is classified.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!payTarget} onOpenChange={(o) => !o && setPayTarget(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Repay {partnerName(payTarget)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Settle against</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as FundingClassification)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="payable">{FUNDING_LABELS.payable}</SelectItem>
                  <SelectItem value="loan">{FUNDING_LABELS.loan}</SelectItem>
                  <SelectItem value="capital">{FUNDING_LABELS.capital}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Amount</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Paid from</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select cash or bank account" />
                </SelectTrigger>
                <SelectContent>
                  {cashAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.account_code} — {a.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPayTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submitReimbursement} disabled={reimbursePartner.isPending}>
              Post repayment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PartnerDrilldownDialog
        open={!!drillId}
        onOpenChange={(o) => !o && setDrillId(null)}
        partner={partners.find((p) => p.id === drillId) ?? null}
        transactions={transactions}
      />

      <PartnerFundingImportDialog api={api} open={importOpen} onOpenChange={setImportOpen} />
      <AddProjectPartnerDialog api={api} open={addPartnerOpen} onOpenChange={setAddPartnerOpen} />

      <PartnerRepaymentAuditPanel partners={partners} />

      <ProjectPartnerAuditPanel projectId={activeProject?.id ?? null} />
    </div>
  );
}