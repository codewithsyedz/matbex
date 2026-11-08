export interface AccountantExpense {
  id: string; amount: number; paid_amount: number | null; vat_amount: number;
  expense_date: string; description: string | null; branch_id: string | null;
  ledger_posted: boolean | null; approval_status: string | null;
  vat_split_status: string; account_id: string | null; deleted_at: string | null;
}
export function expenseAttention(row: AccountantExpense): "mapping" | "posting" | "approval" | "vat" | null {
  if (row.deleted_at || row.approval_status === "rejected") return null;
  if (!row.account_id) return "mapping";
  if (row.approval_status === "pending") return "approval";
  if (!row.ledger_posted) return "posting";
  if (row.vat_split_status === "pending") return "vat";
  return null;
}
export function summarizeAccountantExpenses(rows: AccountantExpense[], from: string, to: string) {
  return rows.filter(r => !r.deleted_at && r.approval_status !== "rejected" && r.expense_date >= from && r.expense_date <= to)
    .reduce((s, r) => ({ total: s.total + Number(r.amount), unpaid: s.unpaid + Math.max(0, Number(r.amount) - Number(r.paid_amount || 0)), vat: s.vat + Number(r.vat_amount || 0) }), { total: 0, unpaid: 0, vat: 0 });
}
export function isAccountantDashboardRole(hasRole: (role: string) => boolean) {
  return hasRole("accountant") && !hasRole("owner") && !hasRole("manager") && !hasRole("superadmin");
}