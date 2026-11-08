import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Clock,
  Lock,
  Link2Off,
  Boxes,
  EyeOff,
  AlertTriangle,
  CircleDashed,
} from "lucide-react";
import type { ReasonCode } from "@/hooks/usePostingCenter";

const META: Record<
  string,
  { label: string; icon: any; className: string; tip: string }
> = {
  ready: {
    label: "Ready",
    icon: CheckCircle2,
    className: "border-success/40 text-success bg-success/10",
    tip: "Eligible to post immediately.",
  },
  pending_approval: {
    label: "Pending approval",
    icon: Clock,
    className: "border-warning/40 text-warning bg-warning/10",
    tip: "Expense must be approved before it can post to the ledger.",
  },
  period_locked: {
    label: "Period locked",
    icon: Lock,
    className: "border-border text-muted-foreground bg-muted/60",
    tip: "The fiscal period covering this expense is closed.",
  },
  missing_account: {
    label: "Missing account",
    icon: Link2Off,
    className: "border-warning/40 text-warning bg-warning/10",
    tip: "No Chart of Accounts mapping is set on this expense.",
  },
  cogs_routed: {
    label: "Blocked: COGS",
    icon: Boxes,
    className: "border-primary/40 text-primary bg-primary/10",
    tip: "COGS accounts must be posted via Inventory Purchase, not Expense.",
  },
  missing_branch_visibility: {
    label: "Hidden for branch",
    icon: EyeOff,
    className: "border-destructive/40 text-destructive bg-destructive/10",
    tip: "Account is restricted and not visible for this branch.",
  },
  validation_failed: {
    label: "Validation failed",
    icon: AlertTriangle,
    className: "border-destructive text-destructive bg-destructive/5",
    tip: "Posting attempted but the validation trigger rejected it.",
  },
  posted: {
    label: "Posted",
    icon: CheckCircle2,
    className: "border-success/40 text-success bg-success/10",
    tip: "Successfully posted to ledger.",
  },
  auto_reconciled: {
    label: "Auto-reconciled",
    icon: CheckCircle2,
    className: "border-success/40 text-success bg-success/10",
    tip: "Reconciliation inserted the missing leg.",
  },
  ambiguous_imbalance: {
    label: "Manual review",
    icon: AlertTriangle,
    className: "border-destructive/40 text-destructive bg-destructive/10",
    tip: "Could not be reconciled automatically.",
  },
};

const FALLBACK = {
  label: "Unknown",
  icon: CircleDashed,
  className: "border-muted text-muted-foreground",
  tip: "Unrecognized reason code.",
};

export function ReasonBadge({ code }: { code: ReasonCode }) {
  const m = META[code] ?? FALLBACK;
  const Icon = m.icon;
  return (
    <Badge
      variant="outline"
      className={`gap-1 ${m.className}`}
      title={m.tip}
    >
      <Icon className="h-3 w-3" />
      {m.label}
    </Badge>
  );
}

export function reasonLabel(code: ReasonCode) {
  return (META[code] ?? FALLBACK).label;
}