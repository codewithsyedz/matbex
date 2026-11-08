import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

import type { IntegrityResult } from "@/lib/installmentIntegrity";

const ICONS = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
} as const;

const TONE = {
  ok: "text-success",
  warn: "text-warning",
  error: "text-destructive",
} as const;

export function InstallmentIntegrityChecklist({ result }: { result: IntegrityResult }) {
  return (
    <div
      className={`rounded-lg border p-3 space-y-2 ${
        result.hasErrors ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/30"
      }`}
    >
      <p className="text-sm font-medium">
        {result.hasErrors
          ? "Cannot save — ledger, asset register and schedule disagree"
          : "Ledger, asset register and schedule agree"}
      </p>
      {result.checks.map((c) => {
        const Icon = ICONS[c.status];
        return (
          <div key={c.id} className="flex gap-2">
            <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${TONE[c.status]}`} />
            <div className="min-w-0">
              <p className="text-xs font-medium">{c.label}</p>
              <p className="text-[11px] text-muted-foreground break-words">{c.detail}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
