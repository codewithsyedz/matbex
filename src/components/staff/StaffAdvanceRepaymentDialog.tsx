import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Banknote, Download, FileSpreadsheet, FileText, Loader2, Trash2, Wallet } from "lucide-react";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { selectablePaymentAccounts } from "@/lib/paymentAccountRules";
import {
  advanceOutstanding,
  useStaffAdvances,
  type StaffAdvance,
} from "@/hooks/useStaffAdvances";
import { deriveAdvanceSettlement } from "@/lib/staffAdvanceSettlement";
import { AdvanceSettlementTimelineCard } from "@/components/staff/AdvanceSettlementTimelineCard";
import { AdvanceSettlementBadge } from "@/components/staff/AdvanceSettlementBadge";
import {
  buildRepaymentReceipt,
  downloadReceiptCsv,
  downloadReceiptPdf,
  type ReceiptLedgerLeg,
} from "@/lib/advanceRepaymentReceipt";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Source = "cash" | "bank" | "payroll";

interface Props {
  advance: StaffAdvance | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canDelete?: boolean;
}

/**
 * Settle part (or all) of a staff advance from cash in hand, bank, or payroll.
 * Cash/bank repayments post DR cash-or-bank / CR 1150; payroll repayments are
 * credited to 1150 by the payroll posting, so no extra journal is written here.
 */
