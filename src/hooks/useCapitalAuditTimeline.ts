import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const db = supabase as any;

export type CapitalTimelineKind = "account_opened" | "movement" | "reversal";

export interface CapitalTimelineEvent {
  id: string;
  kind: CapitalTimelineKind;
  at: string;
  movementId?: string;
  movementType?: "injection" | "withdrawal";
  movementDate?: string;
  amount?: number;
  reference?: string | null;
  description?: string | null;
  reason?: string | null;
  branchId?: string | null;
  batchId?: string | null;
  actorId?: string | null;
  actorName?: string;
}

/** Full, unfiltered audit history for one owner capital account. */
export function useCapitalAuditTimeline(capitalAccountId?: string | null) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;

  return useQuery({
    queryKey: ["capital-audit-timeline", tenantId, capitalAccountId],
    enabled: Boolean(tenantId && capitalAccountId),
    staleTime: 60_000,
    queryFn: async (): Promise<CapitalTimelineEvent[]> => {
      const [{ data: account }, { data: movements }] = await Promise.all([
        db
          .from("owner_capital_accounts")
          .select("id, partner_name, bank_name, account_last4, branch_id, opening_balance, created_at")
          .eq("id", capitalAccountId)
          .maybeSingle(),
        db
          .from("capital_movements")
          .select(
            "id, movement_type, movement_date, amount, reference_number, description, batch_id, branch_id, is_reversed, reversed_at, reversed_by, reversal_reason, created_by, created_at",
          )
          .eq("capital_account_id", capitalAccountId)
          .order("created_at", { ascending: true }),
      ]);

      const rows = (movements ?? []) as any[];

      const actorIds = Array.from(
        new Set(
          rows
            .flatMap((m) => [m.created_by, m.reversed_by])
            .filter((v): v is string => Boolean(v)),
        ),
      );

      let names: Record<string, string> = {};
      if (actorIds.length) {
        const { data: profiles } = await db
          .from("profiles")
          .select("id, full_name")
          .in("id", actorIds);
        names = Object.fromEntries(
          ((profiles ?? []) as any[]).map((p) => [p.id, p.full_name ?? "Unknown user"]),
        );
      }

      const events: CapitalTimelineEvent[] = [];

      if (account) {
        events.push({
          id: `open-${account.id}`,
          kind: "account_opened",
          at: account.created_at,
          amount: Number(account.opening_balance ?? 0),
          branchId: account.branch_id,
          description: `${account.partner_name} · ${account.bank_name} ••${account.account_last4}`,
        });
      }

      for (const m of rows) {
        events.push({
          id: `mv-${m.id}`,
          kind: "movement",
          at: m.created_at,
          movementId: m.id,
          movementType: m.movement_type,
          movementDate: m.movement_date,
          amount: Number(m.amount ?? 0),
          reference: m.reference_number,
          description: m.description,
          branchId: m.branch_id,
          batchId: m.batch_id,
          actorId: m.created_by,
          actorName: m.created_by ? names[m.created_by] ?? "Unknown user" : "System",
        });

        if (m.is_reversed) {
          events.push({
            id: `rv-${m.id}`,
            kind: "reversal",
            at: m.reversed_at ?? m.updated_at ?? m.created_at,
            movementId: m.id,
            movementType: m.movement_type,
            movementDate: m.movement_date,
            amount: Number(m.amount ?? 0),
            reference: m.reference_number,
            reason: m.reversal_reason,
            branchId: m.branch_id,
            batchId: m.batch_id,
            actorId: m.reversed_by,
            actorName: m.reversed_by ? names[m.reversed_by] ?? "Unknown user" : "System",
          });
        }
      }

      return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    },
  });
}
