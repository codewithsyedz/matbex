import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";

export interface FineTimelineEvent {
  id: string;
  kind: "audit" | "lifecycle" | "payroll";
  action: string;
  at: string;
  actorName: string | null;
  oldStatus?: string | null;
  newStatus?: string | null;
  oldAmount?: number | null;
  newAmount?: number | null;
  reason?: string | null;
  detail?: string | null;
}

interface FineRow {
  id: string;
  amount: number;
  original_amount: number | null;
  status: string;
  created_by: string | null;
  created_at: string;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  applied_payroll_id: string | null;
  applied_at: string | null;
  rejection_reason: string | null;
  cancellation_reason: string | null;
}

export interface FineAuditTimeline {
  fine: FineRow | null;
  events: FineTimelineEvent[];
  payroll: {
    id: string;
    period_start: string | null;
    period_end: string | null;
    payment_date: string | null;
    gross_wage: number | null;
    fines_deducted: number | null;
    amount: number | null;
  } | null;
  originalAmount: number | null;
  currentAmount: number | null;
}

/**
 * Full provenance timeline for a single fine: creation, every audited
 * modification/approval step, amount changes with reasons, and the payroll
 * record it was finally applied to.
 */
export function useFineAuditTimeline(fineId?: string) {
  return useQuery<FineAuditTimeline>({
    queryKey: ["fine-audit-timeline", fineId],
    enabled: !!fineId,
    queryFn: async () => {
      const [{ data: fine }, { data: auditRows, error: auditError }] = await Promise.all([
        db
          .from("employee_fines")
          .select(
            "id, amount, original_amount, status, created_by, created_at, submitted_at, reviewed_by, reviewed_at, approved_by, approved_at, applied_payroll_id, applied_at, rejection_reason, cancellation_reason"
          )
          .eq("id", fineId!)
          .maybeSingle(),
        db
          .from("employee_fine_audit")
          .select("*")
          .eq("fine_id", fineId!)
          .order("created_at", { ascending: true }),
      ]);
      if (auditError) throw auditError;

      const f = (fine as FineRow | null) ?? null;
      const rows = (auditRows ?? []) as Record<string, unknown>[];

      // Resolve every actor involved in one round-trip.
      const actorIds = Array.from(
        new Set(
          [
            f?.created_by,
            f?.reviewed_by,
            f?.approved_by,
            ...rows.map((r) => r.actor_id as string | null),
          ].filter(Boolean) as string[]
        )
      );
      const nameById = new Map<string, string>();
      if (actorIds.length) {
        const { data: profiles } = await db
          .from("profiles")
          .select("id, full_name")
          .in("id", actorIds);
        (profiles ?? []).forEach((p) => nameById.set(p.id, p.full_name ?? "Unknown user"));
      }

      let payroll: FineAuditTimeline["payroll"] = null;
      if (f?.applied_payroll_id) {
        const { data: pr } = await db
          .from("payroll_records")
          .select("id, period_start, period_end, payment_date, gross_wage, fines_deducted, amount")
          .eq("id", f.applied_payroll_id)
          .maybeSingle();
        payroll = (pr as FineAuditTimeline["payroll"]) ?? null;
      }

      const events: FineTimelineEvent[] = [];

      if (f) {
        events.push({
          id: `${f.id}-created`,
          kind: "lifecycle",
          action: "Fine created",
          at: f.created_at,
          actorName: f.created_by ? nameById.get(f.created_by) ?? "Unknown user" : null,
          newStatus: "draft",
          newAmount: Number(f.original_amount ?? f.amount),
          detail: "Fine raised and recorded in the register",
        });
      }

      rows.forEach((r) => {
        const action = String(r.action ?? "updated").replace(/_/g, " ");
        events.push({
          id: String(r.id),
          kind: "audit",
          action: action.charAt(0).toUpperCase() + action.slice(1),
          at: String(r.created_at),
          actorName: r.actor_id ? nameById.get(String(r.actor_id)) ?? "Unknown user" : null,
          oldStatus: (r.old_status as string) ?? null,
          newStatus: (r.new_status as string) ?? null,
          oldAmount: r.old_amount != null ? Number(r.old_amount) : null,
          newAmount: r.new_amount != null ? Number(r.new_amount) : null,
          reason: (r.reason as string) ?? null,
        });
      });

      if (f?.applied_at) {
        events.push({
          id: `${f.id}-applied`,
          kind: "payroll",
          action: "Applied to payroll",
          at: f.applied_at,
          actorName: null,
          newStatus: "applied",
          newAmount: Number(f.amount),
          detail: payroll
            ? `Payroll period ${payroll.period_start ?? "—"} → ${payroll.period_end ?? "—"}`
            : "Linked payroll record",
        });
      }

      events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

      return {
        fine: f,
        events,
        payroll,
        originalAmount: f ? Number(f.original_amount ?? f.amount) : null,
        currentAmount: f ? Number(f.amount) : null,
      };
    },
  });
}