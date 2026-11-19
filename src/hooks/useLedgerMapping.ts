import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";

export type TriggerEvent = "creation" | "payment" | "reversal" | "other";
export type LegRole = "expense" | "inventory" | "ap" | "cash" | "bank" | "other";

export interface MappedLeg {
  id: string;
  accountCode: string;
  accountName: string;
  role: LegRole;
  debit: number;
  credit: number;
  date: string;
  isVoided: boolean;
}

export interface MappedEvent {
  key: string;
  trigger: TriggerEvent;
  triggerLabel: string;
  reference: string | null;
  date: string;
  legs: MappedLeg[];
  debit: number;
  credit: number;
  balanced: boolean;
  allVoided: boolean;
}

export interface LedgerMappingRow {
  expenseId: string;
  description: string;
  amount: number;
  expenseDate: string;
  status: string;
  paymentMethod: string | null;
  branchId: string | null;
  branchName: string | null;
  supplierName: string | null;
  categoryName: string | null;
  events: MappedEvent[];
  /** Settlement route derived from the posted legs. */
  route: "cash" | "ap" | "ap_settled" | "unposted";
  routeLabel: string;
  apBilled: number;
  apSettled: number;
  apOpen: number;
  cashPaid: number;
  posted: boolean;
  balanced: boolean;
}

const triggerFor = (reference: string | null): { trigger: TriggerEvent; label: string } => {
  const ref = reference ?? "";
  if (ref.startsWith("EXPPAYREV-")) return { trigger: "reversal", label: "Payment reversal" };
  if (ref.startsWith("EXPPAY-")) return { trigger: "payment", label: "Payment / settlement" };
  if (ref.startsWith("EXP-")) return { trigger: "creation", label: "Expense creation" };
  return { trigger: "other", label: "Other ledger event" };
};

const roleFor = (code: string, name: string): LegRole => {
  if (code.startsWith("2000")) return "ap";
  if (code.startsWith("1000")) return "cash";
  if (code.startsWith("1010") || /bank/i.test(name)) return "bank";
  if (code.startsWith("12")) return "inventory";
  if (code.startsWith("5") || code.startsWith("6")) return "expense";
  return "other";
};

interface Args {
  from: Date;
  to: Date;
  branchId?: string | null;
}

