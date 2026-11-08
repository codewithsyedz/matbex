import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

export const AGING_BUCKETS: { key: AgingBucket; label: string }[] = [
  { key: "current", label: "Not yet due" },
  { key: "d1_30", label: "1–30 days" },
  { key: "d31_60", label: "31–60 days" },
  { key: "d61_90", label: "61–90 days" },
  { key: "d90_plus", label: "90+ days" },
];

export interface ApAgingRow {
  key: string;
  expenseId: string | null;
  description: string;
  supplierId: string | null;
  supplierName: string | null;
  /** Supplier-specific AP head the balance sits on (falls back to shared 2000). */
  apAccountCode: string | null;
  apAccountName: string | null;
  invoiceNumber: string | null;
  branchId: string | null;
  branchName: string | null;
  documentDate: string | null;
  dueDate: string | null;
  daysOverdue: number;
  bucket: AgingBucket;
  /** Original credit posted to Accounts Payable. */
  billed: number;
  /** Debits applied via settlement / reversal entries. */
  settled: number;
  /** Rolled-forward open balance (billed − settled). */
  open: number;
}

export type BucketTotals = Record<AgingBucket, number>;

const emptyBuckets = (): BucketTotals => ({
  current: 0,
  d1_30: 0,
  d31_60: 0,
  d61_90: 0,
  d90_plus: 0,
});

function bucketFor(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "d1_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90_plus";
}

interface Args {
  /** Balances are rolled forward through this date (inclusive). */
  asOf: Date;
  /** "all" / null = consolidated across branches. */
  branchId?: string | null;
  /** "all" / null = every supplier (including unassigned manual payables). */
  supplierId?: string | null;
}

interface Leg {
  account_id: string;
  reference_id: string | null;
  reference_type: string | null;
  branch_id: string | null;
  transaction_date: string;
  debit: number | null;
  credit: number | null;
  description: string | null;
}

