import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { format as formatDate } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, AlertTriangle, Scale, CheckCircle2, ArrowLeft, ArrowRight, RefreshCw } from "lucide-react";
import { Info, Download } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { reconciledTotal as calcReconciledTotal } from "@/lib/dayEndReconciliation";

export type DayEndScope = "daily_sales" | "shift" | "expense_day";

/**
 * Per-reason validation rules. Each reason can require a minimum note length
 * and an explicit hint to coach the user on what is expected.
 */
export const DAY_END_REASONS: {
  value: string;
  label: string;
  minNotes: number;
  hint: string;
}[] = [
  {
    value: "missing_receipt",
    label: "Missing receipt",
    minNotes: 15,
    hint: "Reference vendor/invoice # and approximate amount.",
  },
  {
    value: "cash_miscount",
    label: "Cash miscount",
    minNotes: 15,
    hint: "Who counted, denomination(s) affected, and recount status.",
  },
  {
    value: "delivery_sync_delay",
    label: "Delivery platform sync delay",
    minNotes: 15,
    hint: "Platform name and order range affected.",
  },
  {
    value: "refund_not_recorded",
    label: "Refund not recorded",
    minNotes: 15,
    hint: "POS ticket #, customer, and refund reason.",
  },
  {
    value: "missing_expense_entry",
    label: "Missing expense entry",
    minNotes: 15,
    hint: "Supplier, category, and approximate amount.",
  },
  {
    value: "unrecorded_sales",
    label: "Unrecorded sales (cashier missed POS entry)",
    minNotes: 15,
    hint: "Approx. ticket count or amount, payment method (cash/card), and reason it wasn't rung in.",
  },
  {
    value: "other",
    label: "Other (explain in notes)",
    minNotes: 25,
    hint: "Explain in detail - 'Other' requires a thorough description.",
  },
];

const REASON_VALUES = DAY_END_REASONS.map((r) => r.value) as [string, ...string[]];

/**
 * Reusable templates the user can pick from. Each template maps to one of the
 * existing DAY_END_REASONS enum values and pre-fills a notes scaffold so the
 * user only has to fill in specifics. Templates are filtered by sign of the
 * adjustment so cashiers see overage-relevant choices when cash is over and
 * shortage-relevant choices when cash is short.
 */
export type ReasonTemplate = {
  id: string;
  label: string;
  reason: typeof REASON_VALUES[number];
  appliesTo: "overage" | "shortage" | "both";
  scaffold: string;
};

export const REASON_TEMPLATES: ReasonTemplate[] = [
  // Overage (cash > POS)
  {
    id: "tpl_unrecorded_sales",
    label: "Missed POS entries (unrecorded sales)",
    reason: "unrecorded_sales",
    appliesTo: "overage",
    scaffold:
      "Cashier collected cash for sales that were not rung in POS. Approx. ticket count: ___. Payment method: cash. Reason it wasn't rung: ___.",
  },
  {
    id: "tpl_tips_in_drawer",
    label: "Tips left in drawer",
    reason: "other",
    appliesTo: "overage",
    scaffold:
      "Customer tips were placed in the cash drawer instead of the tips jar. Approx. amount: ___. Will be moved to tips liability.",
  },
  {
    id: "tpl_overage_rounding",
    label: "Rounding differences (overage)",
    reason: "cash_miscount",
    appliesTo: "overage",
    scaffold:
      "Accumulated rounding on cash transactions resulted in a small overage. Number of tickets affected: ___.",
  },
  {
    id: "tpl_overage_count_error",
    label: "Counting error / found cash",
    reason: "cash_miscount",
    appliesTo: "overage",
    scaffold:
      "Recount confirmed extra cash in drawer. Counted by: ___. Denomination(s) affected: ___. Recount status: ___.",
  },
  {
    id: "tpl_bank_deposit_timing_over",
    label: "Bank deposit timing (cash held over)",
    reason: "other",
    appliesTo: "overage",
    scaffold:
      "Cash from a prior day was held in the safe and counted today. Original business day: ___. Amount: ___.",
  },

  // Shortage (cash < POS)
  {
    id: "tpl_refund_not_recorded",
    label: "Refund/void not recorded in POS",
    reason: "refund_not_recorded",
    appliesTo: "shortage",
    scaffold:
      "A refund was issued in cash but not entered in POS. Ticket #: ___. Customer: ___. Reason for refund: ___.",
  },
  {
    id: "tpl_petty_cash_paid",
    label: "Petty cash paid out (no receipt)",
    reason: "missing_receipt",
    appliesTo: "shortage",
    scaffold:
      "Cash paid out of drawer for a small purchase without a receipt. Vendor: ___. Approx. amount: ___. Item/purpose: ___.",
  },
  {
    id: "tpl_missing_expense",
    label: "Missing expense entry",
    reason: "missing_expense_entry",
    appliesTo: "shortage",
    scaffold:
      "Cash spent on an expense that was not entered. Supplier: ___. Category: ___. Approx. amount: ___.",
  },
  {
    id: "tpl_delivery_sync",
    label: "Delivery platform sync delay",
    reason: "delivery_sync_delay",
    appliesTo: "shortage",
    scaffold:
      "Delivery sales not yet synced from platform at close. Platform: ___. Order range affected: ___.",
  },
  {
    id: "tpl_cash_short",
    label: "Cash short / till discrepancy",
    reason: "cash_miscount",
    appliesTo: "shortage",
    scaffold:
      "Drawer count was less than expected after recount. Counted by: ___. Denomination(s) affected: ___. Recount status: ___.",
  },
  {
    id: "tpl_shortage_rounding",
    label: "Rounding differences (shortage)",
    reason: "cash_miscount",
    appliesTo: "shortage",
    scaffold:
      "Accumulated rounding on cash transactions resulted in a small shortage. Number of tickets affected: ___.",
  },

  // Either direction
  {
    id: "tpl_other",
    label: "Other (explain in notes)",
    reason: "other",
    appliesTo: "both",
    scaffold:
      "Describe in detail what happened, who was involved, and any references (POS ticket, invoice, driver, etc.).",
  },
];

