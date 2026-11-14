-- vat_return_figures_null_safe
--
-- vat_return_ledger_figures (20261114135504) summed debit - credit per line; ledger lines leave
-- the unused side NULL, so lines with a NULL side dropped out (QA Test Kitchen: 15.00 of input
-- VAT read as 0). Each side is now COALESCEd. Expenses waiting for their VAT split are those
-- with recorded VAT and no live 1180 line, not those whose status says 'pending' (expenses
-- posted with their VAT split could still carry that status).

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
  SELECT COALESCE(sum(COALESCE(t.credit, 0) - COALESCE(t.debit, 0)), 0) INTO v_out
  FROM account_transactions t JOIN chart_of_accounts a ON a.id = t.account_id
  WHERE t.tenant_id = p_tenant_id AND a.account_code = '2200' AND NOT COALESCE(t.is_voided, false)
    AND t.transaction_date BETWEEN p_start AND p_end
    AND COALESCE(t.reference_type, '') NOT IN ('vat_remittance', 'vat_remittance_reversal');

  SELECT COALESCE(sum(COALESCE(t.debit, 0) - COALESCE(t.credit, 0)), 0) INTO v_in
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

  -- Expense VAT recorded but not in 1180: no live 1180 line for the expense (the status
  -- field is not reliable: expenses posted with their VAT split can still say 'pending').
  SELECT count(*), COALESCE(sum(e.vat_amount), 0) INTO v_split_n, v_split_vat
  FROM expenses e JOIN restaurants rr ON rr.id = e.restaurant_id
  WHERE rr.tenant_id = p_tenant_id AND e.deleted_at IS NULL AND COALESCE(e.vat_amount, 0) > 0
    AND e.expense_date BETWEEN p_start AND p_end
    AND NOT EXISTS (
      SELECT 1 FROM account_transactions t JOIN chart_of_accounts a ON a.id = t.account_id
      WHERE t.reference_id = e.id AND a.account_code = '1180' AND NOT COALESCE(t.is_voided, false));

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
