import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle, Gift, HandCoins, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  deriveAdvanceSettlement,
  settlementBadgeClass,
  type AdvanceSettlementInput,
} from "@/lib/staffAdvanceSettlement";

const ICONS = {
  outstanding: Clock,
  partially_paid: HandCoins,
  paid: CheckCircle,
  forgiven: Gift,
  reversed: Undo2,
} as const;

interface Props {
  advance: AdvanceSettlementInput;
  className?: string;
}

/** Single, shared status pill for a staff advance's settlement state. */
export function AdvanceSettlementBadge({ advance, className }: Props) {
  const settlement = deriveAdvanceSettlement(advance);
  const Icon = ICONS[settlement.status];

  return (
    <Badge
      variant="outline"
      className={cn("gap-1", settlementBadgeClass(settlement.status), className)}
    >
      <Icon className="h-3 w-3" />
      {settlement.label}
    </Badge>
  );
}
