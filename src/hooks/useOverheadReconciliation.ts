import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** Untyped client helper for the daily-overhead / ledger tables. */
const db = supabase as any;

export type ReconStatus = "matched" | "unposted" | "missing_gl" | "amount_mismatch" | "unbalanced" | "voided";

export interface ReconLine {
  account_id: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  is_voided: boolean;
}

export interface ReconRow {
  closure_id: string;
  business_date: string;
  branch_id: string | null;
  branch_name: string;
  status: string;
  gl_reference: string;
  batch_id: string | null;
  allocated: number;
  glDebit: number;
  glCredit: number;
  difference: number;
  expenseDebit: number;
  accrualCredit: number;
  lines: ReconLine[];
  reconStatus: ReconStatus;
  issues: string[];
}

export interface OrphanBatch {
  reference_id: string | null;
  batch_id: string | null;
  transaction_date: string;
  debit: number;
  credit: number;
  description: string | null;
}

interface Args {
  branchId?: string | null;
  periodStart: string;
  periodEnd: string;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function useOverheadReconciliation({ branchId, periodStart, periodEnd }: Args) {
  const { restaurant } = useAuth();
  const restaurantId = restaurant?.id;
  const scope = branchId && branchId !== "all" ? branchId : null;

  return useQuery({
    queryKey: ["overhead-reconciliation", restaurantId, scope, periodStart, periodEnd],
    enabled: !!restaurantId && !!periodStart && !!periodEnd,
    staleTime: 60 * 1000,
    queryFn: async () => {
      // 1. Closures in period
      let cq = db
        .from("daily_overhead_closures")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .gte("business_date", periodStart)
        .lte("business_date", periodEnd)
        .order("business_date", { ascending: false });
      if (scope) cq = cq.eq("branch_id", scope);
      const { data: closures, error: cErr } = await cq;
      if (cErr) throw cErr;
      const rows = (closures || []) as any[];

      const closureIds = rows.map(r => r.id);

      // 2. GL lines tagged as daily_overhead for the same window
      let tq = db
        .from("account_transactions")
        .select("id, account_id, batch_id, reference_id, transaction_date, debit, credit, description, is_voided, branch_id")
        .eq("reference_type", "daily_overhead")
        .gte("transaction_date", periodStart)
        .lte("transaction_date", periodEnd);
      if (scope) tq = tq.eq("branch_id", scope);
      const { data: txns, error: tErr } = await tq;
      if (tErr) throw tErr;
      const lines = (txns || []) as any[];

      // 3. Account metadata
      const accountIds = Array.from(new Set(lines.map(l => l.account_id).filter(Boolean)));
      let accounts: Record<string, { code: string; name: string; type: string }> = {};
      if (accountIds.length) {
        const { data: accs } = await db
          .from("chart_of_accounts")
          .select("id, account_code, account_name, account_type")
          .in("id", accountIds);
        for (const a of accs || []) {
          accounts[a.id] = { code: a.account_code, name: a.account_name, type: a.account_type };
        }
      }

      // 4. Branch names
      const branchIds = Array.from(new Set(rows.map(r => r.branch_id).filter(Boolean)));
      let branches: Record<string, string> = {};
      if (branchIds.length) {
        const { data: bs } = await db.from("branches").select("id, name").in("id", branchIds);
        for (const b of bs || []) branches[b.id] = b.name;
      }

      const byClosure = new Map<string, any[]>();
      for (const l of lines) {
        const key = l.reference_id ?? "__orphan__";
        if (!byClosure.has(key)) byClosure.set(key, []);
        byClosure.get(key)!.push(l);
      }

      const result: ReconRow[] = rows.map(r => {
        const raw = byClosure.get(r.id) || [];
        const mapped: ReconLine[] = raw.map(l => ({
          account_id: l.account_id,
          code: accounts[l.account_id]?.code ?? "—",
          name: accounts[l.account_id]?.name ?? "Unknown account",
          type: accounts[l.account_id]?.type ?? "unknown",
          debit: Number(l.debit || 0),
          credit: Number(l.credit || 0),
          is_voided: !!l.is_voided,
        }));
        const live = mapped.filter(l => !l.is_voided);
        const glDebit = round2(live.reduce((s, l) => s + l.debit, 0));
        const glCredit = round2(live.reduce((s, l) => s + l.credit, 0));
        const allocated = round2(Number(r.overhead_amount || 0));
        const expenseDebit = round2(
          live.filter(l => ["expense", "cogs"].includes(l.type)).reduce((s, l) => s + l.debit, 0)
        );
        const accrualCredit = round2(
          live.filter(l => l.type === "liability").reduce((s, l) => s + l.credit, 0)
        );
        const isPosted = ["posted", "adjusted"].includes(r.status);

        const issues: string[] = [];
        let reconStatus: ReconStatus = "matched";

        if (!isPosted) {
          reconStatus = "unposted";
          issues.push(
            r.status === "posting_failed"
              ? `GL posting failed: ${r.posting_error || "unknown error"}`
              : `Day is ${r.status} — not yet in the ledger`
          );
        } else if (live.length === 0) {
          reconStatus = "missing_gl";
          issues.push("Marked as posted but no live GL lines were found (all voided or deleted)");
        } else {
          if (round2(Math.abs(glDebit - glCredit)) > 0.009) {
            reconStatus = "unbalanced";
            issues.push(`GL batch is out of balance by ${round2(glDebit - glCredit)}`);
          }
          if (round2(Math.abs(glDebit - allocated)) > 0.009) {
            reconStatus = "amount_mismatch";
            issues.push(`Allocation ${allocated} ≠ GL debit ${glDebit}`);
          }
          if (expenseDebit === 0) issues.push("No expense-account debit found for this allocation");
          if (accrualCredit === 0) issues.push("No liability/accrual credit found for this allocation");
          if (round2(Math.abs(expenseDebit - accrualCredit)) > 0.009 && expenseDebit && accrualCredit) {
            issues.push(`Expense debit ${expenseDebit} ≠ accrual credit ${accrualCredit}`);
          }
          if (mapped.some(l => l.is_voided)) issues.push("Contains voided GL lines");
          if (issues.length && reconStatus === "matched") reconStatus = "amount_mismatch";
        }

        return {
          closure_id: r.id,
          business_date: r.business_date,
          branch_id: r.branch_id,
          branch_name: r.branch_id ? branches[r.branch_id] ?? "Unknown branch" : "Tenant-wide",
          status: r.status,
          gl_reference: r.gl_reference,
          batch_id: r.batch_id,
          allocated,
          glDebit,
          glCredit,
          difference: round2(allocated - glDebit),
          expenseDebit,
          accrualCredit,
          lines: mapped,
          reconStatus,
          issues,
        };
      });

      // Orphans: overhead GL lines with no matching closure in this window
      const knownIds = new Set(closureIds);
      const orphans: OrphanBatch[] = lines
        .filter(l => !l.is_voided && (!l.reference_id || !knownIds.has(l.reference_id)))
        .map(l => ({
          reference_id: l.reference_id ?? null,
          batch_id: l.batch_id ?? null,
          transaction_date: l.transaction_date,
          debit: Number(l.debit || 0),
          credit: Number(l.credit || 0),
          description: l.description ?? null,
        }));

      const totals = {
        allocated: round2(result.reduce((s, r) => s + r.allocated, 0)),
        glDebit: round2(result.reduce((s, r) => s + r.glDebit, 0)),
        glCredit: round2(result.reduce((s, r) => s + r.glCredit, 0)),
        expenseDebit: round2(result.reduce((s, r) => s + r.expenseDebit, 0)),
        accrualCredit: round2(result.reduce((s, r) => s + r.accrualCredit, 0)),
        days: result.length,
        discrepancies: result.filter(r => r.reconStatus !== "matched").length,
      };

      return { rows: result, orphans, totals };
    },
  });
}