/** Maximum allowed adjustment magnitude (sanity cap to block fat-finger posts). */
const MAX_ADJUSTMENT_ABS = 100_000;

function buildSchema(reasonValue: string) {
  const rule =
    DAY_END_REASONS.find((r) => r.value === reasonValue) ?? DAY_END_REASONS[0];
  return z.object({
    amount: z
      .number()
      .refine((n) => Number.isFinite(n), { message: "Amount is required" })
      .refine((n) => n !== 0, {
        message: "Amount must be non-zero - a zero entry does not balance anything",
      })
      .refine((n) => Math.abs(n) <= MAX_ADJUSTMENT_ABS, {
        message: `Amount exceeds the safety limit (${MAX_ADJUSTMENT_ABS.toLocaleString()})`,
      })
      .refine((n) => Math.round(n * 100) === n * 100, {
        message: "Amount may have at most 2 decimal places",
      }),
    reason: z.enum(REASON_VALUES),
    notes: z
      .string()
      .trim()
      .min(
        rule.minNotes,
        `This reason requires at least ${rule.minNotes} characters of explanation`,
      )
      .max(500, "Notes are too long (max 500)"),
  });
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: DayEndScope;
  scopeRefId?: string | null;
  businessDate: string; // YYYY-MM-DD
  /** Optional pre-filled signed amount (e.g. shift variance). */
  defaultAmount?: number;
  /** Optional title override. */
  title?: string;
  onPosted?: (adjustmentId: string) => void;
  /**
   * Optional callback invoked after a successful post when the user clicks
   * "Post & Close Day". When provided, an extra primary button is shown on
   * the confirm step that posts the adjustment and then triggers Close Day.
   * Receives the just-posted adjustment id so the parent can offer an Undo.
   */
  onPostedAndCloseDay?: (adjustmentId: string) => void | Promise<void>;
  /**
   * Optional reconciliation context. When provided, the dialog renders an
   * "Adjusted Total preview" panel showing the recorded payment-type total,
   * the POS Reported total, the current net of active day-end adjustments,
   * and the resulting Adjusted Total before vs. after this entry posts.
   * Lets the operator confirm the math (and the DR/CR lines) match the
   * intended ledger behavior before clicking Confirm & Post.
   */
  recordedTotal?: number;
  posReportedTotal?: number;
  netDayEndAdjustment?: number;
}

