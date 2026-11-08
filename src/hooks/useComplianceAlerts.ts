import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { toast } from "sonner";

export type ComplianceAlertKind = "overdue_action" | "repeat_violation" | "approval_pending";
export type ComplianceAlertSeverity = "critical" | "high" | "medium";

export const COMPLIANCE_ALERT_KIND_LABELS: Record<ComplianceAlertKind, string> = {
  overdue_action: "Overdue corrective action",
  repeat_violation: "Repeated violation",
  approval_pending: "Approval pending",
};

export interface ComplianceAlert {
  key: string;
  kind: ComplianceAlertKind;
  severity: ComplianceAlertSeverity;
  title: string;
  description: string;
  branchId: string | null;
  branchName: string | null;
  entityId: string | null;
  /** ISO date the alert refers to (due date / run date / last occurrence). */
  occurredAt: string;
  /** Days past due, when applicable. */
  ageDays: number | null;
  ack?: ComplianceAlertAck | null;
}

export interface ComplianceAlertAck {
  id: string;
  alert_key: string;
  note: string | null;
  acknowledged_by: string;
  acknowledged_at: string;
}

const OPEN_STATUSES = ["identified", "assigned", "action_required", "completed", "verified"];
const REPEAT_LOOKBACK_DAYS = 90;
const REPEAT_THRESHOLD = 2;

