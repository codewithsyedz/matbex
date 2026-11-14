import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useCurrency } from "@/hooks/useCurrency";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { AdvanceSettlementBadge } from "@/components/staff/AdvanceSettlementBadge";
import { deriveAdvanceSettlement } from "@/lib/staffAdvanceSettlement";
import { ReversalAuditLogCard } from "@/components/accounting/ReversalAuditLogCard";
import { AdvanceLedgerBreakdownCard } from "@/components/staff/AdvanceLedgerBreakdownCard";
import { AdvanceSettlementTimelineCard } from "@/components/staff/AdvanceSettlementTimelineCard";
import { AdvanceRecoveryTimelineCard } from "@/components/staff/AdvanceRecoveryTimelineCard";
import { legKindLabel, legKind } from "@/lib/advanceLedgerBreakdown";
import { useBranch } from "@/contexts/BranchContext";
import { auditAdvanceBranchAlignment } from "@/lib/advanceBranchMismatch";
import {
  AdvanceBranchMismatchAlert,
  BranchMismatchBadge,
} from "@/components/staff/AdvanceBranchMismatchAlert";
import {
  AlertCircle,
  RotateCcw,
  PlusCircle,
  Receipt,
  CheckCircle2,
  Gift,
} from "lucide-react";

interface Props {
  advanceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface LedgerLeg {
  id: string;
  transaction_date: string;
  created_at: string;
  batch_id: string | null;
  reference_type: string | null;
  original_transaction_id: string | null;
  voided_at: string | null;
  void_reason: string | null;
  debit: number | null;
  credit: number | null;
  description: string | null;
  is_voided: boolean | null;
  branch_id: string | null;
  chart_of_accounts: { account_code: string; account_name: string } | null;
}

export function StaffAdvanceLedgerDialog({ advanceId, open, onOpenChange }: Props) {
  const { format: money, displayCurrency, currencyInfo } = useCurrency();
  const { branches } = useBranch();
  const branchName = (id: string | null | undefined) =>
    (id ? branches.find((b) => b.id === id)?.name : null) ??
    (id ? "another branch" : "no branch");

  const { data: advance } = useQuery({
    queryKey: ["staff-advance-audit", advanceId],
    queryFn: async () => {
      if (!advanceId) return null;
      const { data, error } = await db
        .from("staff_advances")
        .select(
          "id, amount, repaid_amount, status, created_at, updated_at, advance_date, deducted_at, deducted_from_payroll_id, ledger_posted, ledger_reversed, ledger_reversed_at, ledger_reversal_reason, branch_id, staff:staff_id(name, branch_id)"
        )
        .eq("id", advanceId)
        .maybeSingle();
      if (error) throw error;
      return data as Record<string, unknown> | null;
    },
    enabled: open && !!advanceId,
  });

  const { data: allLegs = [], isLoading } = useQuery({
    queryKey: ["staff-advance-ledger", advanceId],
    queryFn: async () => {
      if (!advanceId) return [];
      const { data, error } = await db
        .from("account_transactions")
        .select(
          "id, transaction_date, created_at, batch_id, reference_type, original_transaction_id, voided_at, void_reason, debit, credit, description, is_voided, branch_id, chart_of_accounts:account_id(account_code, account_name)"
        )
        .in("reference_type", [
          "staff_advance",
          "staff_advance_reversal",
          "staff_advance_repayment",
          "advance_deduction",
        ])
        .eq("reference_id", advanceId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as LedgerLeg[];
    },
    enabled: open && !!advanceId,
  });

  const legs = allLegs.filter((l) => l.reference_type === "staff_advance");
  const reversalLegs = allLegs.filter((l) => l.reference_type === "staff_advance_reversal");
  const isReversed = reversalLegs.length > 0;
  const recoveryLegs = allLegs.filter(
    (l) =>
      !l.is_voided &&
      (l.reference_type === "staff_advance_repayment" || l.reference_type === "advance_deduction")
  );
  const settlement = advance
    ? deriveAdvanceSettlement({
        amount: Number(advance.amount || 0),
        repaid_amount: Number(advance.repaid_amount || 0),
        status: typeof advance.status === "string" ? advance.status : null,
        ledger_reversed: Boolean(advance.ledger_reversed),
      })
    : null;
  const recoveredInLedger = recoveryLegs.reduce((s, l) => s + Number(l.credit || 0), 0);

  const advanceBranchId =
    typeof advance?.branch_id === "string" ? advance.branch_id : null;
  const staffBranchId =
    (advance?.staff as { branch_id?: string | null } | null)?.branch_id ?? null;

  const { data: payrollBranchIds = [] } = useQuery({
    queryKey: ["staff-advance-recovery-branches", advanceId],
    queryFn: async () => {
      if (!advanceId) return [];
      const { data: reps, error: repErr } = await db
        .from("staff_advance_repayments")
        .select("payroll_id")
        .eq("advance_id", advanceId);
      if (repErr) throw repErr;
      const ids = Array.from(
        new Set(
          [
            ...(reps ?? []).map((r) => r.payroll_id),
            typeof advance?.deducted_from_payroll_id === "string"
              ? advance.deducted_from_payroll_id
              : null,
          ].filter((v): v is string => !!v)
        )
      );
      if (ids.length === 0) return [];
      const { data, error } = await db
        .from("payroll_records")
        .select("id, branch_id")
        .in("id", ids);
      if (error) throw error;
      return (data ?? []).map((p) => p.branch_id as string | null);
    },
    enabled: open && !!advanceId,
  });

  const branchIssues = auditAdvanceBranchAlignment({
    advanceBranchId,
    staffBranchId,
    ledgerBranchIds: allLegs.filter((l) => !l.is_voided).map((l) => l.branch_id),
    payrollBranchIds,
    branchName,
  });

  const totalDr = allLegs.filter((l) => !l.is_voided).reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCr = allLegs.filter((l) => !l.is_voided).reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = Math.abs(totalDr - totalCr) < 0.01;

  const sumSide = (rows: LedgerLeg[], side: "debit" | "credit") =>
    rows.reduce((s, l) => s + Number(l[side] || 0), 0);
  const originalDr = sumSide(legs, "debit");
  const originalCr = sumSide(legs, "credit");
  const reversalDr = sumSide(reversalLegs, "debit");
  const reversalCr = sumSide(reversalLegs, "credit");
  const netDr = originalDr - (isReversed ? sumSide(legs.filter((l) => l.is_voided), "debit") : 0) + reversalDr;
  const netCr = originalCr - (isReversed ? sumSide(legs.filter((l) => l.is_voided), "credit") : 0) + reversalCr;
  const netEffect = netDr - netCr;
  const fullyOffset = Math.abs(netDr) < 0.01 && Math.abs(netCr) < 0.01;
  const postedAt = legs.length
    ? legs.reduce((min, l) => (l.created_at < min ? l.created_at : min), legs[0].created_at)
    : null;
  const reversedAt = reversalLegs.length
    ? reversalLegs.reduce((min, l) => (l.created_at < min ? l.created_at : min), reversalLegs[0].created_at)
    : null;
  const reversalReason =
    legs.find((l) => l.void_reason)?.void_reason ?? null;
  const batchId = legs.find((l) => l.batch_id)?.batch_id ?? null;
  const fmtTs = (ts: string) =>
    new Date(ts).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });

