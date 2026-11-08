import { Check, Circle, ArrowRight, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface ExpenseClosureChecklistProps {
  /** Current payment status of the expense being edited. */
  status: "paid" | "unpaid";
  /** Whether the original expense entry has already reached the ledger. */
  ledgerPosted?: boolean;
  /** Amount already paid against the bill. */
  paidAmount?: number;
  /** Total value of the bill. */
  totalAmount?: number;
  /** True when the current user may mark expenses as paid / reverse settlements. */
  canSettle?: boolean;
}

type Step = {
  key: string;
  title: string;
  detail: string;
  done: boolean;
};

/**
 * Small guided checklist rendered inside the expense closure flow. It shows
 * the operator exactly which step is still required before the AP settlement
 * (DR 2000 Accounts Payable · CR Cash/Bank) and its reversal counterpart can
 * be generated.
 */
export function ExpenseClosureChecklist({
  status,
  ledgerPosted = false,
  paidAmount = 0,
  totalAmount = 0,
  canSettle = true,
}: ExpenseClosureChecklistProps) {
  const outstanding = Math.max(0, totalAmount - paidAmount);
  const fullySettled = status === "paid" || (totalAmount > 0 && outstanding === 0);

  const steps: Step[] = [
    {
      key: "recorded",
      title: "Expense recorded",
      detail: "DR expense / inventory account for the bill amount.",
      done: true,
    },
    {
      key: "payable",
      title: "Accounts Payable created",
      detail: ledgerPosted
        ? "CR 2000 Accounts Payable posted — supplier balance is open."
        : "CR 2000 Accounts Payable posts when this unpaid entry reaches the ledger.",
      done: ledgerPosted,
    },
    {
      key: "settle",
      title: "Mark as Paid to settle",
      detail: canSettle
        ? "Generates settlement entry DR 2000 Accounts Payable · CR Cash / Bank."
        : "An accountant or manager must review and mark this bill paid.",
      done: fullySettled,
    },
    {
      key: "reversal",
      title: "Reversal available after settlement",
      detail:
        "Switching a settled bill back to Unpaid posts DR Cash / Bank · CR 2000 Accounts Payable (approval required).",
      done: false,
    },
  ];

  const nextStep = steps.find((s) => !s.done);

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">Closure checklist</p>
        {nextStep && (
          <Badge
            variant="outline"
            className="gap-1 border-primary/40 text-primary text-[10px]"
          >
            <ArrowRight className="h-3 w-3" />
            Next: {nextStep.title}
          </Badge>
        )}
      </div>

      <ol className="space-y-2">
        {steps.map((step) => {
          const isNext = nextStep?.key === step.key;
          return (
            <li key={step.key} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0">
                {step.done ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : isNext && !canSettle && step.key === "settle" ? (
                  <Lock className="h-3.5 w-3.5 text-amber-600" />
                ) : (
                  <Circle
                    className={`h-3.5 w-3.5 ${isNext ? "text-primary" : "text-muted-foreground/50"}`}
                  />
                )}
              </span>
              <div className="space-y-0.5">
                <p
                  className={`text-xs leading-tight ${
                    step.done
                      ? "text-muted-foreground line-through"
                      : isNext
                        ? "font-medium"
                        : "text-muted-foreground"
                  }`}
                >
                  {step.title}
                </p>
                <p className="text-[10px] leading-tight text-muted-foreground">
                  {step.detail}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {outstanding > 0 && totalAmount > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Outstanding payable:{" "}
          <strong className="text-foreground tabular-nums">
            {outstanding.toFixed(2)}
          </strong>{" "}
          — the settlement entry will post for the amount paid.
        </p>
      )}
    </div>
  );
}
