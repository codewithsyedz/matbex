import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Info,
  Receipt,
  Wallet,
  ArrowRightLeft,
  Ban,
  Undo2,
} from "lucide-react";

const SCENARIOS: {
  label: string;
  icon: any;
  lines: string[];
  apLine: "yes" | "no";
  note: string;
}[] = [
  {
    label: "Unpaid expense / credit purchase",
    icon: Receipt,
    lines: ["DR Expense or Inventory account", "CR 2000 Accounts Payable"],
    apLine: "yes",
    note: "A supplier balance is created because the bill is not yet paid.",
  },
  {
    label: "Paid by cash or bank",
    icon: Wallet,
    lines: ["DR Expense or Inventory account", "CR 1000 Cash on Hand / Bank"],
    apLine: "no",
    note: "No Accounts Payable line is posted because the bill was settled immediately.",
  },
  {
    label: "Settlement of an unpaid bill",
    icon: ArrowRightLeft,
    lines: ["DR 2000 Accounts Payable", "CR 1000 Cash on Hand / Bank"],
    apLine: "yes",
    note: "This reduces the supplier balance. The original expense line remains untouched.",
  },
  {
    label: "Voided transaction",
    icon: Ban,
    lines: ["Original line marked void", "Reversing entry created by system"],
    apLine: "no",
    note: "Voided lines are not counted in totals; the reversing entry appears as a new line.",
  },
  {
    label: "Payment reversal",
    icon: Undo2,
    lines: ["DR 1000 Cash on Hand / Bank", "CR 2000 Accounts Payable"],
    apLine: "yes",
    note: "Reopening a paid expense restores the liability with a new audit entry.",
  },
];

export function ApPostingBreakdownCard() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Info className="h-4 w-4" />
          Posting breakdown
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Why an Accounts Payable (AP) credit line appears — or does not appear
          — in the ledger.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {SCENARIOS.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="rounded-lg border bg-muted/20 p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {s.label}
                </p>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border ${
                    s.apLine === "yes"
                       ? "bg-warning/10 border-warning/30 text-warning"
                       : "bg-secondary border-border text-secondary-foreground"
                  }`}
                >
                  {s.apLine === "yes" ? "AP line shown" : "No AP line"}
                </span>
              </div>
              <ul className="text-xs font-mono space-y-0.5 text-muted-foreground">
                {s.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{s.note}</p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
