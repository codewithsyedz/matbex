import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";

interface Props {
  /** Ledger line ids of the reversal legs to show audit records for. */
  reversalTransactionIds: string[];
  enabled?: boolean;
}

interface AuditRow {
  id: string;
  created_at: string;
  entity_id: string | null;
  old_data: Record<string, any> | null;
  new_data: Record<string, any> | null;
}

/**
 * Renders the REVERSAL_POSTED audit entries written by the database trigger:
 * which original ledger line each reversal linked to and the mirrored DR/CR
 * mapping that satisfied the linkage validator.
 */
export function ReversalAuditLogCard({ reversalTransactionIds, enabled = true }: Props) {
  const { format: money } = useCurrency();
  const ids = reversalTransactionIds.filter(Boolean);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["reversal-audit-log", ids.slice().sort().join(",")],
    queryFn: async () => {
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, created_at, entity_id, old_data, new_data")
        .eq("action", "REVERSAL_POSTED")
        .in("entity_id", ids)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as AuditRow[];
    },
    enabled: enabled && ids.length > 0,
  });

  if (!enabled || ids.length === 0) return null;
  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (rows.length === 0) return null;

  const short = (v?: string | null) => (v ? `${v.slice(0, 8)}…` : "—");

  return (
    <div className="mt-4 space-y-2">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <ShieldCheck className="h-4 w-4" />
        Reversal audit log
      </p>
      <div className="space-y-2">
        {rows.map((r) => {
          const o = r.old_data ?? {};
          const n = r.new_data ?? {};
          return (
            <div key={r.id} className="rounded-md border p-3 text-xs space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono">
                  {n.account_code ?? "—"} {n.account_name ?? ""}
                </Badge>
                <Badge variant="secondary">{n.mirror_mapping ?? "—"}</Badge>
                <Badge variant={n.mirror_balanced ? "default" : "destructive"}>
                  {n.mirror_balanced ? "Mirror validated" : "Mirror mismatch"}
                </Badge>
                <span className="text-muted-foreground">
                  {new Date(r.created_at).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              </div>
              <p className="text-muted-foreground">
                Linked original line <span className="font-mono">{short(o.original_transaction_id)}</span>{" "}
                ({o.original_side ?? "—"} {money(Number(o.original_debit || o.original_credit || 0))}
                {o.original_reference_type ? ` · ${o.original_reference_type}` : ""}) → reversal line{" "}
                <span className="font-mono">{short(n.reversal_transaction_id)}</span> ({n.reversal_side ?? "—"}{" "}
                {money(Number(n.mirror_amount || 0))}).
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