function daysBetween(from: string, to: Date) {
  const d = new Date(`${from}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((to.getTime() - d.getTime()) / 86_400_000);
}

interface ViolationRow {
  id: string;
  branch_id: string;
  violation_number: string | null;
  violation_date: string;
  status: string;
  is_overdue: boolean;
  is_municipality_fine: boolean;
  corrective_action_due_date: string | null;
  corrective_action_required: string | null;
  violation_type_id: string | null;
  description: string | null;
  branch?: { id: string; name: string } | null;
  violation_type?: { id: string; name_en: string; severity: string } | null;
  responsible_staff?: { id: string; name: string } | null;
}

interface RunRow {
  id: string;
  branch_id: string;
  run_date: string;
  completed_at: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  branch?: { id: string; name: string } | null;
  template?: { id: string; name: string | null } | null;
}

/**
 * Derives the compliance alert inbox from live compliance data:
 *  - overdue corrective actions
 *  - repeated violations of the same type in a branch
 *  - checklist runs and violations waiting for review / approval
 * Acknowledgements are persisted in `compliance_alert_acks`.
 */
export function useComplianceAlerts() {
  const { restaurant, profile } = useAuth();
  const { activeBranchId, pinnedBranchId } = useBranch();
  const qc = useQueryClient();
  const rid = restaurant?.id;
  const branchId = pinnedBranchId ?? activeBranchId ?? null;

  const lookbackFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - REPEAT_LOOKBACK_DAYS);
    return d.toISOString().slice(0, 10);
  }, []);

  const violationsQ = useQuery({
    queryKey: ["compliance-alerts", "violations", rid, branchId, lookbackFrom],
    queryFn: async () => {
      let q = supabase
        .from("compliance_violations")
        .select(
          `id,branch_id,violation_number,violation_date,status,is_overdue,is_municipality_fine,
           corrective_action_due_date,corrective_action_required,violation_type_id,description,
           branch:branches(id,name),
           violation_type:compliance_violation_types(id,name_en,severity),
           responsible_staff:staff!compliance_violations_responsible_staff_id_fkey(id,name)`,
        )
        .eq("restaurant_id", rid!)
        .is("deleted_at", null)
        .gte("violation_date", lookbackFrom)
        .order("violation_date", { ascending: false });
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ViolationRow[];
    },
    enabled: !!rid,
  });

  const runsQ = useQuery({
    queryKey: ["compliance-alerts", "runs", rid, branchId, lookbackFrom],
    queryFn: async () => {
      let q = supabase
        .from("compliance_checklist_runs")
        .select(
          `id,branch_id,run_date,completed_at,reviewed_at,approved_at,
           branch:branches(id,name),
           template:compliance_checklist_templates(id,name)`,
        )
        .eq("restaurant_id", rid!)
        .gte("run_date", lookbackFrom)
        .is("approved_at", null)
        .not("completed_at", "is", null)
        .order("run_date", { ascending: false });
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as RunRow[];
    },
    enabled: !!rid,
  });

  const acksQ = useQuery({
    queryKey: ["compliance-alert-acks", rid],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compliance_alert_acks")
        .select("id,alert_key,note,acknowledged_by,acknowledged_at")
        .eq("restaurant_id", rid!);
      if (error) throw error;
      return (data ?? []) as ComplianceAlertAck[];
    },
    enabled: !!rid,
  });

  const alerts = useMemo<ComplianceAlert[]>(() => {
    const today = new Date();
    const violations = violationsQ.data ?? [];
    const runs = runsQ.data ?? [];
    const ackByKey = new Map((acksQ.data ?? []).map((a) => [a.alert_key, a]));
    const out: ComplianceAlert[] = [];

    // 1. Overdue corrective actions
    for (const v of violations) {
      if (!OPEN_STATUSES.includes(v.status)) continue;
      const due = v.corrective_action_due_date;
      const overdue = v.is_overdue || (!!due && (daysBetween(due, today) ?? 0) > 0);
      if (!overdue) continue;
      const age = due ? daysBetween(due, today) : null;
      out.push({
        key: `overdue:${v.id}`,
        kind: "overdue_action",
        severity: (age ?? 0) > 7 ? "critical" : "high",
        title: `${v.violation_number ?? "Violation"} — corrective action overdue`,
        description:
          v.corrective_action_required?.trim() ||
          v.description?.trim() ||
          v.violation_type?.name_en ||
          "Corrective action past its due date",
        branchId: v.branch_id,
        branchName: v.branch?.name ?? null,
        entityId: v.id,
        occurredAt: due ?? v.violation_date,
        ageDays: age,
        ack: ackByKey.get(`overdue:${v.id}`) ?? null,
      });
    }

    // 2. Repeated violations (same type, same branch, within lookback)
    const groups = new Map<string, ViolationRow[]>();
    for (const v of violations) {
      if (!v.violation_type_id) continue;
      const k = `${v.branch_id}|${v.violation_type_id}`;
      groups.set(k, [...(groups.get(k) ?? []), v]);
    }
    for (const [k, rows] of groups) {
      if (rows.length < REPEAT_THRESHOLD) continue;
      const latest = rows[0];
      out.push({
        key: `repeat:${k}:${latest.id}`,
        kind: "repeat_violation",
        severity: rows.length >= 3 ? "critical" : "high",
        title: `${rows.length}× ${latest.violation_type?.name_en ?? "violation"} in ${REPEAT_LOOKBACK_DAYS} days`,
        description: `Repeated at ${latest.branch?.name ?? "this branch"} — last on ${latest.violation_date}. Review the root cause and escalate per policy.`,
        branchId: latest.branch_id,
        branchName: latest.branch?.name ?? null,
        entityId: latest.id,
        occurredAt: latest.violation_date,
        ageDays: daysBetween(latest.violation_date, today),
        ack: ackByKey.get(`repeat:${k}:${latest.id}`) ?? null,
      });
    }

    // 3a. Violations awaiting supervisor verification / closure
    for (const v of violations) {
      if (v.status !== "completed" && v.status !== "verified") continue;
      const stage = v.status === "completed" ? "supervisor verification" : "final closure";
      out.push({
        key: `approval:violation:${v.id}:${v.status}`,
        kind: "approval_pending",
        severity: "medium",
        title: `${v.violation_number ?? "Violation"} awaiting ${stage}`,
        description:
          v.description?.trim() || v.violation_type?.name_en || "Corrective action submitted, pending sign-off",
        branchId: v.branch_id,
        branchName: v.branch?.name ?? null,
        entityId: v.id,
        occurredAt: v.violation_date,
        ageDays: daysBetween(v.violation_date, today),
        ack: ackByKey.get(`approval:violation:${v.id}:${v.status}`) ?? null,
      });
    }

    // 3b. Checklist runs awaiting review or manager approval
    for (const r of runs) {
      const stage = r.reviewed_at ? "manager approval" : "supervisor review";
      const age = daysBetween(r.run_date, today);
      out.push({
        key: `approval:checklist:${r.id}:${r.reviewed_at ? "approve" : "review"}`,
        kind: "approval_pending",
        severity: (age ?? 0) > 2 ? "high" : "medium",
        title: `${r.template?.name ?? "Daily checklist"} awaiting ${stage}`,
        description: `Run of ${r.run_date} at ${r.branch?.name ?? "this branch"} was completed but not yet signed off.`,
        branchId: r.branch_id,
        branchName: r.branch?.name ?? null,
        entityId: r.id,
        occurredAt: r.run_date,
        ageDays: age,
        ack: ackByKey.get(`approval:checklist:${r.id}:${r.reviewed_at ? "approve" : "review"}`) ?? null,
      });
    }

    const rank: Record<ComplianceAlertSeverity, number> = { critical: 0, high: 1, medium: 2 };
    return out.sort(
      (a, b) => rank[a.severity] - rank[b.severity] || b.occurredAt.localeCompare(a.occurredAt),
    );
  }, [violationsQ.data, runsQ.data, acksQ.data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["compliance-alert-acks"] });

  const acknowledge = useMutation({
    mutationFn: async ({ alert, note }: { alert: ComplianceAlert; note?: string }) => {
      const { error } = await supabase.from("compliance_alert_acks").insert({
        restaurant_id: rid!,
        branch_id: alert.branchId,
        alert_key: alert.key,
        alert_kind: alert.kind,
        entity_id: alert.entityId,
        note: note?.trim() || null,
        acknowledged_by: profile?.id ?? undefined,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Alert acknowledged");
    },
    onError: (e: Error) => toast.error("Could not acknowledge alert", { description: e.message }),
  });

  const acknowledgeMany = useMutation({
    mutationFn: async (list: ComplianceAlert[]) => {
      const rows = list
        .filter((a) => !a.ack)
        .map((a) => ({
          restaurant_id: rid!,
          branch_id: a.branchId,
          alert_key: a.key,
          alert_kind: a.kind,
          entity_id: a.entityId,
          acknowledged_by: profile?.id ?? undefined,
        }));
      if (!rows.length) return;
      const { error } = await supabase.from("compliance_alert_acks").insert(rows as never);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Alerts acknowledged");
    },
    onError: (e: Error) => toast.error("Could not acknowledge alerts", { description: e.message }),
  });

  const undoAcknowledge = useMutation({
    mutationFn: async (ackId: string) => {
      const { error } = await supabase.from("compliance_alert_acks").delete().eq("id", ackId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Acknowledgement removed");
    },
    onError: (e: Error) => toast.error("Could not undo", { description: e.message }),
  });

  return {
    alerts,
    unacknowledged: alerts.filter((a) => !a.ack),
    isLoading: violationsQ.isLoading || runsQ.isLoading || acksQ.isLoading,
    acknowledge,
    acknowledgeMany,
    undoAcknowledge,
  };
}