  type TimelineEvent = {
    at: string;
    title: string;
    detail?: string | null;
    icon: typeof PlusCircle;
    tone: "default" | "success" | "danger" | "muted";
  };

  const timeline: TimelineEvent[] = [];
  const str = (v: unknown) => (typeof v === "string" ? v : null);

  if (advance) {
    const createdAt = str(advance.created_at);
    if (createdAt) {
      timeline.push({
        at: createdAt,
        title: "Advance recorded",
        detail: `${money(Number(advance.amount || 0))} for ${
          (advance.staff as { name?: string } | null)?.name ?? "staff"
        }`,
        icon: PlusCircle,
        tone: "default",
      });
    }
  }

  if (postedAt) {
    timeline.push({
      at: postedAt,
      title: "Posted to ledger",
      detail: `${legs.length} leg${legs.length === 1 ? "" : "s"} · DR 1150 / CR cash`,
      icon: Receipt,
      tone: "success",
    });
  }

  if (advance?.deducted_at) {
    timeline.push({
      at: String(advance.deducted_at),
      title: "Deducted from payroll",
      detail: "Status changed to deducted",
      icon: CheckCircle2,
      tone: "success",
    });
  }

  if (advance?.status === "forgiven") {
    timeline.push({
      at: str(advance.ledger_reversed_at) ?? str(advance.updated_at) ?? postedAt ?? "",
      title: "Advance forgiven",
      detail: "Written off — no longer recoverable from payroll",
      icon: Gift,
      tone: "muted",
    });
  }