export function useApAging({ asOf, branchId, supplierId }: Args) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const asOfKey = format(asOf, "yyyy-MM-dd");
  const branchKey = branchId && branchId !== "all" ? branchId : null;
  const supplierKey = supplierId && supplierId !== "all" ? supplierId : null;

  const query = useQuery({
    queryKey: ["ap-aging", tenantId, asOfKey, branchKey, supplierKey],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 2,
    queryFn: async () => {
      // 1a. Suppliers and their dedicated AP heads
      const { data: supplierRows, error: supErr } = await supabase
        .from("suppliers")
        .select("id, name, ap_account_id")
        .order("name");
      if (supErr) throw supErr;
      const supplierList = (supplierRows ?? []).map((s) => ({
        id: s.id as string,
        name: s.name as string,
        apAccountId: (s.ap_account_id as string | null) ?? null,
      }));
      const supplierByApAccount: Record<string, { id: string; name: string }> = {};
      for (const s of supplierList) {
        if (s.apAccountId) supplierByApAccount[s.apAccountId] = { id: s.id, name: s.name };
      }

      // 1b. Shared 2000 control accounts + every supplier-specific AP head
      const { data: sharedAccounts, error: accErr } = await supabase
        .from("chart_of_accounts")
        .select("id, account_code, account_name, account_type")
        .eq("tenant_id", tenantId!)
        .eq("account_type", "liability")
        .like("account_code", "2000%");
      if (accErr) throw accErr;

      const supplierApIds = supplierList
        .map((s) => s.apAccountId)
        .filter(Boolean) as string[];
      let supplierApAccounts: any[] = [];
      if (supplierApIds.length) {
        const { data, error } = await supabase
          .from("chart_of_accounts")
          .select("id, account_code, account_name, account_type")
          .eq("tenant_id", tenantId!)
          .in("id", supplierApIds);
        if (error) throw error;
        supplierApAccounts = data ?? [];
      }

      const accountMeta: Record<string, { code: string; name: string }> = {};
      for (const a of [...(sharedAccounts ?? []), ...supplierApAccounts]) {
        accountMeta[a.id] = { code: a.account_code, name: a.account_name };
      }

      // When a supplier is selected, scope to its own head (plus the shared control
      // accounts, where legacy balances for that supplier may still sit).
      const apAccountIds = supplierKey
        ? Array.from(
            new Set([
              ...(supplierList.find((s) => s.id === supplierKey)?.apAccountId
                ? [supplierList.find((s) => s.id === supplierKey)!.apAccountId as string]
                : []),
              ...(sharedAccounts ?? []).map((a) => a.id),
            ]),
          )
        : Object.keys(accountMeta);
      if (apAccountIds.length === 0) {
        return { rows: [] as ApAgingRow[], branches: {} as Record<string, string> };
      }

      // 2. Every non-voided AP leg up to the as-of date (paged past the 1000-row cap)
      const pageSize = 1000;
      let page = 0;
      const legs: Leg[] = [];
      while (true) {
        let q = supabase
          .from("account_transactions")
          .select(
            "account_id, reference_id, reference_type, branch_id, transaction_date, debit, credit, description",
          )
          .eq("tenant_id", tenantId!)
          .eq("is_voided", false)
          .in("account_id", apAccountIds)
          .lte("transaction_date", asOfKey);
        if (branchKey) q = q.eq("branch_id", branchKey);
        const { data, error } = await q
          .order("transaction_date", { ascending: true })
          .range(page * pageSize, page * pageSize + pageSize - 1);
        if (error) throw error;
        const batch = (data ?? []) as Leg[];
        legs.push(...batch);
        if (batch.length < pageSize) break;
        page += 1;
        if (page > 50) break;
      }

      // 3. Enrich with expense / invoice / supplier / branch metadata
      const expenseIds = Array.from(
        new Set(
          legs
            .filter((l) => l.reference_type === "expense" && l.reference_id)
            .map((l) => l.reference_id as string),
        ),
      );

      const expenses: Record<string, any> = {};
      for (let i = 0; i < expenseIds.length; i += 200) {
        const chunk = expenseIds.slice(i, i + 200);
        const { data, error } = await supabase
          .from("expenses")
          .select(
            "id, description, expense_date, branch_id, supplier_id, purchase_invoice_id, amount",
          )
          .in("id", chunk);
        if (error) throw error;
        (data ?? []).forEach((e: any) => (expenses[e.id] = e));
      }

      const invoiceIds = Array.from(
        new Set(
          Object.values(expenses)
            .map((e: any) => e.purchase_invoice_id)
            .filter(Boolean) as string[],
        ),
      );
      const invoices: Record<string, any> = {};
      if (invoiceIds.length) {
        const { data } = await supabase
          .from("purchase_invoices")
          .select("id, invoice_number, invoice_date, due_date, supplier_id")
          .in("id", invoiceIds);
        (data ?? []).forEach((inv: any) => (invoices[inv.id] = inv));
      }

      const { data: branchRows } = await supabase.from("branches").select("id, name");
      const suppliers: Record<string, string> = {};
      supplierList.forEach((s) => (suppliers[s.id] = s.name));
      const branches: Record<string, string> = {};
      (branchRows ?? []).forEach((b: any) => (branches[b.id] = b.name));

      // 4. Roll forward: credits raise the payable, debits (settlements) reduce it
      type Agg = {
        billed: number;
        settled: number;
        branchId: string | null;
        date: string;
        desc: string;
        apAccountId: string | null;
      };
      const agg = new Map<string, Agg>();
      for (const l of legs) {
        const key =
          l.reference_type === "expense" && l.reference_id
            ? `expense:${l.reference_id}`
            : `other:${l.reference_type ?? "manual"}:${l.reference_id ?? l.account_id}`;
        const cur =
          agg.get(key) ??
          ({
            billed: 0,
            settled: 0,
            branchId: l.branch_id,
            date: l.transaction_date,
            desc: l.description ?? "",
            apAccountId: l.account_id,
          } as Agg);
        cur.billed += Number(l.credit ?? 0);
        cur.settled += Number(l.debit ?? 0);
        // Prefer the supplier-specific head when the balance touches one
        if (supplierByApAccount[l.account_id]) cur.apAccountId = l.account_id;
        if (l.transaction_date < cur.date) {
          cur.date = l.transaction_date;
          cur.desc = l.description ?? cur.desc;
          cur.branchId = l.branch_id ?? cur.branchId;
        }
        agg.set(key, cur);
      }

      const asOfMs = new Date(`${asOfKey}T00:00:00Z`).getTime();
      const rows: ApAgingRow[] = [];
      agg.forEach((v, key) => {
        const open = v.billed - v.settled;
        if (open <= 0.005) return; // fully settled — excluded from aging

        const expenseId = key.startsWith("expense:") ? key.slice("expense:".length) : null;
        const exp = expenseId ? expenses[expenseId] : null;
        const inv = exp?.purchase_invoice_id ? invoices[exp.purchase_invoice_id] : null;

        const documentDate: string | null = exp?.expense_date ?? v.date ?? null;
        const dueDate: string | null = inv?.due_date ?? documentDate;
        const dueMs = dueDate ? new Date(`${dueDate}T00:00:00Z`).getTime() : asOfMs;
        const daysOverdue = Math.floor((asOfMs - dueMs) / 86400000);
        const bId = exp?.branch_id ?? v.branchId ?? null;
        const apAcc = v.apAccountId;
        const rowSupplierId: string | null =
          exp?.supplier_id ??
          inv?.supplier_id ??
          (apAcc ? supplierByApAccount[apAcc]?.id ?? null : null);

        // Supplier filter: keep only that supplier's payables
        if (supplierKey && rowSupplierId !== supplierKey) return;

        rows.push({
          key,
          expenseId,
          description: exp?.description || v.desc || "Manual payable entry",
          supplierId: rowSupplierId,
          supplierName: rowSupplierId ? suppliers[rowSupplierId] ?? null : null,
          apAccountCode: apAcc ? accountMeta[apAcc]?.code ?? null : null,
          apAccountName: apAcc ? accountMeta[apAcc]?.name ?? null : null,
          invoiceNumber: inv?.invoice_number ?? null,
          branchId: bId,
          branchName: bId ? branches[bId] ?? null : null,
          documentDate,
          dueDate,
          daysOverdue,
          bucket: bucketFor(daysOverdue),
          billed: v.billed,
          settled: v.settled,
          open,
        });
      });

      rows.sort((a, b) => b.daysOverdue - a.daysOverdue || b.open - a.open);
      return { rows, branches, suppliers: supplierList };
    },
  });

  const rows = query.data?.rows ?? [];
  const suppliers = query.data?.suppliers ?? [];

  const bucketTotals = useMemo(() => {
    const totals = emptyBuckets();
    for (const r of rows) totals[r.bucket] += r.open;
    return totals;
  }, [rows]);

  const byBranch = useMemo(() => {
    const map = new Map<
      string,
      { branchId: string | null; branchName: string; buckets: BucketTotals; total: number }
    >();
    for (const r of rows) {
      const key = r.branchId ?? "unassigned";
      const entry =
        map.get(key) ??
        {
          branchId: r.branchId,
          branchName: r.branchName ?? "Unassigned",
          buckets: emptyBuckets(),
          total: 0,
        };
      entry.buckets[r.bucket] += r.open;
      entry.total += r.open;
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [rows]);

  const totalOpen = useMemo(() => rows.reduce((s, r) => s + r.open, 0), [rows]);
  const totalOverdue = useMemo(
    () => rows.filter((r) => r.daysOverdue > 0).reduce((s, r) => s + r.open, 0),
    [rows],
  );

  const bySupplier = useMemo(() => {
    const map = new Map<
      string,
      {
        supplierId: string | null;
        supplierName: string;
        apAccountCode: string | null;
        buckets: BucketTotals;
        total: number;
      }
    >();
    for (const r of rows) {
      const key = r.supplierId ?? "unassigned";
      const entry =
        map.get(key) ??
        {
          supplierId: r.supplierId,
          supplierName: r.supplierName ?? "No supplier",
          apAccountCode: r.apAccountCode,
          buckets: emptyBuckets(),
          total: 0,
        };
      entry.buckets[r.bucket] += r.open;
      entry.total += r.open;
      if (!entry.apAccountCode) entry.apAccountCode = r.apAccountCode;
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [rows]);

  return {
    rows,
    suppliers,
    bucketTotals,
    byBranch,
    bySupplier,
    totalOpen,
    totalOverdue,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
