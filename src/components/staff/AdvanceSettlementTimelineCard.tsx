import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrency } from "@/hooks/useCurrency";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildAdvanceSettlementTimeline,
  timelineFinalBalance,
  type TimelineAdvance,
  type TimelineLeg,
  type SettlementTimelineEvent,
} from "@/lib/advanceSettlementTimeline";
import {
  PlusCircle,
  Receipt,
  Banknote,
  CheckCircle2,
  Gift,
  RotateCcw,
  FileClock,
} from "lucide-react";

interface Props {
  advanceId: string | null;
  /** Optional pre-loaded records to avoid duplicate fetches. */
  advance?: TimelineAdvance | null;
  legs?: TimelineLeg[];
  enabled?: boolean;
}

const iconFor = (kind: SettlementTimelineEvent["kind"]) => {
  switch (kind) {
    case "recorded":
      return PlusCircle;
    case "posted":
      return Receipt;
    case "repayment":
      return Banknote;
    case "deduction":
      return CheckCircle2;
    case "forgiven":
      return Gift;
    case "reversal":
      return RotateCcw;
    default:
      return FileClock;
  }
};

const toneFor = (kind: SettlementTimelineEvent["kind"]) => {
  switch (kind) {
    case "repayment":
    case "posted":
    case "deduction":
      return "text-green-600 bg-green-500/10";
    case "reversal":
      return "text-destructive bg-destructive/10";
    case "forgiven":
    case "audit":
      return "text-muted-foreground bg-muted";
    default:
      return "text-primary bg-primary/10";
  }
};

export function AdvanceSettlementTimelineCard({
  advanceId,
  advance: advanceProp,
  legs: legsProp,
  enabled = true,
}: Props) {
  const { format: money } = useCurrency();
  const on = enabled && !!advanceId;

  const { data: fetchedAdvance } = useQuery({
    queryKey: ["advance-timeline-advance", advanceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_advances")
        .select(
          "id, amount, status, created_at, updated_at, advance_date, deducted_at, ledger_reversed, ledger_reversed_at, ledger_reversal_reason, staff:staff_id(name)",
        )
        .eq("id", advanceId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as TimelineAdvance | null;
    },
    enabled: on && !advanceProp,
  });

  const { data: repayments = [], isLoading: loadingRepayments } = useQuery({
    queryKey: ["advance-timeline-repayments", advanceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_advance_repayments")
        .select("id, amount, repayment_date, source, notes, created_at, ledger_transaction_id")
        .eq("advance_id", advanceId!)
        .order("repayment_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: on,
  });

  const { data: fetchedLegs = [] } = useQuery({
    queryKey: ["advance-timeline-legs", advanceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_transactions")
        .select("id, created_at, reference_type, debit, credit, is_voided")
        .in("reference_type", [
          "staff_advance",
          "staff_advance_reversal",
          "staff_advance_repayment",
          "advance_deduction",
        ])
        .eq("reference_id", advanceId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as TimelineLeg[];
    },
    enabled: on && !legsProp,
  });

  const { data: auditLogs = [] } = useQuery({
    queryKey: ["advance-timeline-audit", advanceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, action, created_at, new_data")
        .eq("entity_id", advanceId!)
        .order("created_at", { ascending: true });
      if (error) return [];
      return data ?? [];
    },
    enabled: on,
  });

  const advance = advanceProp ?? fetchedAdvance ?? null;
  const legs = legsProp ?? fetchedLegs;

  const events = buildAdvanceSettlementTimeline({
    advance,
    repayments: repayments as never,
    legs,
    auditLogs: auditLogs as never,
  });
  const remaining = timelineFinalBalance(events);

  if (!on) return null;
  if (loadingRepayments && !events.length) return <Skeleton className="h-32 w-full" />;
  if (!events.length) return null;

  return (
    <div className="rounded-md border p-3">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium">Settlement history</p>
        <Badge variant={remaining <= 0 ? "default" : "secondary"}>
          {remaining <= 0 ? "Fully settled" : `${money(remaining)} still due`}
        </Badge>
      </div>
      <ol className="relative space-y-4 border-l pl-6">
        {events.map((ev) => {
          const Icon = iconFor(ev.kind);
          return (
            <li key={ev.id} className="relative">
              <span
                className={`absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full ${toneFor(ev.kind)}`}
              >
                <Icon className="h-3 w-3" />
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{ev.title}</p>
                {typeof ev.delta === "number" && ev.delta !== 0 && (
                  <span
                    className={`text-xs font-medium ${ev.delta < 0 ? "text-green-600" : "text-foreground"}`}
                  >
                    {ev.delta < 0 ? "−" : "+"}
                    {money(Math.abs(ev.delta))}
                  </span>
                )}
                {ev.ledgerLinked && (
                  <Badge variant="outline" className="text-[10px]">
                    Ledger
                  </Badge>
                )}
              </div>
              {ev.detail && <p className="text-xs text-muted-foreground">{ev.detail}</p>}
              <p className="text-xs text-muted-foreground">
                {ev.at ? new Date(ev.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—"}
                {typeof ev.balance === "number" && ` · Balance ${money(ev.balance)}`}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default AdvanceSettlementTimelineCard;
