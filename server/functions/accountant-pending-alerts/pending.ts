export type PendingRecord = Record<string, unknown>;
export function pendingExpenseReasons(row: PendingRecord): string[] {
  if (row.deleted_at || row.approval_status === 'rejected') return [];
  const reasons: string[] = [];
  if (!row.account_id) reasons.push('Account missing');
  if (row.approval_status === 'pending') reasons.push('Awaiting approval');
  if (!row.ledger_posted) reasons.push('Awaiting posting / correction');
  if (row.vat_split_status === 'pending') reasons.push('VAT review / reversal check');
  return reasons;
}
export function inventoryNeedsAttention(row: PendingRecord): boolean {
  return row.is_active === true && row.reorder_level != null && Number(row.current_stock) <= Number(row.reorder_level);
}
export function pendingSignature(expenses: PendingRecord[], inventory: PendingRecord[]): string {
  return JSON.stringify({
    expenses: expenses.filter(r => pendingExpenseReasons(r).length).map(r => [r.id, pendingExpenseReasons(r), r.amount, r.vat_amount]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))),
    inventory: inventory.filter(inventoryNeedsAttention).map(r => [r.id, r.current_stock, r.reorder_level]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))),
  });
}