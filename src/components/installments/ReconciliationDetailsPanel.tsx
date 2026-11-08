import { CheckCircle2, HelpCircle, MinusCircle, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { InstallmentReconRow, ReconCheck } from "@/lib/installmentRecon";

const SOURCE_NOTE: Record<InstallmentReconRow["explanation"]["expectedSource"], string> = {
  partner_equity: "Partner capital record → resolved to its equity account",
  partner_equity_unlinked: "Partner capital record has no equity account linked",
  partner_no_capital_account: "Partner funding without a capital account selected",
  payment_account: "Bank/cash account selected on the payment",
  none: "No funding account recorded",
};

const iconFor = (status: ReconCheck["status"]) =>
  status === "pass" ? (
    <CheckCircle2 className="h-4 w-4 text-primary" />
  ) : status === "fail" ? (
    <XCircle className="h-4 w-4 text-destructive" />
  ) : (
    <MinusCircle className="h-4 w-4 text-muted-foreground" />
  );

function IdChip({ id }: { id: string | null }) {
  if (!id) return <span className="text-muted-foreground">—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <code className="block truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{id}</code>
      </TooltipTrigger>
      <TooltipContent>
        <span className="font-mono text-[11px]">{id}</span>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Explains, per installment, exactly which chart-of-accounts IDs were compared
 * and why the row is Matched or Not matched.
 */
export function ReconciliationDetailsPanel({ row }: { row: InstallmentReconRow }) {
  const e = row.explanation;
  const matched = row.matchStatus === "matched";

  return (
    <div className="space-y-3 rounded-md border bg-background/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="secondary"
          className={
            matched
              ? "bg-primary/15 text-primary"
              : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          }
        >
          {matched ? "Matched" : "Not matched"}
        </Badge>
        <p className="text-sm">{e.summary}</p>
      </div>

      {!e.mappingGuard.safe && e.mappingGuard.reason !== "not_resolved" && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          <p className="font-medium">Account comparison skipped (mapping guard)</p>
          <p className="text-muted-foreground">{e.mappingGuard.message}</p>
        </div>
      )}

      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <div className="space-y-1 rounded-md border p-2">
          <p className="text-muted-foreground">Expected credit account</p>
          <p className="font-medium">{e.expectedAccountLabel}</p>
          <IdChip id={e.expectedAccountId} />
          <p className="text-muted-foreground">{SOURCE_NOTE[e.expectedSource]}</p>
        </div>
        <div className="space-y-1 rounded-md border p-2">
          <p className="text-muted-foreground">Actually credited in ledger</p>
          <p className="font-medium">{e.actualAccountLabel}</p>
          <IdChip id={e.actualAccountId} />
          <p className="text-muted-foreground">First non-voided credit line of the batch</p>
        </div>
        <div className="space-y-1 rounded-md border p-2">
          <p className="flex items-center gap-1 text-muted-foreground">
            Stored funding reference
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3 w-3" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Partner payments store the partner capital record ID, not a chart-of-accounts ID. It is
                resolved to the partner&apos;s equity account before any comparison, so the raw ID is
                never matched against the ledger.
              </TooltipContent>
            </Tooltip>
          </p>
          <p className="font-medium capitalize">{row.funding_source}</p>
          <IdChip id={e.capitalAccountId} />
          <p className="text-muted-foreground">Not compared directly to the ledger</p>
        </div>
      </div>

      <div className="space-y-1.5">
        {e.checks.map((c) => (
          <div key={c.label} className="flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs">
            <span className="mt-0.5">{iconFor(c.status)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium">{c.label}</span>
                {c.status === "skipped" && (
                  <Badge variant="outline" className="text-[10px]">
                    not applicable
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 break-words text-muted-foreground">
                Expected: <span className="font-mono">{c.expected}</span> · Actual:{" "}
                <span className="font-mono">{c.actual}</span>
              </p>
              <p className="mt-0.5 text-muted-foreground">{c.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
