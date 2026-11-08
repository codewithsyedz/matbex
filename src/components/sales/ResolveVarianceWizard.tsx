import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Lock,
  Loader2,
  Scale,
  SkipForward,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DAY_END_REASONS,
  DayEndAdjustmentDialog,
} from "@/components/dayend/DayEndAdjustmentDialog";
import {
  useVarianceNoteTemplates,
  renderTemplateBody,
} from "@/hooks/useVarianceNoteTemplates";
import { VarianceTemplateManagerDialog } from "./VarianceTemplateManagerDialog";
import { Bookmark, Plus, Star } from "lucide-react";
import { useVarianceTemplateUsage } from "@/hooks/useVarianceTemplateUsage";

/** Matches [placeholder] tokens. Excludes already-filled ones with no brackets. */
const PLACEHOLDER_REGEX = /\[([^\[\]\n]{1,60}?)\]/g;

function findPlaceholders(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  PLACEHOLDER_REGEX.lastIndex = 0;
  while ((m = PLACEHOLDER_REGEX.exec(text)) !== null) {
    out.push(m[0]);
  }
  return out;
}

/** Render a non-editable highlighted mirror of the note text. */
function HighlightedNotePreview({ text }: { text: string }) {
  if (!text) return null;
  const parts: Array<{ kind: "text" | "ph"; value: string }> = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  PLACEHOLDER_REGEX.lastIndex = 0;
  while ((m = PLACEHOLDER_REGEX.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ kind: "text", value: text.slice(lastIndex, m.index) });
    }
    parts.push({ kind: "ph", value: m[0] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ kind: "text", value: text.slice(lastIndex) });
  }
  return (
    <div className="rounded-md border border-dashed bg-muted/30 px-2.5 py-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
      {parts.map((p, i) =>
        p.kind === "ph" ? (
          <mark
            key={i}
            className="rounded px-1 py-0.5 bg-amber-200/80 text-amber-900 font-medium ring-1 ring-amber-400/60"
          >
            {p.value}
          </mark>
        ) : (
          <span key={i}>{p.value}</span>
        )
      )}
    </div>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variance: number;
  formatCurrency: (n: number) => string;
  businessDate: string;
  dailySalesId: string | null;
  initialNotes?: string;
  isSubmitting?: boolean;
  onConfirm: (composedNotes: string, meta: { reason: string; adjustmentId: string | null }) => void | Promise<void>;
  /** When true, the user must log a Day-End Adjustment - Skip is hidden and Confirm requires `logged`. */
  requireAdjustment?: boolean;
}

type AdjustmentChoice = "pending" | "logged" | "skipped";

const STEP_LABELS = ["Reason", "Adjustment", "Notes & Confirm"] as const;

interface NoteTemplate {
  id: string;
  label: string;
  /** Reason values from DAY_END_REASONS for which this template is most relevant. */
  reasons?: string[];
  build: (ctx: { variance: number; formatCurrency: (n: number) => string }) => string;
}

const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: "missing_receipt",
    label: "Missing receipt(s)",
    reasons: ["missing_receipt"],
    build: ({ variance, formatCurrency }) =>
      `Missing receipt(s) account for ${formatCurrency(Math.abs(variance))} ${variance < 0 ? "shortage" : "overage"}. Vendor/invoice ref: [add ref]. Will recover and re-enter on next reconciliation.`,
  },
  {
    id: "cash_short",
    label: "Cash drawer short",
    reasons: ["cash_miscount"],
    build: ({ variance, formatCurrency }) =>
      `Cash drawer short by ${formatCurrency(Math.abs(variance))} after recount. Cashier: [name]. Denominations checked; no large bills missing. Reviewed by manager.`,
  },
  {
    id: "card_batch_mismatch",
    label: "Card refund batch mismatch",
    reasons: ["refund_not_recorded"],
    build: ({ variance, formatCurrency }) =>
      `Card refund batch mismatch of ${formatCurrency(Math.abs(variance))}. Refund processed on terminal but not yet reflected in POS batch. Reconciled against acquirer settlement report.`,
  },
  {
    id: "printer_skipped",
    label: "POS printer skipped receipts",
    build: ({ variance, formatCurrency }) =>
      `POS printer skipped receipts during peak service. Approx ${formatCurrency(Math.abs(variance))} of orders were served without a printed receipt. Order log cross-checked with kitchen tickets.`,
  },
  {
    id: "delivery_sync",
    label: "Delivery platform sync delay",
    reasons: ["delivery_sync_delay"],
    build: ({ variance, formatCurrency }) =>
      `Delivery platform [HungerStation/Jahez/...] orders delayed in sync. ${formatCurrency(Math.abs(variance))} ${variance < 0 ? "missing" : "extra"}. Will reconcile against next platform statement.`,
  },
];

