import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Info, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/toggle";
import { useCurrency } from "@/hooks/useCurrency";
import {
  useApSettlementPreview,
  type ApSettlementPreview,
  type PreviewLine,
  type PreviewLineKind,
} from "@/hooks/useApSettlementPreview";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<PreviewLineKind, string> = {
  original: "Original",
  correction: "Correction",
  adjustment: "Adjustment",
  planned: "New",
};

const KIND_CLASS: Record<PreviewLineKind, string> = {
  original: "border-muted text-muted-foreground",
  correction: "border-amber-500 text-amber-600 bg-amber-50",
  adjustment: "border-sky-500 text-sky-600 bg-sky-50",
  planned: "border-primary/40 text-primary",
};

function LineTable({
  lines,
  format,
  highlight,
  emptyLabel,
}: {
  lines: PreviewLine[];
  format: (n: number) => string;
  highlight?: boolean;
  emptyLabel: string;
}) {
  if (lines.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-3 px-2">{emptyLabel}</p>
    );
  }
  const totalDr = lines.reduce((s, l) => s + l.debit, 0);
  const totalCr = lines.reduce((s, l) => s + l.credit, 0);
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted-foreground">
          <th className="text-left font-medium py-1.5 px-2">Account</th>
          <th className="text-right font-medium py-1.5 px-2 w-24">Debit</th>
          <th className="text-right font-medium py-1.5 px-2 w-24">Credit</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr
            key={`${l.account_code}-${i}`}
            className={cn(
              "border-t border-border/60",
              highlight && "bg-primary/5"
            )}
          >
            <td className="py-1.5 px-2">
              <span className="font-mono text-[11px] text-muted-foreground mr-1.5">
                {l.account_code}
              </span>
              {l.account_name}
              {l.line_kind && l.line_kind !== "original" && l.line_kind !== "planned" && (
                <Badge
                  variant="outline"
                  className={cn("ml-1.5 text-[10px] py-0 px-1", KIND_CLASS[l.line_kind])}
                >
                  {KIND_LABEL[l.line_kind]}
                </Badge>
              )}
              {l.description ? (
                <span className="block text-[11px] text-muted-foreground">
                  {l.description}
                </span>
              ) : null}
            </td>
            <td className="py-1.5 px-2 text-right tabular-nums">
              {l.debit > 0 ? format(l.debit) : "—"}
            </td>
            <td className="py-1.5 px-2 text-right tabular-nums">
              {l.credit > 0 ? format(l.credit) : "—"}
            </td>
          </tr>
        ))}
        <tr className="border-t border-border font-medium">
          <td className="py-1.5 px-2 text-muted-foreground">Total</td>
          <td className="py-1.5 px-2 text-right tabular-nums">
            {format(totalDr)}
          </td>
          <td className="py-1.5 px-2 text-right tabular-nums">
            {format(totalCr)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function ApSettlementPreviewBody({
  preview,
  compact,
}: {
  preview: ApSettlementPreview;
  compact?: boolean;
}) {
  const { format } = useCurrency();
  const money = (n: number) => format(n);
  const [visibleKinds, setVisibleKinds] = useState<Record<PreviewLineKind, boolean>>({
    original: true,
    correction: true,
    adjustment: true,
    planned: true,
  });

  const availableKinds = useMemo(() => {
    const set = new Set<PreviewLineKind>();
    for (const l of preview.existing_lines) set.add(l.line_kind ?? "original");
    return (["original", "correction", "adjustment"] as PreviewLineKind[]).filter((k) =>
      set.has(k),
    );
  }, [preview.existing_lines]);

  const visibleExisting = useMemo(
    () => preview.existing_lines.filter((l) => visibleKinds[l.line_kind ?? "original"]),
    [preview.existing_lines, visibleKinds],
  );
  const hiddenCount = preview.existing_lines.length - visibleExisting.length;

  if (!preview.ok) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          {preview.message || "No settlement entry will be created."}
        </AlertDescription>
      </Alert>
    );
  }

  const after = [...visibleExisting, ...preview.planned_lines];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="text-[11px]">
          Open payable {money(preview.open_payable ?? 0)}
        </Badge>
        <Badge variant="outline" className="text-[11px]">
          Settlement {money(preview.amount)}
        </Badge>
        {preview.payment_method ? (
          <Badge variant="outline" className="text-[11px] capitalize">
            {preview.payment_method.replace("_", " ")}
          </Badge>
        ) : null}
      </div>

      {preview.warnings.map((w, i) => (
        <Alert
          key={i}
          variant={w.level === "error" ? "destructive" : "default"}
        >
          {w.level === "info" ? (
            <Info className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          <AlertDescription className="text-xs">{w.message}</AlertDescription>
        </Alert>
      ))}

      {availableKinds.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground mr-1">Show legs:</span>
          {availableKinds.map((k) => (
            <Toggle
              key={k}
              size="sm"
              variant="outline"
              pressed={visibleKinds[k]}
              onPressedChange={(v) =>
                setVisibleKinds((prev) => ({ ...prev, [k]: v }))
              }
              className="h-7 px-2 text-[11px]"
            >
              {KIND_LABEL[k]}
            </Toggle>
          ))}
          {hiddenCount > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {hiddenCount} leg{hiddenCount === 1 ? "" : "s"} hidden — totals below exclude them
            </span>
          )}
        </div>
      )}

      <div
        className={cn(
          "grid gap-3",
          compact ? "grid-cols-1" : "md:grid-cols-[1fr_auto_1fr]"
        )}
      >
        <div className="rounded-lg border bg-background overflow-hidden">
          <div className="px-2 py-1.5 border-b bg-muted/40 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Before — already posted
          </div>
          <LineTable
            lines={visibleExisting}
            format={money}
            emptyLabel="Nothing posted for this expense yet."
          />
        </div>

        {!compact && (
          <div className="hidden md:flex items-center justify-center">
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </div>
        )}

        <div className="rounded-lg border bg-background overflow-hidden">
          <div className="px-2 py-1.5 border-b bg-muted/40 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            After — including this settlement
          </div>
          <LineTable
            lines={after}
            format={money}
            emptyLabel="No change to the ledger."
          />
        </div>
      </div>

      {preview.planned_lines.length > 0 && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 overflow-hidden">
          <div className="px-2 py-1.5 border-b border-primary/20 text-[11px] font-medium uppercase tracking-wide text-primary">
            New settlement entry to be posted
          </div>
          <LineTable
            lines={preview.planned_lines}
            format={money}
            highlight
            emptyLabel=""
          />
        </div>
      )}
    </div>
  );
}

/**
 * Before/after DR-CR preview of the settlement entry that will be posted when
 * an unpaid supplier bill is marked as paid.
 */
export function ApSettlementPostingPreview({
  expenseId,
  enabled = true,
  compact,
}: {
  expenseId?: string | null;
  enabled?: boolean;
  compact?: boolean;
}) {
  const { data, isLoading, error } = useApSettlementPreview(expenseId, enabled);

  if (!enabled || !expenseId) return null;

  return (
    <div className="rounded-xl border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Posting preview</span>
        <span className="text-xs text-muted-foreground">
          What the ledger will look like after saving
        </span>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculating…
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Could not build the posting preview.
          </AlertDescription>
        </Alert>
      ) : data ? (
        <ApSettlementPreviewBody preview={data} compact={compact} />
      ) : null}
    </div>
  );
}

export default ApSettlementPostingPreview;
