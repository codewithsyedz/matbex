import { describe, it, expect } from 'vitest';
import { inventoryNeedsAttention, pendingExpenseReasons, pendingSignature } from '../../supabase/functions/accountant-pending-alerts/pending';
describe('accountant pending email rules', () => {
  it('includes pending VAT even when another correction is pending', () => {
    expect(pendingExpenseReasons({account_id: null, ledger_posted: false, vat_split_status: 'pending'})).toContain('VAT review / reversal check');
  });
  it('alerts when active stock equals the reorder level', () => {
    expect(inventoryNeedsAttention({is_active: true, current_stock: 5, reorder_level: 5})).toBe(true);
    expect(inventoryNeedsAttention({is_active: true, current_stock: 6, reorder_level: 5})).toBe(false);
  });
  it('excludes inactive stock and unset reorder levels', () => {
    expect(inventoryNeedsAttention({is_active: false, current_stock: 0, reorder_level: 5})).toBe(false);
    expect(inventoryNeedsAttention({is_active: true, current_stock: 0, reorder_level: null})).toBe(false);
  });
  it('excludes archived and rejected expenses', () => {
    expect(pendingExpenseReasons({deleted_at: '2026-11-07'})).toEqual([]);
    expect(pendingExpenseReasons({approval_status: 'rejected'})).toEqual([]);
  });
  it('deduplicates identical pending work regardless of query order', () => {
    const a = {id: 'a', ledger_posted: false}, b = {id: 'b', ledger_posted: false};
    expect(pendingSignature([a,b], [])).toEqual(pendingSignature([b,a], []));
    expect(pendingSignature([a,b], [])).not.toEqual(pendingSignature([a], []));
  });
});