export function useLedgerMapping({ from, to, branchId }: Args) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const fromKey = format(from, "yyyy-MM-dd");
  const toKey = format(to, "yyyy-MM-dd");
  const branchKey = branchId && branchId !== "all" ? branchId : null;

  const query = useQuery({
    queryKey: ["ledger-mapping", tenantId, fromKey, toKey, branchKey],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 2,
    queryFn: async (): Promise<LedgerMappingRow[]> => {
      let expQ = db
        .from("expenses")
        .select(
          "id, description, amount, expense_date, status, payment_method, branch_id, supplier_id, category_id",
        )
        .eq("tenant_id", tenantId!)
        .is("deleted_at", null)
        .gte("expense_date", fromKey)
        .lte("expense_date", toKey);
      if (branchKey) expQ = expQ.eq("branch_id", branchKey);
      const { data: expenses, error } = await expQ
        .order("expense_date", { ascending: false })
        .limit(500);
      if (error) throw error;
      const rows = expenses ?? [];
      if (rows.length === 0) return [];

      const ids = rows.map((r: any) => r.id);
      const supplierIds = Array.from(new Set(rows.map((r: any) => r.supplier_id).filter(Boolean)));
      const categoryIds = Array.from(new Set(rows.map((r: any) => r.category_id).filter(Boolean)));

      const [legsRes, suppliersRes, categoriesRes, branchesRes, accountsRes] = await Promise.all([
        db
          .from("account_transactions")
          .select(
            "id, account_id, batch_id, reference_id, transaction_date, debit, credit, is_voided, created_at",
          )
          .eq("tenant_id", tenantId!)
          .eq("reference_type", "expense")
          .in("reference_id", ids)
          .order("transaction_date", { ascending: true }),
        supplierIds.length
          ? db.from("suppliers").select("id, name").in("id", supplierIds)
          : Promise.resolve({ data: [] } as any),
        categoryIds.length
          ? db.from("expense_categories").select("id, name").in("id", categoryIds)
          : Promise.resolve({ data: [] } as any),
        db.from("branches").select("id, name"),
        db
          .from("chart_of_accounts")
          .select("id, account_code, account_name")
          .eq("tenant_id", tenantId!),
      ]);

      const legs = (legsRes.data ?? []) as any[];
      const batchIds = Array.from(new Set(legs.map((l) => l.batch_id).filter(Boolean)));
      const batchesRes = batchIds.length
        ? await db
            .from("journal_entry_batches")
            .select("id, reference_number, entry_type, batch_date")
            .in("id", batchIds)
        : ({ data: [] } as any);

      const accounts: Record<string, { code: string; name: string }> = {};
      (accountsRes.data ?? []).forEach((a: any) => {
        accounts[a.id] = { code: a.account_code ?? "", name: a.account_name ?? "" };
      });
      const batches: Record<string, any> = {};
      (batchesRes.data ?? []).forEach((b: any) => (batches[b.id] = b));
      const suppliers: Record<string, string> = {};
      (suppliersRes.data ?? []).forEach((s: any) => (suppliers[s.id] = s.name));
      const categories: Record<string, string> = {};
      (categoriesRes.data ?? []).forEach((c: any) => (categories[c.id] = c.name));
      const branchNames: Record<string, string> = {};
      (branchesRes.data ?? []).forEach((b: any) => (branchNames[b.id] = b.name));

      const legsByExpense = new Map<string, any[]>();
      legs.forEach((l) => {
        const arr = legsByExpense.get(l.reference_id) ?? [];
        arr.push(l);
        legsByExpense.set(l.reference_id, arr);
      });

      return rows.map((exp: any) => {
        const own = legsByExpense.get(exp.id) ?? [];
        const groups = new Map<string, any[]>();
        own.forEach((l) => {
          const key = l.batch_id ?? `leg-${l.id}`;
          const arr = groups.get(key) ?? [];
          arr.push(l);
          groups.set(key, arr);
        });

        const events: MappedEvent[] = Array.from(groups.entries())
          .map(([key, groupLegs]) => {
            const batch = batches[key];
            const { trigger, label } = triggerFor(batch?.reference_number ?? null);
            const mapped: MappedLeg[] = groupLegs.map((l) => {
              const acc = accounts[l.account_id] ?? { code: "", name: "Unmapped account" };
              return {
                id: l.id,
                accountCode: acc.code,
                accountName: acc.name,
                role: roleFor(acc.code, acc.name),
                debit: Number(l.debit) || 0,
                credit: Number(l.credit) || 0,
                date: l.transaction_date,
                isVoided: !!l.is_voided,
              };
            });
            const active = mapped.filter((l) => !l.isVoided);
            const debit = active.reduce((s, l) => s + l.debit, 0);
            const credit = active.reduce((s, l) => s + l.credit, 0);
            return {
              key,
              trigger,
              triggerLabel: label,
              reference: batch?.reference_number ?? null,
              date: groupLegs[0]?.transaction_date ?? batch?.batch_date ?? exp.expense_date,
              legs: mapped,
              debit,
              credit,
              balanced: Math.abs(debit - credit) < 0.005,
              allVoided: mapped.length > 0 && mapped.every((l) => l.isVoided),
            };
          })
          .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

        const activeLegs = events.flatMap((e) => e.legs).filter((l) => !l.isVoided);
        const apBilled = activeLegs.filter((l) => l.role === "ap").reduce((s, l) => s + l.credit, 0);
        const apSettled = activeLegs.filter((l) => l.role === "ap").reduce((s, l) => s + l.debit, 0);
        const cashPaid = activeLegs
          .filter((l) => l.role === "cash" || l.role === "bank")
          .reduce((s, l) => s + l.credit, 0);
        const apOpen = apBilled - apSettled;
        const posted = activeLegs.length > 0;

        let route: LedgerMappingRow["route"] = "unposted";
        let routeLabel = "Not posted to the ledger yet";
        if (posted) {
          if (apBilled > 0.005 && apOpen <= 0.005) {
            route = "ap_settled";
            routeLabel = "Booked to Accounts Payable, then settled with cash/bank";
          } else if (apBilled > 0.005) {
            route = "ap";
            routeLabel = "Booked to Accounts Payable — open balance";
          } else {
            route = "cash";
            routeLabel = "Paid directly — credited Cash/Bank, no payable created";
          }
        }

        const totalDebit = activeLegs.reduce((s, l) => s + l.debit, 0);
        const totalCredit = activeLegs.reduce((s, l) => s + l.credit, 0);

        return {
          expenseId: exp.id,
          description: exp.description ?? "Expense",
          amount: Number(exp.amount) || 0,
          expenseDate: exp.expense_date,
          status: exp.status,
          paymentMethod: exp.payment_method ?? null,
          branchId: exp.branch_id ?? null,
          branchName: exp.branch_id ? branchNames[exp.branch_id] ?? null : null,
          supplierName: exp.supplier_id ? suppliers[exp.supplier_id] ?? null : null,
          categoryName: exp.category_id ? categories[exp.category_id] ?? null : null,
          events,
          route,
          routeLabel,
          apBilled,
          apSettled,
          apOpen,
          cashPaid,
          posted,
          balanced: Math.abs(totalDebit - totalCredit) < 0.005,
        };
      });
    },
  });

  return {
    rows: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
