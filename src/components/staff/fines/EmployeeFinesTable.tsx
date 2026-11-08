import { useState } from "react";
import { format } from "date-fns";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MoreHorizontal, FileText, History, Ban, Check, X, Send, Search, Undo2, Split } from "lucide-react";
import { toast } from "sonner";
import { FineStatusBadge } from "./FineStatusBadge";
import { FineAuditTimeline } from "./FineAuditTimeline";
import { FineEvidenceManager } from "./FineEvidenceManager";
import { ConvertFineToInstallmentsDialog } from "./ConvertFineToInstallmentsDialog";
import { RescheduleFineInstallmentsDialog } from "./RescheduleFineInstallmentsDialog";
import { BulkSplitFinesIntoInstallmentsDialog } from "./BulkSplitFinesIntoInstallmentsDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { computeFineSettlements, type FineSettlementRow } from "@/lib/fineSettlementStatus";
import { useQuery } from "@tanstack/react-query";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useViolationTypes } from "@/hooks/useEmployeeFines";
import {
  useEmployeeFines,
  type EmployeeFine,
  type FineStatus,
} from "@/hooks/useEmployeeFines";

interface Props {
  fines: EmployeeFine[];
  isLoading: boolean;
  canApprove: boolean;
}

export function EmployeeFinesTable({ fines, isLoading, canApprove }: Props) {
  const { format: fmt } = useCurrency();
  const { user, hasRole } = useAuth();
  const { changeStatus } = useEmployeeFines();
  const [reasonFor, setReasonFor] = useState<{ fine: EmployeeFine; status: FineStatus } | null>(null);
  const [reason, setReason] = useState("");
  const [auditFine, setAuditFine] = useState<EmployeeFine | null>(null);
  const [evidenceFine, setEvidenceFine] = useState<EmployeeFine | null>(null);
  const [convertFine, setConvertFine] = useState<EmployeeFine | null>(null);
  const [rescheduleFine, setRescheduleFine] = useState<EmployeeFine | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkSplitOpen, setBulkSplitOpen] = useState(false);
  const { violationTypes } = useViolationTypes();

  // Only fines that are not already on an installment plan can be split.
  const splittable = fines.filter((f) => !f.installment_count && f.status !== "cancelled");
  const selectedFines = splittable.filter((f) => selected.includes(f.id));
  const allSelected = splittable.length > 0 && selectedFines.length === splittable.length;
  const toggleAll = () =>
    setSelected(allSelected ? [] : splittable.map((f) => f.id));
  const toggleOne = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  // Installment rows can be hidden by the current filters, so plan-level
  // settlement totals are always read from the full group.
  const groupIds = Array.from(
    new Set(fines.map((f) => f.installment_group_id).filter(Boolean) as string[]),
  ).sort();

  const { data: groupRows } = useQuery({
    queryKey: ["fine-settlement-groups", groupIds],
    enabled: groupIds.length > 0,
    queryFn: async () => {
      const { data, error } = await db
        .from("employee_fines")
        .select(
          "id, amount, recovered_amount, status, applied_payroll_id, installment_group_id, installment_total_amount",
        )
        .in("installment_group_id", groupIds)
        .is("deleted_at", null);
      if (error) throw error;
      return (data ?? []) as FineSettlementRow[];
    },
  });

  const settlements = (() => {
    const rows: FineSettlementRow[] = [
      ...fines.map((f) => ({
        id: f.id,
        amount: f.amount,
        recovered_amount: f.recovered_amount,
        status: f.status,
        applied_payroll_id: f.applied_payroll_id,
        installment_group_id: f.installment_group_id ?? null,
        installment_total_amount: f.installment_total_amount ?? null,
      })),
    ];
    const seen = new Set(rows.map((r) => r.id));
    for (const r of groupRows ?? []) if (!seen.has(r.id)) rows.push(r);
    return computeFineSettlements(rows);
  })();

  const openEvidence = async (path: string) => {
    const { data, error } = await db.storage.from("fine-evidence").createSignedUrl(path, 60);
    if (error || !data) {
      toast.error("Could not open evidence");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const submitReason = async () => {
    if (!reasonFor) return;
    if (!reason.trim()) {
      toast.error("A reason is required");
      return;
    }
    await changeStatus.mutateAsync({ id: reasonFor.fine.id, status: reasonFor.status, reason });
    setReason("");
    setReasonFor(null);
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  if (!fines.length) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-10 text-center">
        <Search className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No fines match the current filters.</p>
      </div>
    );
  }

  return (
    <>
      {canApprove && selectedFines.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2">
          <span className="text-sm">
            {selectedFines.length} fine{selectedFines.length > 1 ? "s" : ""} selected
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
              Clear
            </Button>
            <Button size="sm" onClick={() => setBulkSplitOpen(true)}>
              <Split className="mr-2 h-4 w-4" /> Split into installments
            </Button>
          </div>
        </div>
      )}
      <div className="rounded-lg border border-border/60 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {canApprove && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    disabled={splittable.length === 0}
                    onCheckedChange={toggleAll}
                    aria-label="Select all splittable fines"
                  />
                </TableHead>
              )}
              <TableHead>Reference</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Violation</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Payroll month</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="min-w-[170px]">Settlement</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {fines.map((f) => (
              <TableRow key={f.id}>
                {canApprove && (
                  <TableCell>
                    <Checkbox
                      checked={selected.includes(f.id)}
                      disabled={!splittable.some((s) => s.id === f.id)}
                      onCheckedChange={() => toggleOne(f.id)}
                      aria-label={`Select fine ${f.fine_number ?? ""}`}
                    />
                  </TableCell>
                )}
                <TableCell className="font-mono text-xs">{f.fine_number ?? "—"}</TableCell>
                <TableCell className="font-medium">{f.staff?.name ?? "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {f.violation_type?.name_en ?? "—"}
                </TableCell>
                <TableCell className="text-sm">{format(new Date(f.violation_date), "dd MMM yyyy")}</TableCell>
                <TableCell className="text-sm">{format(new Date(f.payroll_month), "MMM yyyy")}</TableCell>
                <TableCell className="text-right font-medium">
                  {fmt(Number(f.amount))}
                  {f.installment_count ? (
                    <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                      inst. {f.installment_number}/{f.installment_count}
                    </span>
                  ) : null}
                  {Number(f.recovered_amount ?? 0) > 0 ? (
                    <div className="text-[10px] font-normal text-muted-foreground">
                      already deducted {fmt(Number(f.recovered_amount))}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell><FineStatusBadge status={f.status} /></TableCell>
                <TableCell>
                  {(() => {
                    const s = settlements[f.id];
                    if (!s) return <span className="text-xs text-muted-foreground">—</span>;
                    const label =
                      s.state === "cancelled"
                        ? "Cancelled"
                        : s.state === "settled"
                        ? "Fully recovered"
                        : s.state === "partial"
                        ? `${s.percent}% recovered`
                        : "Not yet recovered";
                    return (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              s.state === "settled"
                                ? "default"
                                : s.state === "partial"
                                ? "secondary"
                                : "outline"
                            }
                            className="text-[10px]"
                          >
                            {label}
                          </Badge>
                          {s.totalInstallments > 1 && (
                            <span className="text-[10px] text-muted-foreground">
                              {s.paidInstallments}/{s.totalInstallments} paid
                            </span>
                          )}
                        </div>
                        <Progress value={s.percent} className="h-1.5" />
                        <div className="text-[10px] text-muted-foreground">
                          {fmt(s.recovered)} recovered · {fmt(s.due)} due of {fmt(s.total)}
                        </div>
                      </div>
                    );
                  })()}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {f.status === "draft" && (
                        <DropdownMenuItem
                          onClick={() => changeStatus.mutate({ id: f.id, status: "submitted" })}
                        >
                          <Send className="mr-2 h-4 w-4" /> Submit
                        </DropdownMenuItem>
                      )}
                      {canApprove && f.status === "submitted" && (
                        <DropdownMenuItem
                          onClick={() => changeStatus.mutate({ id: f.id, status: "under_review" })}
                        >
                          <FileText className="mr-2 h-4 w-4" /> Start review
                        </DropdownMenuItem>
                      )}
                      {canApprove && ["submitted", "under_review"].includes(f.status) && (
                        <>
                          {f.created_by === user?.id && !hasRole("owner") ? (
                            <DropdownMenuItem disabled>
                              <Check className="mr-2 h-4 w-4" /> Approve (self-approval blocked)
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => changeStatus.mutate({ id: f.id, status: "approved" })}
                            >
                              <Check className="mr-2 h-4 w-4" /> Approve
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => setReasonFor({ fine: f, status: "rejected" })}>
                            <X className="mr-2 h-4 w-4" /> Reject
                          </DropdownMenuItem>
                        </>
                      )}
                      {f.status === "rejected" && (
                        <DropdownMenuItem
                          onClick={() => changeStatus.mutate({ id: f.id, status: "draft" })}
                        >
                          <Undo2 className="mr-2 h-4 w-4" /> Return to draft for rework
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => setEvidenceFine(f)}>
                        <FileText className="mr-2 h-4 w-4" /> Evidence attachments
                      </DropdownMenuItem>
                      {canApprove &&
                        !f.installment_count &&
                        f.status !== "cancelled" && (
                          <DropdownMenuItem onClick={() => setConvertFine(f)}>
                            <Split className="mr-2 h-4 w-4" /> Split into installments
                          </DropdownMenuItem>
                        )}
                      {canApprove &&
                        !!f.installment_group_id &&
                        f.status !== "cancelled" && (
                          <DropdownMenuItem onClick={() => setRescheduleFine(f)}>
                            <Split className="mr-2 h-4 w-4" /> Re-split remaining balance
                          </DropdownMenuItem>
                        )}
                      <DropdownMenuItem onClick={() => setAuditFine(f)}>
                        <History className="mr-2 h-4 w-4" /> Audit trail
                      </DropdownMenuItem>
                      {canApprove && f.status !== "cancelled" && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setReasonFor({ fine: f, status: "cancelled" })}
                          >
                            <Ban className="mr-2 h-4 w-4" /> Cancel fine
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mandatory reason dialog for rejection / cancellation */}
      <Dialog open={!!reasonFor} onOpenChange={(o) => !o && setReasonFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reasonFor?.status === "cancelled" ? "Cancel fine" : "Reject fine"}
            </DialogTitle>
            <DialogDescription>
              Fines are never deleted. A written reason is recorded in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label>Reason</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonFor(null)}>Back</Button>
            <Button onClick={submitReason} disabled={changeStatus.isPending}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Audit trail */}
      <Dialog open={!!auditFine} onOpenChange={(o) => !o && setAuditFine(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Audit trail — {auditFine?.fine_number}</DialogTitle>
            <DialogDescription>
              Who created, modified and approved this fine, amount changes with reasons, and payroll application.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-3">
            <FineAuditTimeline fineId={auditFine?.id} />
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Evidence attachments */}
      <ConvertFineToInstallmentsDialog
        fine={convertFine}
        onOpenChange={(o) => !o && setConvertFine(null)}
      />

      <RescheduleFineInstallmentsDialog
        fine={rescheduleFine}
        onOpenChange={(o) => !o && setRescheduleFine(null)}
      />

      <BulkSplitFinesIntoInstallmentsDialog
        fines={selectedFines}
        open={bulkSplitOpen}
        onOpenChange={setBulkSplitOpen}
        onDone={() => setSelected([])}
      />

      <Dialog open={!!evidenceFine} onOpenChange={(o) => !o && setEvidenceFine(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Evidence — {evidenceFine?.fine_number}</DialogTitle>
            <DialogDescription>
              Upload, view or download the supporting documents proving this violation.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-3">
            {evidenceFine && (
              <FineEvidenceManager
                fineId={evidenceFine.id}
                legacyPath={evidenceFine.evidence_path}
                requiresEvidence={
                  !!violationTypes.find((t) => t.id === evidenceFine.violation_type_id)
                    ?.requires_evidence
                }
                canManage={canApprove || ["draft", "submitted"].includes(evidenceFine.status)}
              />
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}