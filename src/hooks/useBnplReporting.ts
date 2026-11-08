import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** Untyped client: installment tables are newer than the generated types. */
const db = supabase as any;

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

export const AGING_BUCKETS: { key: AgingBucket; label: string }[] = [
  { key: "current", label: "Not due" },
  { key: "d1_30", label: "1-30 days" },
  { key: "d31_60", label: "31-60 days" },
  { key: "d61_90", label: "61-90 days" },
  { key: "d90_plus", label: "90+ days" },
];

const emptyAging = (): Record<AgingBucket, number> => ({
  current: 0,
  d1_30: 0,
  d31_60: 0,
  d61_90: 0,
  d90_plus: 0,
});

export interface BnplGroupRow {
  key: string;
  provider: string;
  supplier: string;
  plans: number;
  activePlans: number;
  cashPrice: number;
  financeCharge: number;
  totalPayable: number;
  paid: number;
  outstanding: number;
  remainingInstallments: number;
  nextDueDate: string | null;
  overdue: number;
  aging: Record<AgingBucket, number>;
}

export interface BnplPlanRow extends BnplGroupRow {
  planId: string;
  description: string;
  branchId: string | null;
  purchaseDate: string;
  status: string;
  installmentCount: number;
  vatAmount: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const bucketFor = (dueDate: string, today: string): AgingBucket => {
  const days = Math.floor(
    (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${dueDate}T00:00:00Z`).getTime()) / 86400000,
  );
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
};

interface Args {
  branchId?: string | null;
  provider?: string;
  today?: string;
}

export function useBnplReporting({ branchId, provider = "all", today }: Args = {}) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const scope = branchId && branchId !== "all" ? branchId : null;
  const asOf = today ?? new Date().toISOString().slice(0, 10);

  return useQuery({
    queryKey: ["bnpl-reporting", tenantId, scope, provider, asOf],
    enabled: !!tenantId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      let planQ = db
        .from("installment_plans")
        .select(
          "id, branch_id, provider, supplier_name, description, purchase_date, status, cash_price, finance_charge, total_payable, installment_count, vat_amount",
        )
        .eq("tenant_id", tenantId);
      if (scope) planQ = planQ.eq("branch_id", scope);
      const { data: plans, error: planErr } = await planQ;
      if (planErr) throw planErr;

      const allPlans: any[] = plans ?? [];
      const providers = Array.from(new Set(allPlans.map((p) => p.provider).filter(Boolean))).sort() as string[];
      const planList: any[] = provider === "all" ? allPlans : allPlans.filter((p) => p.provider === provider);
      const planIds = planList.map((p) => p.id);

      let payments: any[] = [];
      if (planIds.length) {
        const { data: pays, error: payErr } = await db
          .from("installment_payments")
          .select("id, plan_id, installment_no, due_date, amount, paid_amount, paid_date, status, voided_at")
          .eq("tenant_id", tenantId)
          .in("plan_id", planIds);
        if (payErr) throw payErr;
        payments = pays ?? [];
      }

      const byPlan = new Map<string, any[]>();
      for (const p of payments) {
        if (p.voided_at) continue;
        const arr = byPlan.get(p.plan_id) ?? [];
        arr.push(p);
        byPlan.set(p.plan_id, arr);
      }

      const planRows: BnplPlanRow[] = planList.map((plan) => {
        const sched = (byPlan.get(plan.id) ?? []).sort((a, b) => a.installment_no - b.installment_no);
        const aging = emptyAging();
        let paid = 0;
        let outstanding = 0;
        let remaining = 0;
        let overdue = 0;
        let nextDue: string | null = null;

        for (const s of sched) {
          const due = Number(s.amount) || 0;
          const settled = Number(s.paid_amount) || 0;
          paid += settled;
          const open = round2(Math.max(due - settled, 0));
          if (s.status === "paid" || open <= 0) continue;
          outstanding += open;
          remaining += 1;
          const bucket = bucketFor(s.due_date, asOf);
          aging[bucket] += open;
          if (bucket !== "current") overdue += open;
          if (!nextDue || s.due_date < nextDue) nextDue = s.due_date;
        }

        return {
          key: plan.id,
          planId: plan.id,
          description: plan.description ?? "-",
          branchId: plan.branch_id ?? null,
          purchaseDate: plan.purchase_date,
          status: plan.status,
          provider: plan.provider ?? "Unknown",
          supplier: plan.supplier_name ?? "-",
          plans: 1,
          activePlans: outstanding > 0 ? 1 : 0,
          installmentCount: plan.installment_count ?? sched.length,
          cashPrice: Number(plan.cash_price) || 0,
          financeCharge: Number(plan.finance_charge) || 0,
          totalPayable: Number(plan.total_payable) || 0,
          vatAmount: Number(plan.vat_amount) || 0,
          paid: round2(paid),
          outstanding: round2(outstanding),
          remainingInstallments: remaining,
          nextDueDate: nextDue,
          overdue: round2(overdue),
          aging,
        };
      });

      const group = (rows: BnplPlanRow[], keyOf: (r: BnplPlanRow) => string) => {
        const map = new Map<string, BnplGroupRow>();
        for (const r of rows) {
          const k = keyOf(r);
          const g =
            map.get(k) ??
            ({
              key: k,
              provider: r.provider,
              supplier: r.supplier,
              plans: 0,
              activePlans: 0,
              cashPrice: 0,
              financeCharge: 0,
              totalPayable: 0,
              paid: 0,
              outstanding: 0,
              remainingInstallments: 0,
              nextDueDate: null,
              overdue: 0,
              aging: emptyAging(),
            } as BnplGroupRow);
          g.plans += 1;
          g.activePlans += r.activePlans;
          g.cashPrice = round2(g.cashPrice + r.cashPrice);
          g.financeCharge = round2(g.financeCharge + r.financeCharge);
          g.totalPayable = round2(g.totalPayable + r.totalPayable);
          g.paid = round2(g.paid + r.paid);
          g.outstanding = round2(g.outstanding + r.outstanding);
          g.overdue = round2(g.overdue + r.overdue);
          g.remainingInstallments += r.remainingInstallments;
          if (r.nextDueDate && (!g.nextDueDate || r.nextDueDate < g.nextDueDate)) g.nextDueDate = r.nextDueDate;
          for (const b of AGING_BUCKETS) g.aging[b.key] = round2(g.aging[b.key] + r.aging[b.key]);
          map.set(k, g);
        }
        return Array.from(map.values()).sort((a, b) => b.outstanding - a.outstanding);
      };

      const byProvider = group(planRows, (r) => r.provider);
      const bySupplier = group(planRows, (r) => `${r.provider}|||${r.supplier}`);

      const totals = planRows.reduce(
        (acc, r) => {
          acc.plans += 1;
          acc.activePlans += r.activePlans;
          acc.cashPrice = round2(acc.cashPrice + r.cashPrice);
          acc.financeCharge = round2(acc.financeCharge + r.financeCharge);
          acc.totalPayable = round2(acc.totalPayable + r.totalPayable);
          acc.paid = round2(acc.paid + r.paid);
          acc.outstanding = round2(acc.outstanding + r.outstanding);
          acc.overdue = round2(acc.overdue + r.overdue);
          acc.remainingInstallments += r.remainingInstallments;
          for (const b of AGING_BUCKETS) acc.aging[b.key] = round2(acc.aging[b.key] + r.aging[b.key]);
          return acc;
        },
        {
          plans: 0,
          activePlans: 0,
          cashPrice: 0,
          financeCharge: 0,
          totalPayable: 0,
          paid: 0,
          outstanding: 0,
          overdue: 0,
          remainingInstallments: 0,
          aging: emptyAging(),
        },
      );

      return { planRows, byProvider, bySupplier, totals, providers, asOf };
    },
  });
}