  if (reversedAt) {
    timeline.push({
      at: reversedAt,
      title: "Reversal journal posted",
      detail:
        str(advance?.ledger_reversal_reason) ??
        reversalReason ??
        "Original legs voided and offset by a mirrored entry",
      icon: RotateCcw,
      tone: "danger",
    });
  }

  timeline.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const toneClass = (tone: TimelineEvent["tone"]) =>
    tone === "success"
      ? "text-green-600 bg-green-500/10"
      : tone === "danger"
        ? "text-destructive bg-destructive/10"
        : tone === "muted"
          ? "text-muted-foreground bg-muted"
          : "text-primary bg-primary/10";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Ledger entry
            {!isLoading && allLegs.length > 0 && (
              <Badge variant={isReversed ? "destructive" : "default"}>
                {isReversed ? "Reversed" : "Active"}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Journal legs posted to the general ledger for this staff advance.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-3">
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : allLegs.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700">
            <AlertCircle className="h-4 w-4" />
            No ledger entry found for this advance yet.
          </div>
        ) : (
          <div className="space-y-3">
            <AdvanceBranchMismatchAlert issues={branchIssues} />
            {settlement && (
              <div className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Recovery status</p>
                  <AdvanceSettlementBadge
                    advance={{
                      amount: settlement.amount,
                      repaid_amount: settlement.repaid,
                      status: typeof advance?.status === "string" ? advance.status : null,
                      ledger_reversed: Boolean(advance?.ledger_reversed),
                    }}
                  />
                </div>
                <Progress value={settlement.percentRepaid} className="mt-2 h-2" />
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Advance amount</p>
                    <p className="font-medium">{money(settlement.amount)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Recovered</p>
                    <p className="font-medium text-green-600">{money(settlement.repaid)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Outstanding</p>
                    <p
                      className={`font-medium ${settlement.outstanding > 0 ? "text-amber-600" : ""}`}
                    >
                      {money(settlement.outstanding)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Recovery legs</p>
                    <p className="font-medium">
                      {recoveryLegs.length} · CR {money(recoveredInLedger)}
                    </p>
                  </div>
                </div>
                {Math.abs(recoveredInLedger - settlement.repaid) > 0.01 && (
                  <p className="mt-2 flex items-center gap-1 text-xs text-amber-600">
                    <AlertCircle className="h-3 w-3" />
                    Ledger recovery ({money(recoveredInLedger)}) differs from recorded repayments (
                    {money(settlement.repaid)}).
                  </p>
                )}
              </div>
            )}
            {isReversed && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <RotateCcw className="mt-0.5 h-4 w-4 text-destructive" />
                <div>
                  <p className="font-medium text-destructive">
                    Reversed on {reversedAt ? fmtTs(reversedAt) : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {reversalReason ?? "The original legs were voided and offset by a reversal journal."}
                  </p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 rounded-md border p-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Posted at</p>
                <p className="font-medium">{postedAt ? fmtTs(postedAt) : "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Entry date</p>
                <p className="font-medium">{legs[0]?.transaction_date ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Currency</p>
                <p className="font-medium">
                  {currencyInfo?.symbol ?? ""} {displayCurrency}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Batch</p>
                <p className="font-mono text-xs">{batchId ? batchId.slice(0, 8) : "—"}</p>
              </div>
            </div>
            {isReversed && (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Impact</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>Original advance posting</TableCell>
                      <TableCell className="text-right">{money(originalDr)}</TableCell>
                      <TableCell className="text-right">{money(originalCr)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-destructive">Reversal posting</TableCell>
                      <TableCell className="text-right text-destructive">
                        {money(reversalDr)}
                      </TableCell>
                      <TableCell className="text-right text-destructive">
                        {money(reversalCr)}
                      </TableCell>
                    </TableRow>
                    <TableRow className="bg-muted/50 font-medium">
                      <TableCell>
                        Net effect on ledger
                        <span className="ml-2 align-middle">
                          <Badge variant={fullyOffset ? "default" : "destructive"}>
                            {fullyOffset
                              ? "Fully offset"
                              : `Residual ${money(Math.abs(netEffect))}`}
                          </Badge>
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{money(netDr)}</TableCell>
                      <TableCell className="text-right">{money(netCr)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
            <AdvanceLedgerBreakdownCard legs={allLegs} />
            {advanceId && (
              <AdvanceRecoveryTimelineCard
                advanceId={advanceId}
                deductedFromPayrollId={
                  typeof advance?.deducted_from_payroll_id === "string"
                    ? advance.deducted_from_payroll_id
                    : null
                }
                onNavigate={() => onOpenChange(false)}
              />
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="whitespace-nowrap">Posted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allLegs.map((leg) => (
                  <TableRow key={leg.id} className={leg.is_voided ? "opacity-50 line-through" : ""}>
                    <TableCell className="whitespace-nowrap">{leg.transaction_date}</TableCell>
                    <TableCell>
                      <span className="font-medium">
                        {leg.chart_of_accounts?.account_code} · {leg.chart_of_accounts?.account_name}
                      </span>
                      {leg.reference_type === "staff_advance_reversal" && (
                        <Badge variant="outline" className="ml-2 align-middle text-[10px]">
                          Reversal
                        </Badge>
                      )}
                      {advanceBranchId && leg.branch_id && leg.branch_id !== advanceBranchId && (
                        <span className="ml-2 align-middle">
                          <BranchMismatchBadge
                            label={branchName(leg.branch_id)}
                            issues={[
                              {
                                code: "ledger_leg_branch",
                                message: `This leg is posted to ${branchName(
                                  leg.branch_id
                                )} while the advance sits on ${branchName(advanceBranchId)}.`,
                                expectedBranchId: advanceBranchId,
                                foundBranchId: leg.branch_id,
                              },
                            ]}
                          />
                        </span>
                      )}
                      {leg.description && (
                        <p className="text-xs text-muted-foreground">{leg.description}</p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {legKindLabel(legKind(leg.reference_type))}
                    </TableCell>
                    <TableCell>
                      <Badge variant={Number(leg.debit || 0) > 0 ? "secondary" : "outline"}>
                        {Number(leg.debit || 0) > 0 ? "DR" : "CR"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {Number(leg.debit || 0) > 0 ? money(Number(leg.debit)) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {Number(leg.credit || 0) > 0 ? money(Number(leg.credit)) : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {fmtTs(leg.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between rounded-md bg-muted p-3 text-sm">
              <span>
                Net DR {money(totalDr)} · Net CR {money(totalCr)} · {displayCurrency}
                {isReversed && (
                  <span className="ml-1 text-muted-foreground">(net zero after reversal)</span>
                )}
              </span>
              <Badge variant={balanced ? "default" : "destructive"}>
                {balanced ? "Balanced" : "Out of balance"}
              </Badge>
            </div>
          </div>
        )}

        {!isLoading && timeline.length > 0 && (
          <div className="mt-4 space-y-3">
            <p className="text-sm font-medium">Audit timeline</p>
            <ol className="relative space-y-4 border-l pl-6">
              {timeline.map((ev, i) => {
                const Icon = ev.icon;
                return (
                  <li key={`${ev.title}-${i}`} className="relative">
                    <span
                      className={`absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full ${toneClass(ev.tone)}`}
                    >
                      <Icon className="h-3 w-3" />
                    </span>
                    <p className="text-sm font-medium">{ev.title}</p>
                    {ev.detail && (
                      <p className="text-xs text-muted-foreground">{ev.detail}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {ev.at ? fmtTs(ev.at) : "—"}
                    </p>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {!isLoading && (
          <div className="mt-4">
            <AdvanceSettlementTimelineCard
              advanceId={advanceId}
              advance={(advance as never) ?? null}
              legs={allLegs as never}
              enabled={open}
            />
          </div>
        )}

        {!isLoading && isReversed && (
          <ReversalAuditLogCard
            reversalTransactionIds={reversalLegs.map((l) => l.id)}
            enabled={open}
          />
        )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