export function StaffAdvanceRepaymentDialog({ advance, open, onOpenChange, canDelete }: Props) {
  const { restaurant } = useAuth();
  const { format: formatCurrency, displayCurrency: currencyCode } = useCurrency();
  const { accounts } = useChartOfAccounts();
  const { recordRepayment, deleteRepayment } = useStaffAdvances();

  const [amount, setAmount] = useState<string>("");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [source, setSource] = useState<Source>("cash");
  const [accountId, setAccountId] = useState<string>("");
  const [notes, setNotes] = useState("");

  const cashAccounts = useMemo(() => selectablePaymentAccounts(accounts as any[]), [accounts]);

  const { data: repayments = [], isLoading } = useQuery({
    queryKey: ["staff-advance-repayments", advance?.id],
    queryFn: async () => {
      if (!advance?.id) return [];
      const { data, error } = await db
        .from("staff_advance_repayments")
        .select("*")
        .eq("advance_id", advance.id)
        .order("repayment_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!advance?.id && open && !!restaurant?.id,
  });

  const { data: receiptLegs = [] } = useQuery({
    queryKey: ["staff-advance-repayment-legs", advance?.id],
    queryFn: async () => {
      if (!advance?.id) return [];
      const { data, error } = await db
        .from("account_transactions")
        .select(
          "id, batch_id, debit, credit, transaction_date, is_voided, chart_of_accounts:account_id(account_code, account_name)",
        )
        .eq("reference_type", "staff_advance_repayment")
        .eq("reference_id", advance.id);
      if (error) return [];
      return (data ?? []).map((l: any) => ({
        id: l.id,
        batch_id: l.batch_id,
        debit: l.debit,
        credit: l.credit,
        transaction_date: l.transaction_date,
        is_voided: l.is_voided,
        account_code: l.chart_of_accounts?.account_code ?? null,
        account_name: l.chart_of_accounts?.account_name ?? null,
      })) as ReceiptLedgerLeg[];
    },
    enabled: !!advance?.id && open,
  });

  const makeReceipt = (r: any) =>
    buildRepaymentReceipt(
      {
        id: r.id,
        amount: Number(r.amount),
        repayment_date: r.repayment_date,
        source: r.source,
        notes: r.notes,
        created_at: r.created_at,
        ledger_transaction_id: r.ledger_transaction_id,
      },
      {
        restaurantName: restaurant?.name ?? null,
        branchLabel: (advance as any)?.branch?.name ?? null,
        staffName: (advance as any)?.staff?.name ?? null,
        advanceId: advance?.id ?? "",
        advanceAmount: Number(advance?.amount ?? 0),
        advanceDate: (advance as any)?.advance_date ?? null,
        outstandingAfter: advance ? advanceOutstanding(advance) : 0,
        currency: currencyCode,
      },
      receiptLegs,
    );

  const total = Number(advance?.amount ?? 0);
  const repaid = Number(advance?.repaid_amount ?? 0);
  const outstanding = advance ? advanceOutstanding(advance) : 0;
  const parsed = parseFloat(amount || "0");

  const error =
    parsed < 0
      ? "Amount can't be negative"
      : parsed > outstanding + 0.005
        ? `Amount exceeds the outstanding balance of ${formatCurrency(outstanding)}`
        : null;

  const reset = () => {
    setAmount("");
    setNotes("");
    setSource("cash");
    setAccountId("");
    setDate(new Date().toISOString().split("T")[0]);
  };

  const handleSubmit = () => {
    if (!advance || parsed <= 0 || error) return;
    recordRepayment.mutate(
      {
        advanceId: advance.id,
        amount: parsed,
        repayment_date: date,
        source,
        account_id: source === "payroll" ? null : accountId || null,
        notes: notes || null,
      },
      { onSuccess: reset },
    );
  };

  const sourceLabel = (s: string) =>
    s === "payroll" ? "Payroll deduction" : s === "bank" ? "Bank" : "Cash in hand";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Repay advance</DialogTitle>
          <DialogDescription>
            {advance?.staff?.name
              ? `Settle part or all of ${advance.staff.name}'s advance.`
              : "Settle part or all of this advance."}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-3">
          <div className="space-y-4">
            <div className="rounded-lg border p-3 space-y-2">
              {advance && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <AdvanceSettlementBadge advance={advance} />
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Advance</span>
                <span className="font-semibold">{formatCurrency(total)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Repaid</span>
                <span className="font-medium text-green-600">{formatCurrency(repaid)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Still due</span>
                <span className="font-semibold text-amber-600">{formatCurrency(outstanding)}</span>
              </div>
              <Progress
                value={advance ? deriveAdvanceSettlement(advance).percentRepaid : 0}
                className="h-1.5"
              />
            </div>

            {outstanding > 0 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="repay-amount">Amount *</Label>
                    <Input
                      id="repay-amount"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    {error && <p className="text-xs text-destructive">{error}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="repay-date">Date</Label>
                    <Input
                      id="repay-date"
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAmount(outstanding.toFixed(2))}
                  >
                    Settle full balance
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAmount((outstanding / 2).toFixed(2))}
                  >
                    Half
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label>Received from</Label>
                  <Select value={source} onValueChange={(v: Source) => setSource(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash in hand</SelectItem>
                      <SelectItem value="bank">Bank transfer</SelectItem>
                      <SelectItem value="payroll">Payroll deduction</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    {source === "payroll"
                      ? "Payroll postings already credit Advances (1150) — no extra journal is created."
                      : "Posts DR the selected cash/bank account, CR Advances to Employees (1150)."}
                  </p>
                </div>

                {source !== "payroll" && (
                  <div className="space-y-2">
                    <Label>Deposited to</Label>
                    <Select value={accountId} onValueChange={setAccountId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Default cash account (1000)" />
                      </SelectTrigger>
                      <SelectContent>
                        {cashAccounts.map((a: any) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.account_code} · {a.account_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="repay-notes">Note (optional)</Label>
                  <Textarea
                    id="repay-notes"
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Reference, receipt number..."
                  />
                </div>
              </div>
            )}

            <Separator />

            <AdvanceSettlementTimelineCard
              advanceId={advance?.id ?? null}
              enabled={open}
            />

            <div className="space-y-2">
              <p className="text-sm font-medium">Repayment history</p>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : repayments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No repayments recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {repayments.map((r: any) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        {r.source === "payroll" ? (
                          <Wallet className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Banknote className="h-4 w-4 text-muted-foreground" />
                        )}
                        <div>
                          <p className="text-sm font-medium">{formatCurrency(Number(r.amount))}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {format(new Date(r.repayment_date), "MMM d, yyyy")} ·{" "}
                            {sourceLabel(r.source)}
                            {r.notes ? ` · ${r.notes}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {r.ledger_transaction_id ? (
                          <Badge variant="outline" className="text-[10px]">
                            Posted
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">
                            Via payroll
                          </Badge>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="Download receipt"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => downloadReceiptPdf(makeReceipt(r))}>
                              <FileText className="mr-2 h-4 w-4" />
                              Receipt (PDF)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => downloadReceiptCsv(makeReceipt(r))}>
                              <FileSpreadsheet className="mr-2 h-4 w-4" />
                              Receipt (CSV)
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            disabled={deleteRepayment.isPending}
                            onClick={() => deleteRepayment.mutate(r.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              outstanding <= 0 || parsed <= 0 || !!error || recordRepayment.isPending
            }
          >
            {recordRepayment.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Record repayment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default StaffAdvanceRepaymentDialog;
