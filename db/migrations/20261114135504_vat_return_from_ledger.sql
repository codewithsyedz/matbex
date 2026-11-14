-- vat_return_from_ledger
--
-- The VAT return screen computed its boxes itself: output VAT from POS sales of the selected
-- restaurant only (missing sales recorded at End of Day but not rung in POS), and input VAT by
-- treating EVERY expense as 15% VAT-inclusive (salaries, water, travel...) plus purchase
-- invoices whose lines are those same expenses. On the production copy for Q3 2026 it would
-- have filed a refund claim of about 20,274 SAR where roughly 41,000 is payable. Found in the
-- CFO review of 2026-11-14.
--
-- The return now comes from the books for the whole business (all restaurants and branches,
-- one VAT registration): output VAT = net credits to 2200 VAT Payable (excluding VAT payments),
-- input VAT = net debits to 1180 Input VAT Recoverable, for the period. Alongside, what must be
-- done before filing because it is not in the books yet: closed days not posted, days with POS
-- sales but no End of Day, and expenses whose recorded VAT is waiting for its split.

CREATE OR REPLACE FUNCTION public.vat_return_ledger_figures(p_tenant_id uuid, p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_out numeric := 0;
  v_in numeric := 0;
  v_unposted_n int := 0; v_unposted_vat numeric := 0;
  v_noeod_n int := 0; v_noeod_vat numeric := 0;
  v_split_n int := 0; v_split_vat numeric := 0;
  r record;
BEGIN
  -- SECURITY INVOKER: the caller's row security decides what is visible (finance roles).
  SELECT COALESCE(sum(t.credit - t.debit), 0) INTO v_out
  FROM account_transactions t JOIN chart_of_accounts a ON a.id = t.account_id
  WHERE t.tenant_id = p_tenant_id AND a.account_code = '2200' AND NOT COALESCE(t.is_voided, false)
    AND t.transaction_date BETWEEN p_start AND p_end
    AND COALESCE(t.reference_type, '') NOT IN ('vat_remittance', 'vat_remittance_reversal');

  SELECT COALESCE(sum(t.debit - t.credit), 0) INTO v_in
  FROM account_transactions t JOIN chart_of_accounts a ON a.id = t.account_id
  WHERE t.tenant_id = p_tenant_id AND a.account_code = '1180' AND NOT COALESCE(t.is_voided, false)
    AND t.transaction_date BETWEEN p_start AND p_end;

  -- Closed days not posted: VAT at their branch's rate on the VAT-inclusive total.
  SELECT count(*), COALESCE(sum(d.total_sales * COALESCE(b.vat_rate, 15) / (100 + COALESCE(b.vat_rate, 15))), 0)
    INTO v_unposted_n, v_unposted_vat
  FROM daily_sales_summary d LEFT JOIN branches b ON b.id = d.branch_id
  WHERE d.tenant_id = p_tenant_id AND d.sales_date BETWEEN p_start AND p_end
    AND d.status IN ('closed', 'approved') AND NOT COALESCE(d.ledger_posted, false);

  -- Days with POS sales and no End of Day.
  FOR r IN SELECT id FROM restaurants WHERE tenant_id = p_tenant_id LOOP
    SELECT v_noeod_n + count(*), v_noeod_vat + COALESCE(sum(x.pos_total * COALESCE(b.vat_rate, 15) / (100 + COALESCE(b.vat_rate, 15))), 0)
      INTO v_noeod_n, v_noeod_vat
    FROM public.days_without_end_of_day(r.id, NULL) x LEFT JOIN branches b ON b.id = x.branch_id
    WHERE x.sales_date BETWEEN p_start AND p_end;
  END LOOP;

  -- Expense VAT recorded but not yet split into 1180 (Pending VAT Split).
  SELECT count(*), COALESCE(sum(e.vat_amount), 0) INTO v_split_n, v_split_vat
  FROM expenses e JOIN restaurants rr ON rr.id = e.restaurant_id
  WHERE rr.tenant_id = p_tenant_id AND e.deleted_at IS NULL AND COALESCE(e.vat_amount, 0) > 0
    AND e.expense_date BETWEEN p_start AND p_end AND e.vat_split_status = 'pending';

  RETURN jsonb_build_object(
    'output_vat', round(v_out, 2),
    'output_net', round(v_out / 0.15, 2),
    'input_vat', round(v_in, 2),
    'input_net', round(v_in / 0.15, 2),
    'unposted_days', v_unposted_n, 'unposted_vat', round(v_unposted_vat, 2),
    'days_without_eod', v_noeod_n, 'days_without_eod_vat', round(v_noeod_vat, 2),
    'pending_vat_split', v_split_n, 'pending_vat_split_vat', round(v_split_vat, 2));
END;
$function$;
REVOKE ALL ON FUNCTION public.vat_return_ledger_figures(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vat_return_ledger_figures(uuid, date, date) TO authenticated, service_role;