export function DayEndAdjustmentDialog({
  open,
  onOpenChange,
  scope,
  scopeRefId,
  businessDate,
  defaultAmount,
  title,
  onPosted,
  onPostedAndCloseDay,
  recordedTotal,
  posReportedTotal,
  netDayEndAdjustment,
}: Props) {
  const { tenant, restaurant, user } = useAuth();
  const { activeBranchId } = useBranch();
  const { format: formatCurrency } = useCurrency();

  const [amount, setAmount] = useState<string>(
    defaultAmount !== undefined ? String(defaultAmount) : ""
  );
  const [reason, setReason] = useState<string>("missing_receipt");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState<{ amount: boolean; notes: boolean }>({
    amount: false,
    notes: false,
  });
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  // Final compact DR/CR confirmation modal shown after the user clicks
  // "Confirm & Post" (or "Post & Close Day"), right before we actually write
  // to the ledger. Holds the variant the user chose so we know whether to
  // also close the day after posting.
  const [finalCheck, setFinalCheck] = useState<null | { andCloseDay: boolean }>(
    null,
  );
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  // When true, the amount field auto-tracks `defaultAmount` (current variance).
  // The moment the user types into the amount field, we stop overwriting it.
  const [autoSync, setAutoSync] = useState(true);
  const lastSyncedRef = useRef<number | undefined>(defaultAmount);

  // Look up an existing active (unreversed, non-reversal) adjustment for the
  // same scope + scope_ref + business_date. The DB has a trigger that blocks
  // duplicate posts, so we surface a clear UI warning here too - and disable
  // the Submit / Review actions when one already exists.
  const {
    data: existingActiveAdjustment,
    refetch: refetchExisting,
  } = useQuery({
    queryKey: [
      "day-end-adjustments-active-blocker",
      scope,
      scopeRefId ?? null,
      businessDate,
      tenant?.id ?? null,
    ],
    enabled: open && !!tenant?.id && !!businessDate,
    staleTime: 10_000,
    queryFn: async () => {
      let q = supabase
        .from("day_end_adjustments")
        .select("id, amount, reason, notes, created_at, created_by")
        .eq("scope", scope)
        .eq("business_date", businessDate)
        .is("reversed_at", null)
        .is("reversal_of_id", null)
        .order("created_at", { ascending: false })
        .limit(1);
      if (scopeRefId) q = q.eq("scope_ref_id", scopeRefId);
      else q = q.is("scope_ref_id", null);
      const { data, error } = await q;
      if (error) throw error;
      return (data && data[0]) || null;
    },
  });
  const isBlockedByExisting = !!existingActiveAdjustment;

  // Reset state every time the dialog opens so a fresh variance is picked up
  // and stale user edits from a previous session are cleared.
  useEffect(() => {
    if (open) {
      setAutoSync(true);
      setAmount(defaultAmount !== undefined ? String(defaultAmount) : "");
      lastSyncedRef.current = defaultAmount;
      setActiveTemplateId(null);
      setFinalCheck(null);
      // Re-check for an existing active adjustment every time the dialog opens
      // so a freshly-posted entry from another tab is reflected.
      refetchExisting();
    }
    // We intentionally only react to `open` toggling - defaultAmount changes
    // while open are handled by the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // While the dialog is open and the user hasn't manually overridden the
  // amount, keep the field in sync with the live variance from the parent.
  useEffect(() => {
    if (!open || !autoSync) return;
    if (defaultAmount === undefined) return;
    if (lastSyncedRef.current === defaultAmount) return;
    setAmount(String(defaultAmount));
    lastSyncedRef.current = defaultAmount;
  }, [defaultAmount, open, autoSync]);

  const numericAmount = Number(amount);
  const liveVarianceAvailable =
    defaultAmount !== undefined && Number.isFinite(defaultAmount);
  const matchesLiveVariance =
    liveVarianceAvailable &&
    Math.abs(Number(amount) - (defaultAmount as number)) < 0.005;
  const previewSign = numericAmount > 0 ? "Overage" : numericAmount < 0 ? "Shortage" : "-";

  const activeRule =
    DAY_END_REASONS.find((r) => r.value === reason) ?? DAY_END_REASONS[0];

  // Live validation - recomputed on every keystroke so the submit button
  // accurately reflects whether the entry would post successfully.
  const validation = buildSchema(reason).safeParse({
    amount: numericAmount,
    reason,
    notes,
  });

  const fieldErrors: { amount?: string; notes?: string; reason?: string } = {};
  if (!validation.success) {
    for (const issue of validation.error.issues) {
      const key = issue.path[0] as "amount" | "notes" | "reason" | undefined;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
  }

  const canSubmit = validation.success && !submitting;

  // Build the exact DR/CR rows that will hit the ledger so the user
  // sees what they are about to post (mirrors post_day_end_adjustment_to_ledger).
  const absAmount = Math.abs(numericAmount);
  const isOverage = numericAmount > 0;
  const ledgerRows = Number.isFinite(numericAmount) && numericAmount !== 0
    ? isOverage
      ? [
          { account: "1000 - Cash on Hand", debit: absAmount, credit: 0 },
          { account: "6999 - Cash Over/Short", debit: 0, credit: absAmount },
        ]
      : [
          { account: "6999 - Cash Over/Short", debit: absAmount, credit: 0 },
          { account: "1000 - Cash on Hand", debit: 0, credit: absAmount },
        ]
    : [];
  const totalDebit = ledgerRows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = ledgerRows.reduce((s, r) => s + r.credit, 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  // Adjusted-Total preview - only when the parent passes reconciliation
  // context. Mirrors the math used by DailySalesRecorder so what the user
  // sees here is exactly what the dashboard will show after posting.
  const hasReconciliationContext =
    recordedTotal !== undefined ||
    posReportedTotal !== undefined ||
    netDayEndAdjustment !== undefined;
  const recTotal = recordedTotal ?? 0;
  const posTotal = posReportedTotal ?? 0;
  const currentNetAdj = netDayEndAdjustment ?? 0;
  const newSigned = Number.isFinite(numericAmount) ? numericAmount : 0;
  const projectedNetAdj = currentNetAdj + newSigned;
  const adjustedBefore = calcReconciledTotal({
    recordedTotal: recTotal,
    posReportedTotal: posTotal,
    netAdjustment: currentNetAdj,
  });
  const adjustedAfter = calcReconciledTotal({
    recordedTotal: recTotal,
    posReportedTotal: posTotal,
    netAdjustment: projectedNetAdj,
  });
  const adjustedDelta = adjustedAfter - adjustedBefore;

  /**
   * Build a one-page PDF of the reconciliation preview so the operator can
   * keep a copy in the shift record before they confirm posting. Renders
   * fully client-side via jsPDF - no network round-trip, works offline.
   */
  const handleExportPreviewPdf = async () => {
    try {
      const { default: jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 48;
      let y = margin;

      const restName = restaurant?.name ?? "Restaurant";
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("Day-End Reconciliation Preview", margin, y);
      y += 18;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(restName, margin, y);
      y += 14;
      doc.text(`Business date: ${businessDate}`, margin, y);
      y += 14;
      doc.text(`Scope: ${scope}${scopeRefId ? ` (${scopeRefId})` : ""}`, margin, y);
      y += 14;
      doc.text(`Generated: ${new Date().toLocaleString()}`, margin, y);
      y += 14;
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(
        "PROVISIONAL - preview only, journal entry has NOT been posted yet.",
        margin,
        y,
      );
      doc.setTextColor(0);
      y += 22;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Totals", margin, y);
      y += 6;
      doc.setLineWidth(0.5);
      doc.line(margin, y, pageW - margin, y);
      y += 14;

      const fmt = (n: number) => formatCurrency(n);
      const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");
      const row = (label: string, value: string) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text(label, margin, y);
        doc.text(value, pageW - margin, y, { align: "right" });
        y += 14;
      };
      row("Recorded payment-type total", fmt(recTotal));
      row("POS Reported total", posTotal > 0 ? fmt(posTotal) : "-");
      row(
        "Active adjustments (net)",
        currentNetAdj === 0
          ? "-"
          : `${sign(currentNetAdj)}${fmt(Math.abs(currentNetAdj))}`,
      );
      row(
        "This entry",
        newSigned === 0 ? "-" : `${sign(newSigned)}${fmt(Math.abs(newSigned))}`,
      );
      y += 4;
      doc.line(margin, y, pageW - margin, y);
      y += 14;
      doc.setFont("helvetica", "bold");
      row("Adjusted Total after posting", fmt(adjustedAfter));
      if (newSigned !== 0) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(120);
        doc.text(
          `was ${fmt(adjustedBefore)} (${sign(adjustedDelta)}${fmt(Math.abs(adjustedDelta))})`,
          pageW - margin,
          y,
          { align: "right" },
        );
        doc.setTextColor(0);
        y += 16;
      }

      y += 10;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Journal entry preview", margin, y);
      y += 6;
      doc.line(margin, y, pageW - margin, y);
      y += 14;
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text("Account", margin, y);
      doc.text("Debit", pageW - margin - 90, y, { align: "right" });
      doc.text("Credit", pageW - margin, y, { align: "right" });
      y += 12;
      doc.setFont("helvetica", "normal");
      if (ledgerRows.length === 0) {
        doc.setTextColor(120);
        doc.text("(enter an amount to see ledger lines)", margin, y);
        doc.setTextColor(0);
        y += 14;
      } else {
        for (const r of ledgerRows) {
          doc.text(r.account, margin, y);
          doc.text(r.debit > 0 ? fmt(r.debit) : "-", pageW - margin - 90, y, {
            align: "right",
          });
          doc.text(r.credit > 0 ? fmt(r.credit) : "-", pageW - margin, y, {
            align: "right",
          });
          y += 14;
        }
        doc.setFont("helvetica", "bold");
        doc.text("Totals", margin, y);
        doc.text(fmt(totalDebit), pageW - margin - 90, y, { align: "right" });
        doc.text(fmt(totalCredit), pageW - margin, y, { align: "right" });
        y += 16;
      }

      if (notes.trim()) {
        y += 8;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text("Variance note", margin, y);
        y += 6;
        doc.line(margin, y, pageW - margin, y);
        y += 14;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        const wrapped = doc.splitTextToSize(notes.trim(), pageW - margin * 2);
        doc.text(wrapped, margin, y);
        y += wrapped.length * 12;
      }

      const filename = `reconciliation-preview_${businessDate}_${scope}.pdf`;
      doc.save(filename);
      toast.success("Preview PDF downloaded");
    } catch (err) {
      console.error("export reconciliation preview pdf failed", err);
      toast.error("Could not generate preview PDF");
    }
  };

  const ReconciliationPreview = () =>
    hasReconciliationContext ? (
      <div className="rounded-md border bg-card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs">Adjusted Total preview</Label>
            <TooltipProvider delayDuration={150} disableHoverableContent={false}>
              <Tooltip>
                {/*
                  Radix Tooltip opens on both pointer hover and keyboard focus
                  by default - we just make sure the trigger is a real <button>
                  with a visible focus ring so keyboard users get the same
                  affordance as mouse users.
                */}
                <TooltipTrigger
                  type="button"
                  aria-label="What is a day-end reconciliation?"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                >
                  <Info className="h-3.5 w-3.5" aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  align="start"
                  sideOffset={6}
                  collisionPadding={12}
                  className="w-80 max-w-[calc(100vw-2rem)] p-3 text-xs leading-relaxed bg-popover text-popover-foreground border-border shadow-md"
                >
                  <p className="font-medium mb-1">What is reconciliation?</p>
                  <p className="mb-2">
                    At day-end the cash counted in the drawer often differs
                    from what the POS rang up. A <strong>day-end adjustment</strong>{" "}
                    records that difference so the books match reality.
                  </p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>
                      <strong>Overage (+)</strong>: extra cash found.
                      DR Cash on Hand, CR Cash Over/Short.
                    </li>
                    <li>
                      <strong>Shortage (−)</strong>: cash missing.
                      DR Cash Over/Short, CR Cash on Hand.
                    </li>
                  </ul>
                  <p className="mt-2 text-muted-foreground">
                    It re-balances cash only - it does <em>not</em> add or remove
                    revenue. The Adjusted Total stays equal to POS Reported.
                  </p>
                  <div className="mt-2 rounded border border-border/60 bg-muted/40 p-2">
                    <p className="font-medium mb-1">Example - overage of ﷼50</p>
                    <p className="mb-1 text-muted-foreground">
                      POS rang ﷼1,000 but the drawer held ﷼1,050.
                    </p>
                    <table className="w-full tabular-nums">
                      <thead className="text-muted-foreground">
                        <tr>
                          <th className="text-left font-normal">Account</th>
                          <th className="text-right font-normal">DR</th>
                          <th className="text-right font-normal">CR</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>1000 Cash on Hand</td>
                          <td className="text-right">50.00</td>
                          <td className="text-right">-</td>
                        </tr>
                        <tr>
                          <td>6999 Cash Over/Short</td>
                          <td className="text-right">-</td>
                          <td className="text-right">50.00</td>
                        </tr>
                      </tbody>
                    </table>
                    <p className="mt-2 font-medium mb-1">Example - shortage of ﷼20</p>
                    <p className="mb-1 text-muted-foreground">
                      POS rang ﷼1,000 but the drawer held only ﷼980.
                    </p>
                    <table className="w-full tabular-nums">
                      <thead className="text-muted-foreground">
                        <tr>
                          <th className="text-left font-normal">Account</th>
                          <th className="text-right font-normal">DR</th>
                          <th className="text-right font-normal">CR</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>6999 Cash Over/Short</td>
                          <td className="text-right">20.00</td>
                          <td className="text-right">-</td>
                        </tr>
                        <tr>
                          <td>1000 Cash on Hand</td>
                          <td className="text-right">-</td>
                          <td className="text-right">20.00</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="hidden sm:inline">
              Cash reconciliation - does not change revenue
            </span>
            <button
              type="button"
              onClick={() => setGlossaryOpen(true)}
              className="underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              Glossary
            </button>
            <span className="text-border">·</span>
            <button
              type="button"
              onClick={handleExportPreviewPdf}
              className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              aria-label="Export reconciliation preview as PDF"
            >
              <Download className="h-3 w-3" aria-hidden="true" />
              Export PDF
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">Recorded payment-type total</span>
          <span className="text-right tabular-nums">{formatCurrency(recTotal)}</span>
          <span className="text-muted-foreground">POS Reported total</span>
          <span className="text-right tabular-nums">
            {posTotal > 0 ? formatCurrency(posTotal) : "-"}
          </span>
          <span className="text-muted-foreground">Active adjustments (net)</span>
          <span className="text-right tabular-nums">
            {currentNetAdj === 0 ? "-" : `${currentNetAdj > 0 ? "+" : "−"}${formatCurrency(Math.abs(currentNetAdj))}`}
          </span>
          <span className="text-muted-foreground">This entry</span>
          <span
            className={
              "text-right tabular-nums " +
              (newSigned === 0
                ? "text-muted-foreground"
                : newSigned > 0
                  ? "text-emerald-600"
                  : "text-destructive")
            }
          >
            {newSigned === 0
              ? "-"
              : `${newSigned > 0 ? "+" : "−"}${formatCurrency(Math.abs(newSigned))}`}
          </span>
        </div>
        <div className="border-t pt-2 flex items-center justify-between">
          <span className="text-xs font-medium">Adjusted Total after posting</span>
          <div className="text-right">
            <div className="text-sm font-semibold tabular-nums">
              {formatCurrency(adjustedAfter)}
            </div>
            {newSigned !== 0 && (
              <div className="text-[11px] text-muted-foreground tabular-nums">
                was {formatCurrency(adjustedBefore)}
                {Math.abs(adjustedDelta) >= 0.005 && (
                  <>
                    {" "}
                    ({adjustedDelta > 0 ? "+" : "−"}
                    {formatCurrency(Math.abs(adjustedDelta))})
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        {posTotal > 0 && (
          <p className="text-[11px] text-muted-foreground">
            POS Reported is set, so the Adjusted Total tracks POS - the journal
            entry only re-balances Cash on Hand vs. Cash Over/Short.
          </p>
        )}
      </div>
    ) : null;

  const handleSubmit = async (andCloseDay: boolean = false) => {
    if (!tenant?.id || !restaurant?.id || !user?.id) {
      toast.error("Missing tenant context");
      return;
    }
    setTouched({ amount: true, notes: true });
    const parsed = buildSchema(reason).safeParse({
      amount: numericAmount,
      reason,
      notes,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("day_end_adjustments")
        .insert({
          tenant_id: tenant.id,
          restaurant_id: restaurant.id,
          scope,
          scope_ref_id: scopeRefId ?? null,
          business_date: businessDate,
          branch_id: activeBranchId ?? null,
          reason: parsed.data.reason as
            | "missing_receipt"
            | "cash_miscount"
            | "delivery_sync_delay"
            | "refund_not_recorded"
            | "missing_expense_entry"
            | "unrecorded_sales"
            | "other",
          notes: parsed.data.notes,
          amount: parsed.data.amount,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (error) throw error;

      const { error: postError } = await supabase.rpc(
        "post_day_end_adjustment_to_ledger" as never,
        { p_adjustment_id: data!.id } as never
      );
      if (postError) throw postError;

      toast.success("Day-end adjustment posted to ledger");
      onPosted?.(data!.id);
      onOpenChange(false);
      // reset
      setAmount("");
      setReason("missing_receipt");
      setNotes("");
      setTouched({ amount: false, notes: false });
      if (andCloseDay && onPostedAndCloseDay) {
        try {
          await onPostedAndCloseDay(data!.id);
        } catch (closeErr) {
          const m = closeErr instanceof Error ? closeErr.message : "Close Day failed";
          toast.error(m);
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to post adjustment";
      // The DB guard trigger (prevent_duplicate_day_end_adjustment) raises a
      // VALIDATION_ERROR if a race produces a second active adjustment for the
      // same day. Surface it cleanly and refresh the inline blocker.
      if (msg.includes("active day-end adjustment already exists")) {
        toast.error(
          "An active day-end adjustment already exists for this day. Reverse it first before posting another.",
          { duration: 6000 },
        );
        refetchExisting();
        setFinalCheck(null);
        setStep("form");
      } else {
        toast.error(msg);
      }
    } finally {
      setSubmitting(false);
      setStep("form");
    }
  };

  const handleProceedToConfirm = () => {
    setTouched({ amount: true, notes: true });
    if (!validation.success) {
      const firstKey = validation.error.issues[0].path[0] as
        | "amount"
        | "notes"
        | "reason"
        | undefined;
      // Focus (and select) the first invalid field so the user can fix it
      // immediately without hunting through the form.
      requestAnimationFrame(() => {
        if (firstKey === "amount") {
          const el = document.getElementById("dea-amount") as HTMLInputElement | null;
          el?.focus();
          el?.select?.();
        } else if (firstKey === "notes") {
          const el = document.getElementById("dea-notes") as HTMLTextAreaElement | null;
          el?.focus();
        } else if (firstKey === "reason") {
          const el = document.getElementById("dea-reason-trigger") as HTMLButtonElement | null;
          el?.focus();
        }
      });
      toast.error(validation.error.issues[0].message);
      return;
    }
    setStep("confirm");
  };

  // Reset step whenever the dialog is closed externally.
  const handleOpenChange = (o: boolean) => {
    if (!o) setStep("form");
    onOpenChange(o);
  };

  // Keyboard shortcuts:
  //   Esc          -> close (handled natively by Dialog)
  //   Cmd/Ctrl+Enter on form    -> proceed to Review
  //   Cmd/Ctrl+Enter on confirm -> Confirm & Post
  //   Cmd/Ctrl+Shift+Enter on confirm -> Post & Close Day (if available)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (e.key === "Enter" && meta) {
        e.preventDefault();
        if (isBlockedByExisting) return;
        if (step === "form") {
          handleProceedToConfirm();
        } else {
          if (!balanced || submitting) return;
          if (e.shiftKey && onPostedAndCloseDay) {
            setFinalCheck({ andCloseDay: true });
          } else {
            setFinalCheck({ andCloseDay: false });
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step, validation.success, balanced, submitting, onPostedAndCloseDay, isBlockedByExisting]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md flex flex-col h-[85vh] max-h-[720px]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            {title ?? "Day-End Adjustment"}
            <span className="ml-auto text-[11px] font-normal text-muted-foreground">
              Step {step === "form" ? "1" : "2"} of 2
            </span>
          </DialogTitle>
          <DialogDescription>
            {step === "form" ? (
              <>
                Post a balancing entry for missing or unreconciled records on{" "}
                <strong>{businessDate}</strong>. This is permanent and immutable.
              </>
            ) : (
              <>Review the exact ledger entries below before posting. Nothing is written until you confirm.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 min-h-0">
        {step === "form" ? (
        <div className="space-y-4">
          {isBlockedByExisting && existingActiveAdjustment && (
            <Alert variant="destructive" role="alert" aria-live="assertive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs space-y-2">
                <p className="font-medium">
                  An active day-end adjustment already exists for {businessDate}.
                </p>
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 space-y-0.5">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-mono tabular-nums">
                      {Number(existingActiveAdjustment.amount) >= 0 ? "+" : "−"}
                      {formatCurrency(Math.abs(Number(existingActiveAdjustment.amount) || 0))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Reason</span>
                    <span className="font-medium">
                      {DAY_END_REASONS.find((r) => r.value === existingActiveAdjustment.reason)?.label
                        ?? existingActiveAdjustment.reason}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Posted</span>
                    <span className="font-mono">
                      {formatDate(new Date(existingActiveAdjustment.created_at), "PP p")}
                    </span>
                  </div>
                </div>
                <p>
                  To post a new adjustment, an owner or manager must reverse this
                  one first from the day-end adjustment history.
                </p>
                <div className="flex gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      handleOpenChange(false);
                      // Defer so the dialog finishes closing before scrolling.
                      requestAnimationFrame(() => {
                        const el = document.getElementById(
                          `dea-history-${existingActiveAdjustment.id}`,
                        ) ?? document.getElementById("dea-history");
                        el?.scrollIntoView({ behavior: "smooth", block: "center" });
                      });
                    }}
                  >
                    View existing adjustment
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => refetchExisting()}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Re-check
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="dea-amount">
                Adjustment amount <span className="text-destructive">*</span>
              </Label>
              {liveVarianceAvailable && (
                <div className="flex items-center gap-2 text-[11px]">
                  {autoSync && matchesLiveVariance ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600">
                      <CheckCircle2 className="h-3 w-3" /> Tracking variance
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setAutoSync(true);
                        setAmount(String(defaultAmount));
                        lastSyncedRef.current = defaultAmount;
                        setTouched((t) => ({ ...t, amount: true }));
                      }}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Use current variance ({(defaultAmount as number) > 0 ? "+" : ""}
                      {formatCurrency(Math.abs(defaultAmount as number))})
                    </button>
                  )}
                </div>
              )}
            </div>
            <Input
              id="dea-amount"
              type="number"
              step="0.01"
              placeholder="e.g. -25.00 for shortage, 10.00 for overage"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                // User has taken manual control - stop auto-syncing to the
                // parent variance until they explicitly opt back in.
                setAutoSync(false);
              }}
              onBlur={() => setTouched((t) => ({ ...t, amount: true }))}
              aria-invalid={touched.amount && !!fieldErrors.amount}
              autoFocus
            />
            {touched.amount && fieldErrors.amount ? (
              <p className="text-[11px] text-destructive">{fieldErrors.amount}</p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Use a positive number for overage, negative for shortage.{" "}
                {Number.isFinite(numericAmount) && numericAmount !== 0 && (
                  <span className="font-medium">
                    {previewSign}: {formatCurrency(Math.abs(numericAmount))}
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Template library - context-aware by overage/shortage sign */}
          {(() => {
            const sign: "overage" | "shortage" | null =
              Number.isFinite(numericAmount) && numericAmount !== 0
                ? numericAmount > 0
                  ? "overage"
                  : "shortage"
                : null;
            const visible = REASON_TEMPLATES.filter((t) =>
              sign === null
                ? t.appliesTo === "both"
                : t.appliesTo === sign || t.appliesTo === "both"
            );
            const headerLabel =
              sign === "overage"
                ? "Templates for overage (cash > POS)"
                : sign === "shortage"
                ? "Templates for shortage (cash < POS)"
                : "Templates";
            return (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">
                    {headerLabel}
                  </Label>
                  {sign === null && (
                    <span className="text-[11px] text-muted-foreground">
                      Enter an amount to see context-specific templates
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {visible.map((tpl) => {
                    const isActive = activeTemplateId === tpl.id;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => {
                          setActiveTemplateId(tpl.id);
                          setReason(tpl.reason);
                          // Only overwrite notes if empty or coming from a
                          // previously selected template - never clobber
                          // user-typed prose.
                          const isFromPreviousTemplate = REASON_TEMPLATES.some(
                            (t) => t.scaffold === notes,
                          );
                          if (notes.trim().length === 0 || isFromPreviousTemplate) {
                            setNotes(tpl.scaffold);
                            setTouched((t) => ({ ...t, notes: false }));
                          }
                        }}
                        className={
                          "rounded-full border px-2.5 py-1 text-[11px] transition-colors " +
                          (isActive
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-background hover:bg-muted")
                        }
                      >
                        {tpl.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <div className="space-y-2">
            <Label>
              Reason <span className="text-destructive">*</span>
            </Label>
            <Select
              value={reason}
              onValueChange={(v) => {
                setReason(v);
                setActiveTemplateId(null);
                // Re-prompt notes validation when the rule changes.
                setTouched((t) => ({ ...t, notes: notes.length > 0 }));
              }}
            >
              <SelectTrigger id="dea-reason-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAY_END_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{activeRule.hint}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dea-notes">
              Explanation <span className="text-destructive">*</span>{" "}
              <span className="text-[11px] text-muted-foreground font-normal">
                (min {activeRule.minNotes} chars)
              </span>
            </Label>
            <Textarea
              id="dea-notes"
              rows={3}
              maxLength={500}
              placeholder="What happened? Reference invoice numbers, drivers, or POS IDs if relevant."
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 500))}
              onBlur={() => setTouched((t) => ({ ...t, notes: true }))}
              aria-invalid={touched.notes && !!fieldErrors.notes}
            />
            <div className="flex items-center justify-between text-[11px]">
              {touched.notes && fieldErrors.notes ? (
                <span className="text-destructive">{fieldErrors.notes}</span>
              ) : (
                <span className="text-muted-foreground">
                  {notes.trim().length >= activeRule.minNotes ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600">
                      <CheckCircle2 className="h-3 w-3" /> Looks good
                    </span>
                  ) : (
                    `${Math.max(0, activeRule.minNotes - notes.trim().length)} more characters needed`
                  )}
                </span>
              )}
              <span className="text-muted-foreground">{notes.length}/500</span>
            </div>
          </div>

          {/* Live double-entry preview - shown on the form step so the user
              sees the exact accounts and DR/CR amounts before clicking Review. */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Journal entry preview</Label>
              <span
                className={
                  "text-[11px] inline-flex items-center gap-1 " +
                  (balanced ? "text-emerald-600" : "text-muted-foreground")
                }
              >
                {balanced ? (
                  <>
                    <CheckCircle2 className="h-3 w-3" /> Balanced
                  </>
                ) : (
                  <>Enter an amount to see ledger lines</>
                )}
              </span>
            </div>
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium">Account</th>
                    <th className="text-right px-2 py-1.5 font-medium w-24">Debit</th>
                    <th className="text-right px-2 py-1.5 font-medium w-24">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerRows.length > 0 ? (
                    <>
                      {ledgerRows.map((r, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-2 py-1.5">{r.account}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {r.debit > 0 ? formatCurrency(r.debit) : "-"}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {r.credit > 0 ? formatCurrency(r.credit) : "-"}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t bg-muted/30 font-medium">
                        <td className="px-2 py-1.5 text-right">Totals</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {formatCurrency(totalDebit)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {formatCurrency(totalCredit)}
                        </td>
                      </tr>
                    </>
                  ) : (
                    <>
                      <tr className="border-t text-muted-foreground">
                        <td className="px-2 py-1.5">1000 - Cash on Hand</td>
                        <td className="px-2 py-1.5 text-right">-</td>
                        <td className="px-2 py-1.5 text-right">-</td>
                      </tr>
                      <tr className="border-t text-muted-foreground">
                        <td className="px-2 py-1.5">6999 - Cash Over/Short</td>
                        <td className="px-2 py-1.5 text-right">-</td>
                        <td className="px-2 py-1.5 text-right">-</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
            {balanced && (
              <p className="text-[11px] text-muted-foreground">
                {isOverage ? (
                  <>
                    Overage: <strong>DR Cash on Hand</strong> /{" "}
                    <strong>CR Cash Over/Short</strong> - books recognize the extra cash.
                  </>
                ) : (
                  <>
                    Shortage: <strong>DR Cash Over/Short</strong> /{" "}
                    <strong>CR Cash on Hand</strong> - books recognize the missing cash.
                  </>
                )}
              </p>
            )}
          </div>

          <ReconciliationPreview />

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Posts a balanced journal entry between{" "}
              <strong>Cash on Hand (1000)</strong> and{" "}
              <strong>Cash Over/Short (6999)</strong>. Cannot be edited later - only voided by an admin.
            </AlertDescription>
          </Alert>
        </div>
        ) : (
        <div className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Business date</span>
              <span className="font-medium">{businessDate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type</span>
              <span className="font-medium">
                {isOverage ? "Overage (+)" : "Shortage (−)"} ·{" "}
                {formatCurrency(absAmount)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reason</span>
              <span className="font-medium">{activeRule.label}</span>
            </div>
          </div>

          <div>
            <Label className="text-xs">Journal entry preview</Label>
            <div className="mt-1 rounded-md border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium">Account</th>
                    <th className="text-right px-2 py-1.5 font-medium w-24">Debit</th>
                    <th className="text-right px-2 py-1.5 font-medium w-24">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerRows.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1.5">{r.account}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {r.debit > 0 ? formatCurrency(r.debit) : "-"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {r.credit > 0 ? formatCurrency(r.credit) : "-"}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t bg-muted/30 font-medium">
                    <td className="px-2 py-1.5 text-right">Totals</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatCurrency(totalDebit)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatCurrency(totalCredit)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p
              className={`mt-1.5 text-[11px] inline-flex items-center gap-1 ${
                balanced ? "text-emerald-600" : "text-destructive"
              }`}
            >
              <CheckCircle2 className="h-3 w-3" />
              {balanced
                ? "Balanced - debits equal credits"
                : "Out of balance - cannot post"}
            </p>
          </div>

          <ReconciliationPreview />

          <div>
            <Label className="text-xs">Variance note</Label>
            <div className="mt-1 rounded-md border bg-card p-2.5 text-xs whitespace-pre-wrap">
              {notes}
            </div>
          </div>

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Once posted this entry is <strong>immutable</strong>. To undo, an
              owner/manager must post a reversal from the adjustment history.
            </AlertDescription>
          </Alert>
        </div>
        )}
        </div>

        <DialogFooter role="group" aria-label="Adjustment dialog actions" className="shrink-0">
          {step === "form" ? (
            <>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
                aria-label="Cancel (Escape)"
                aria-keyshortcuts="Escape"
              >
                Cancel{" "}
                <span aria-hidden="true" className="ml-2 text-[10px] opacity-60">
                  Esc
                </span>
              </Button>
              <Button
                onClick={handleProceedToConfirm}
                disabled={!validation.success || isBlockedByExisting}
                aria-label="Review adjustment (Control or Command + Enter)"
                aria-keyshortcuts="Control+Enter Meta+Enter"
              >
                Review
                <ArrowRight aria-hidden="true" className="h-4 w-4 ml-2" />
                <span aria-hidden="true" className="ml-2 text-[10px] opacity-70">
                  ⌘↵
                </span>
              </Button>
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2 w-full">
              <Button
                variant="outline"
                onClick={() => setStep("form")}
                disabled={submitting}
                aria-label="Back to edit form"
              >
                <ArrowLeft aria-hidden="true" className="h-4 w-4 mr-2" />
                Back to edit
              </Button>
              <Button
                variant={onPostedAndCloseDay ? "outline" : "default"}
                onClick={() => setFinalCheck({ andCloseDay: false })}
                disabled={!balanced || submitting || isBlockedByExisting}
                aria-label="Confirm and post adjustment to ledger (Control or Command + Enter)"
                aria-keyshortcuts="Control+Enter Meta+Enter"
              >
                {submitting && (
                  <Loader2 aria-hidden="true" className="h-4 w-4 mr-2 animate-spin" />
                )}
                Confirm & Post
                <span aria-hidden="true" className="ml-2 text-[10px] opacity-70">
                  ⌘↵
                </span>
              </Button>
              {onPostedAndCloseDay && (
                <Button
                  onClick={() => setFinalCheck({ andCloseDay: true })}
                  disabled={!balanced || submitting || isBlockedByExisting}
                  className="gap-2"
                  aria-label="Post adjustment and close the day (Control or Command + Shift + Enter)"
                  aria-keyshortcuts="Control+Shift+Enter Meta+Shift+Enter"
                >
                  {submitting && (
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  )}
                  Post & Close Day
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  <span aria-hidden="true" className="ml-1 text-[10px] opacity-70">
                    ⌘⇧↵
                  </span>
                </Button>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
      <AlertDialog
        open={finalCheck !== null}
        onOpenChange={(o) => {
          if (!o && !submitting) setFinalCheck(null);
        }}
      >
        <AlertDialogContent className="sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-base">
              <Scale className="h-4 w-4 text-primary" />
              Final ledger check
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              You are about to post this entry to the ledger for{" "}
              <strong>{businessDate}</strong>. Once written it is immutable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left px-2 py-1.5 font-medium">Account</th>
                  <th className="text-right px-2 py-1.5 font-medium w-20">DR</th>
                  <th className="text-right px-2 py-1.5 font-medium w-20">CR</th>
                </tr>
              </thead>
              <tbody>
                {ledgerRows.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1.5">{r.account}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.debit > 0 ? formatCurrency(r.debit) : "-"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.credit > 0 ? formatCurrency(r.credit) : "-"}
                    </td>
                  </tr>
                ))}
                <tr className="border-t bg-muted/30 font-medium">
                  <td className="px-2 py-1.5 text-right">Totals</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatCurrency(totalDebit)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatCurrency(totalCredit)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p
            className={`text-[11px] inline-flex items-center gap-1 ${
              balanced ? "text-emerald-600" : "text-destructive"
            }`}
          >
            <CheckCircle2 className="h-3 w-3" />
            {balanced ? "Balanced - debits equal credits" : "Out of balance"}
          </p>
          {finalCheck?.andCloseDay && (
            <p className="text-[11px] text-muted-foreground">
              After posting, the day will be closed automatically. You'll have a
              short undo window.
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={!balanced || submitting}
              onClick={async (e) => {
                e.preventDefault();
                const andClose = !!finalCheck?.andCloseDay;
                await handleSubmit(andClose);
                setFinalCheck(null);
              }}
            >
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {finalCheck?.andCloseDay ? "Post & Close Day" : "Post now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reconciliation glossary - plain-language definitions of the totals
          shown in the preview panel. Nested Dialog is fine with Radix. */}
      <Dialog open={glossaryOpen} onOpenChange={setGlossaryOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reconciliation glossary</DialogTitle>
            <DialogDescription>
              Plain-language definitions of the totals used in the day-end
              reconciliation flow.
            </DialogDescription>
          </DialogHeader>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="font-medium">Recorded payment-type total</dt>
              <dd className="text-muted-foreground text-xs mt-0.5">
                Sum of cash + card + delivery + other payment amounts your team
                actually entered for the day. This is what your books currently
                show before any reconciliation.
              </dd>
            </div>
            <div>
              <dt className="font-medium">POS Reported total</dt>
              <dd className="text-muted-foreground text-xs mt-0.5">
                The total your POS system rang up for the day (the "Z-report"
                or end-of-day total). Treated as the source of truth for
                revenue.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Variance</dt>
              <dd className="text-muted-foreground text-xs mt-0.5">
                <span className="font-mono">POS Reported − Recorded</span>.
                Positive = cash overage (more counted than rung up). Negative =
                shortage (less counted than rung up).
              </dd>
            </div>
            <div>
              <dt className="font-medium">Day-end adjustment</dt>
              <dd className="text-muted-foreground text-xs mt-0.5">
                A balanced journal entry between Cash on Hand (1000) and Cash
                Over/Short (6999) that records the variance. It re-balances
                cash only - it does not change revenue.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Active adjustments (net)</dt>
              <dd className="text-muted-foreground text-xs mt-0.5">
                Sum of all unreversed adjustments already posted for this day
                and scope. Reversed entries cancel out and don't count.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Adjusted Total</dt>
              <dd className="text-muted-foreground text-xs mt-0.5">
                What the day's reconciled total becomes once your adjustment
                posts. When POS Reported is set, the Adjusted Total equals POS
                Reported. Otherwise it equals Recorded + net adjustment.
              </dd>
            </div>
          </dl>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGlossaryOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}