export function ResolveVarianceWizard({
  open,
  onOpenChange,
  variance,
  formatCurrency,
  businessDate,
  dailySalesId,
  initialNotes = "",
  isSubmitting = false,
  onConfirm,
  requireAdjustment = false,
}: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [reason, setReason] = useState<string>("");
  const [adjustmentChoice, setAdjustmentChoice] = useState<AdjustmentChoice>("pending");
  const [adjustmentId, setAdjustmentId] = useState<string | null>(null);
  const [notes, setNotes] = useState(initialNotes);
  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const { templates: customTemplates } = useVarianceNoteTemplates();
  const { recordUsage, getCount } = useVarianceTemplateUsage();

  // Reset on close
  useEffect(() => {
    if (!open && !isSubmitting) {
      const t = setTimeout(() => {
        setStepIndex(0);
        setReason("");
        setAdjustmentChoice("pending");
        setAdjustmentId(null);
        setNotes(initialNotes);
      }, 200);
      return () => clearTimeout(t);
    }
  }, [open, isSubmitting, initialNotes]);

  const reasonDef = useMemo(
    () => DAY_END_REASONS.find((r) => r.value === reason),
    [reason]
  );
  const minNotes = reasonDef?.minNotes ?? 15;

  // Sort: reason-matched first, then by usage count desc, then by original order
  const orderedTemplates = useMemo(() => {
    const indexed = NOTE_TEMPLATES.map((t, i) => ({ t, i }));
    return indexed
      .sort((a, b) => {
        const aMatch = !!reason && a.t.reasons?.includes(reason) ? 1 : 0;
        const bMatch = !!reason && b.t.reasons?.includes(reason) ? 1 : 0;
        if (aMatch !== bMatch) return bMatch - aMatch;
        const aUse = getCount(`builtin:${a.t.id}`);
        const bUse = getCount(`builtin:${b.t.id}`);
        if (aUse !== bUse) return bUse - aUse;
        return a.i - b.i;
      })
      .map((x) => x.t);
  }, [reason, getCount]);

  const orderedCustomTemplates = useMemo(() => {
    return [...customTemplates].sort((a, b) => {
      const aMatch = !!reason && a.reason === reason ? 1 : 0;
      const bMatch = !!reason && b.reason === reason ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      const aUse = getCount(`custom:${a.id}`);
      const bUse = getCount(`custom:${b.id}`);
      if (aUse !== bUse) return bUse - aUse;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
  }, [customTemplates, reason, getCount]);

  const topBuiltInKey = useMemo(() => {
    let best: { key: string; count: number } | null = null;
    for (const t of NOTE_TEMPLATES) {
      const c = getCount(`builtin:${t.id}`);
      if (c > 0 && (!best || c > best.count)) best = { key: t.id, count: c };
    }
    return best?.key ?? null;
  }, [getCount]);

  const topCustomKey = useMemo(() => {
    let best: { key: string; count: number } | null = null;
    for (const t of customTemplates) {
      const c = getCount(`custom:${t.id}`);
      if (c > 0 && (!best || c > best.count)) best = { key: t.id, count: c };
    }
    return best?.key ?? null;
  }, [customTemplates, getCount]);

  const applyTemplate = (tpl: NoteTemplate) => {
    const body = tpl.build({ variance, formatCurrency });
    setNotes(body);
    recordUsage.mutate({
      templateKey: `builtin:${tpl.id}`,
      varianceAmount: variance,
      dailySalesId: dailySalesId ?? null,
      businessDate: businessDate ?? null,
      notesSnapshot: body,
    });
  };

  const applyCustomTemplate = (id: string, body: string) => {
    const rendered = renderTemplateBody(body, { variance, formatCurrency, businessDate });
    setNotes(rendered);
    recordUsage.mutate({
      templateKey: `custom:${id}`,
      varianceAmount: variance,
      dailySalesId: dailySalesId ?? null,
      businessDate: businessDate ?? null,
      notesSnapshot: rendered,
    });
  };

  const stepValid = useMemo(() => {
    if (stepIndex === 0) return !!reason;
    if (stepIndex === 1) {
      if (requireAdjustment) return adjustmentChoice === "logged";
      return adjustmentChoice !== "pending";
    }
    if (stepIndex === 2) {
      if (notes.trim().length < minNotes) return false;
      if (findPlaceholders(notes).length > 0) return false;
      return true;
    }
    return false;
  }, [stepIndex, reason, adjustmentChoice, notes, minNotes, requireAdjustment]);

  const unfilledPlaceholders = useMemo(() => findPlaceholders(notes), [notes]);

  const composedNote = useMemo(() => {
    const lines: string[] = [];
    lines.push(
      `Variance: ${formatCurrency(variance)} (${variance >= 0 ? "over" : "short"})`
    );
    if (reasonDef) lines.push(`Reason: ${reasonDef.label}`);
    lines.push(
      adjustmentChoice === "logged"
        ? `Day-End Adjustment posted${adjustmentId ? ` (${adjustmentId.slice(0, 8)})` : ""}`
        : "No Day-End Adjustment posted (explanation only)"
    );
    if (notes.trim()) lines.push(`Note: ${notes.trim()}`);
    return lines.join("\n");
  }, [variance, reasonDef, adjustmentChoice, adjustmentId, notes, formatCurrency]);

  const handleConfirm = async () => {
    await onConfirm(composedNote, { reason, adjustmentId });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !isSubmitting && onOpenChange(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Resolve Variance
            </DialogTitle>
            <DialogDescription>
              Pick a reason, optionally log a Day-End Adjustment, then add a note to
              close the day.
            </DialogDescription>
          </DialogHeader>

          {/* Progress */}
          <div className="flex items-center gap-1.5 pt-1">
            {STEP_LABELS.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  i < stepIndex && "bg-primary",
                  i === stepIndex && "bg-primary/70",
                  i > stepIndex && "bg-muted"
                )}
              />
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <h3 className="text-sm font-medium">{STEP_LABELS[stepIndex]}</h3>
            <Badge variant="outline" className="text-[10px]">
              Variance {formatCurrency(Math.abs(variance))}{" "}
              {variance >= 0 ? "over" : "short"}
            </Badge>
          </div>

          {/* Step 0 - Reason */}
          {stepIndex === 0 && (
            <ScrollArea className="max-h-[320px] pr-2">
              <div className="space-y-2">
                {DAY_END_REASONS.map((r) => {
                  const checked = reason === r.value;
                  return (
                    <label
                      key={r.value}
                      className={cn(
                        "flex flex-col gap-1 rounded-md border p-3 text-sm cursor-pointer transition-colors",
                        checked
                          ? "border-primary bg-primary/5"
                          : "border-input hover:bg-accent/40"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          className="accent-primary"
                          checked={checked}
                          onChange={() => setReason(r.value)}
                        />
                        <span className="font-medium">{r.label}</span>
                      </div>
                      <p className="text-xs text-muted-foreground pl-6">{r.hint}</p>
                    </label>
                  );
                })}
              </div>
            </ScrollArea>
          )}

          {/* Step 1 - Adjustment */}
          {stepIndex === 1 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {requireAdjustment
                  ? "Restaurant policy requires a Day-End Adjustment to close days with variance."
                  : "A Day-End Adjustment posts a balancing entry to the ledger. Skip if this variance is purely informational."}
              </p>

              <button
                type="button"
                onClick={() => setAdjustmentDialogOpen(true)}
                disabled={!dailySalesId}
                className={cn(
                  "w-full rounded-md border p-3 text-left transition-colors",
                  adjustmentChoice === "logged"
                    ? "border-primary bg-primary/5"
                    : "border-input hover:bg-accent/40",
                  !dailySalesId && "opacity-60 cursor-not-allowed"
                )}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Scale className="h-4 w-4" />
                  Log Day-End Adjustment
                  {adjustmentChoice === "logged" && (
                    <Badge variant="secondary" className="ml-auto gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Posted
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Opens the adjustment dialog pre-filled with the variance amount.
                </p>
              </button>

              {!requireAdjustment && (
                <button
                  type="button"
                  onClick={() => {
                    setAdjustmentChoice("skipped");
                    setAdjustmentId(null);
                  }}
                  className={cn(
                    "w-full rounded-md border p-3 text-left transition-colors",
                    adjustmentChoice === "skipped"
                      ? "border-primary bg-primary/5"
                      : "border-input hover:bg-accent/40"
                  )}
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <SkipForward className="h-4 w-4" />
                    Skip - explanation only
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    No ledger entry. The variance is recorded with your written note.
                  </p>
                </button>
              )}
            </div>
          )}

          {/* Step 2 - Notes & Review */}
          {stepIndex === 2 && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 text-primary" />
                  Quick templates
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {orderedTemplates.map((tpl) => {
                    const recommended = !!reason && tpl.reasons?.includes(reason);
                    const isTop = tpl.id === topBuiltInKey;
                    return (
                      <Button
                        key={tpl.id}
                        type="button"
                        size="sm"
                        variant={recommended ? "default" : "outline"}
                        onClick={() => applyTemplate(tpl)}
                        className="h-7 px-2.5 text-xs gap-1"
                        title={isTop ? "Your most-used template" : undefined}
                      >
                        {isTop && (
                          <Star className="h-3 w-3 fill-amber-400 text-amber-500" />
                        )}
                        {tpl.label}
                      </Button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Click to insert. Edit the bracketed placeholders before confirming.
                </p>
                <div className="pt-2 border-t border-dashed">
                  <div className="flex items-center justify-between mb-1.5">
                    <Label className="text-xs flex items-center gap-1.5">
                      <Bookmark className="h-3 w-3 text-primary" />
                      My templates
                      <span className="text-muted-foreground font-normal">
                        ({orderedCustomTemplates.length})
                      </span>
                    </Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setTemplateManagerOpen(true)}
                      className="h-6 px-2 text-[10px] gap-1"
                    >
                      <Plus className="h-3 w-3" />
                      {orderedCustomTemplates.length === 0 ? "Create" : "Manage"}
                    </Button>
                  </div>
                  {orderedCustomTemplates.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {orderedCustomTemplates.map((tpl) => {
                        const recommended = !!reason && tpl.reason === reason;
                        const isTop = tpl.id === topCustomKey;
                        return (
                          <Button
                            key={tpl.id}
                            type="button"
                            size="sm"
                            variant={recommended ? "default" : "outline"}
                            onClick={() => applyCustomTemplate(tpl.id, tpl.body)}
                            className="h-7 px-2.5 text-xs gap-1"
                            title={isTop ? `Your most-used template - ${tpl.body}` : tpl.body}
                          >
                            {isTop && (
                              <Star className="h-3 w-3 fill-amber-400 text-amber-500" />
                            )}
                            {tpl.label}
                          </Button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground italic">
                      Save your own templates with placeholders for repeat scenarios.
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Variance note <span className="text-destructive">*</span>
                  <span className="text-muted-foreground ml-1">
                    (min {minNotes} chars)
                  </span>
                </Label>
                <Textarea
                  placeholder={reasonDef?.hint ?? "Explain the variance..."}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className={cn(
                    unfilledPlaceholders.length > 0 &&
                      "border-amber-400 focus-visible:ring-amber-400/50"
                  )}
                />
                <div className="text-[10px] text-muted-foreground text-right">
                  {notes.trim().length}/{minNotes}
                </div>
                {unfilledPlaceholders.length > 0 && (
                  <div className="space-y-1.5">
                    <HighlightedNotePreview text={notes} />
                    <Alert className="border-amber-400/60 bg-amber-50/60 py-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <AlertTitle className="text-xs text-amber-900">
                        Fill in {unfilledPlaceholders.length} placeholder
                        {unfilledPlaceholders.length === 1 ? "" : "s"} before
                        closing
                      </AlertTitle>
                      <AlertDescription>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {Array.from(new Set(unfilledPlaceholders)).map((p) => (
                            <span
                              key={p}
                              className="rounded bg-amber-200/80 text-amber-900 px-1.5 py-0.5 text-[10px] font-mono"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                        <p className="text-[10px] text-amber-900/80 mt-1.5">
                          Replace each highlighted token with the actual value
                          (e.g. cashier name, invoice ref).
                        </p>
                      </AlertDescription>
                    </Alert>
                  </div>
                )}
              </div>
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle className="text-xs">Will be saved as:</AlertTitle>
                <AlertDescription>
                  <pre className="whitespace-pre-wrap text-[11px] leading-relaxed font-mono mt-1">
                    {composedNote}
                  </pre>
                </AlertDescription>
              </Alert>
            </div>
          )}

          <DialogFooter className="flex !justify-between gap-2 sm:!justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              disabled={stepIndex === 0 || isSubmitting}
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            {stepIndex < STEP_LABELS.length - 1 ? (
              <Button
                size="sm"
                onClick={() => setStepIndex((i) => i + 1)}
                disabled={!stepValid}
              >
                Next
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleConfirm}
                disabled={!stepValid || isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Lock className="h-4 w-4" />
                )}
                Confirm & Close Day
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {dailySalesId && (
        <DayEndAdjustmentDialog
          open={adjustmentDialogOpen}
          onOpenChange={setAdjustmentDialogOpen}
          scope="daily_sales"
          scopeRefId={dailySalesId}
          businessDate={businessDate}
          defaultAmount={variance || undefined}
          title="Day-End Adjustment - Resolve Variance"
          onPosted={(id) => {
            setAdjustmentId(id);
            setAdjustmentChoice("logged");
            setAdjustmentDialogOpen(false);
          }}
        />
      )}

      <VarianceTemplateManagerDialog
        open={templateManagerOpen}
        onOpenChange={setTemplateManagerOpen}
      />
    </>
  );
}