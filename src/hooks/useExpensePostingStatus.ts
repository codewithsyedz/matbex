import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";

export type PostingStatus = "unposted" | "balanced" | "unbalanced";

export interface ExpenseLedgerLeg {
  id: string;
  account_id: string;
  transaction_date: string;
  debit: number;
  credit: number;
  description: string | null;
  branch_id: string | null;
  batch_id: string | null;
  is_voided: boolean | null;
  reference_type?: string | null;
  account?: { account_code: string; account_name: string; account_type: string } | null;
  branch?: { id: string; name: string } | null;
  batch?: {
    id: string;
    reference_number: string | null;
    description: string | null;
    entry_type: string | null;
    batch_date: string | null;
    is_posted: boolean | null;
  } | null;
}

export interface ExpenseLedgerBatch {
  batch_id: string | null;
  reference_number: string | null;
  description: string | null;
  entry_type: string | null;
  batch_date: string | null;
  is_posted: boolean | null;
  isAdjustment: boolean;
  legs: ExpenseLedgerLeg[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

export interface ExpensePostingStatus {
  status: PostingStatus;
  totalDebit: number;
  totalCredit: number;
  diff: number;
  legs: ExpenseLedgerLeg[];
  netByAccount: AccountNetLine[];
  batches: ExpenseLedgerBatch[];
}

export interface AccountNetLine {
  account_id: string;
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  net: number;
  reversed: boolean;
}

export const EXPENSE_LEDGER_REFERENCE_TYPES = [
  "expense",
  "adjustment",
  "reversal",
  "correction",
  "settlement",
] as const;

export function useExpensePostingStatus(expenseId: string | null | undefined, enabled = true) {
  return useQuery<ExpensePostingStatus>({
    queryKey: ["expense-posting-status", expenseId],
    enabled: !!expenseId && enabled,
    queryFn: async () => {
      const { data, error } = await db
        .from("account_transactions")
        .select(
          `id, account_id, transaction_date, debit, credit, description, branch_id, batch_id, is_voided, reference_type,
           account:chart_of_accounts(account_code, account_name, account_type),
           branch:branches!account_transactions_branch_id_fkey(id, name),
           batch:journal_entry_batches(id, reference_number, description, entry_type, batch_date, is_posted)`
        )
        .in("reference_type", EXPENSE_LEDGER_REFERENCE_TYPES as unknown as string[])
        .eq("reference_id", expenseId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const legs = ((data ?? []) as unknown as ExpenseLedgerLeg[]).filter(
        (l) => !l.is_voided,
      );
      const totalDebit = legs.reduce((s, l) => s + Number(l.debit ?? 0), 0);
      const totalCredit = legs.reduce((s, l) => s + Number(l.credit ?? 0), 0);
      const diff = +(totalDebit - totalCredit).toFixed(2);
      let status: PostingStatus = "unposted";
      if (legs.length > 0) {
        status = Math.abs(diff) <= 0.005 ? "balanced" : "unbalanced";
      }

      // Net impact per account so reversed legs (e.g. a payment wrongly
      // credited to 1150 Staff Advances and later reversed) collapse to zero.
      const byAccount = new Map<string, AccountNetLine>();
      for (const l of legs) {
        const key = l.account_id;
        const cur =
          byAccount.get(key) ??
          {
            account_id: key,
            account_code: l.account?.account_code ?? "—",
            account_name: l.account?.account_name ?? "",
            debit: 0,
            credit: 0,
            net: 0,
            reversed: false,
          };
        cur.debit += Number(l.debit ?? 0);
        cur.credit += Number(l.credit ?? 0);
        byAccount.set(key, cur);
      }
      const netByAccount = Array.from(byAccount.values())
        .map((a) => {
          const net = +(a.debit - a.credit).toFixed(2);
          return {
            ...a,
            debit: +a.debit.toFixed(2),
            credit: +a.credit.toFixed(2),
            net,
            reversed: Math.abs(net) <= 0.005 && (a.debit > 0 || a.credit > 0),
          };
        })
        .sort((a, b) => a.account_code.localeCompare(b.account_code));

      // Group legs into the journal batches that produced them so the drilldown
      // can show the original posting alongside any adjusting/reversal batches.
      const batchMap = new Map<string, ExpenseLedgerBatch>();
      for (const l of legs) {
        const key = l.batch_id ?? "__unbatched__";
        let entry = batchMap.get(key);
        if (!entry) {
          const refType = (l.reference_type ?? "").toLowerCase();
          const entryType = (l.batch?.entry_type ?? "").toLowerCase();
          entry = {
            batch_id: l.batch_id ?? null,
            reference_number: l.batch?.reference_number ?? null,
            description: l.batch?.description ?? null,
            entry_type: l.batch?.entry_type ?? null,
            batch_date: l.batch?.batch_date ?? l.transaction_date ?? null,
            is_posted: l.batch?.is_posted ?? null,
            isAdjustment:
              ["adjustment", "reversal", "correction"].includes(refType) ||
              ["adjustment", "reversal", "correction"].includes(entryType),
            legs: [],
            totalDebit: 0,
            totalCredit: 0,
            balanced: true,
          };
          batchMap.set(key, entry);
        }
        entry.legs.push(l);
        entry.totalDebit += Number(l.debit ?? 0);
        entry.totalCredit += Number(l.credit ?? 0);
      }
      const batches = Array.from(batchMap.values())
        .map((b) => ({
          ...b,
          totalDebit: +b.totalDebit.toFixed(2),
          totalCredit: +b.totalCredit.toFixed(2),
          balanced: Math.abs(b.totalDebit - b.totalCredit) <= 0.005,
        }))
        .sort((a, b) => (a.batch_date ?? "").localeCompare(b.batch_date ?? ""));

      return { status, totalDebit, totalCredit, diff, legs, netByAccount, batches };
    },
    staleTime: 1000 * 30,
  });
}
