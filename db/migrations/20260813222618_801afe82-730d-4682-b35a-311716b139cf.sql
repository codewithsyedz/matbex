DO $$
DECLARE
  v_sum RECORD;
  v_adj RECORD;
  v_cash uuid; v_os uuid; v_batch uuid; v_new_adj uuid; v_posted uuid;
BEGIN
  SELECT * INTO v_sum FROM daily_sales_summary WHERE id = '4f72361a-2f79-4b92-8241-d0f19974f0d5';
  SELECT * INTO v_adj FROM day_end_adjustments WHERE id = '37c29c6f-e568-4b85-9106-b4b7e8d78d5f';

  SELECT id INTO v_cash FROM chart_of_accounts WHERE tenant_id = v_sum.tenant_id AND account_code='1000' AND is_active LIMIT 1;
  SELECT id INTO v_os FROM chart_of_accounts WHERE tenant_id = v_sum.tenant_id AND account_code='6999' AND is_active LIMIT 1;

  IF v_adj.reversed_at IS NULL AND v_adj.ledger_posted THEN
    INSERT INTO day_end_adjustments (tenant_id, restaurant_id, branch_id, scope, scope_ref_id, business_date, reason, notes, amount, ledger_posted, created_by, reversal_of_id)
    VALUES (v_adj.tenant_id, v_adj.restaurant_id, v_adj.branch_id, v_adj.scope, v_adj.scope_ref_id, v_adj.business_date, v_adj.reason,
      'REVERSAL: duplicate of declared day-end sales - the 1,162 unrecorded cash is already inside the declared cash total of 1,588 posted as daily sales revenue.',
      v_adj.amount * -1, false, v_adj.created_by, v_adj.id)
    RETURNING id INTO v_new_adj;

    INSERT INTO journal_entry_batches (tenant_id, branch_id, batch_date, description, reference_number, entry_type, journal_type, created_by, is_posted, posted_at, posted_by, approval_status)
    VALUES (v_adj.tenant_id, v_adj.branch_id, '2026-08-11',
      'REVERSAL of Day-End Adjustment [unrecorded_sales]: duplicate of declared daily sales for 2026-08-11',
      'DEA-REV-20260811-' || substr(v_new_adj::text,1,8), 'adjustment', 'reversal', v_adj.created_by, true, now(), v_adj.created_by, 'approved')
    RETURNING id INTO v_batch;

    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, created_by, batch_id, branch_id, original_transaction_id)
    VALUES (v_adj.tenant_id, v_os, '2026-08-11', abs(v_adj.amount), 'REVERSAL of duplicated unrecorded-sales adjustment 2026-08-11', 'day_end_adjustment_reversal', v_adj.id, v_adj.created_by, v_batch, v_adj.branch_id, '5666eebf-df53-45c3-bbea-a0e904c982b3');
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, credit, description, reference_type, reference_id, created_by, batch_id, branch_id, original_transaction_id)
    VALUES (v_adj.tenant_id, v_cash, '2026-08-11', abs(v_adj.amount), 'REVERSAL of duplicated unrecorded-sales adjustment 2026-08-11', 'day_end_adjustment_reversal', v_adj.id, v_adj.created_by, v_batch, v_adj.branch_id, '5e708104-f987-4f2e-8cc7-5cab22d2b291');

    UPDATE day_end_adjustments SET ledger_posted = true, ledger_batch_id = v_batch WHERE id = v_new_adj;
    UPDATE day_end_adjustments
       SET reversed_at = now(), reversed_by = v_adj.created_by,
           reversal_reason = 'Duplicate: declared cash sales already include this unrecorded amount',
           reversed_adjustment_id = v_new_adj
     WHERE id = v_adj.id;
  END IF;

  UPDATE daily_sales_summary
     SET system_calculated_total = 1638.00,
         pos_reported_total = 2800.00,
         variance_status = 'resolved',
         variance_notes = COALESCE(variance_notes || ' | ', '') || 'Recomputed on re-entry: POS synced total 1,638.00 vs declared 2,800.00 = 1,162.00 unrecorded cash sales (already inside declared cash). Duplicate day-end adjustment reversed.',
         updated_at = now()
   WHERE id = v_sum.id;

  IF NOT v_sum.ledger_posted THEN
    v_posted := public.post_daily_sales_to_ledger(v_sum.id);
    RAISE NOTICE 'posted batch %', v_posted;
  END IF;
END $$;