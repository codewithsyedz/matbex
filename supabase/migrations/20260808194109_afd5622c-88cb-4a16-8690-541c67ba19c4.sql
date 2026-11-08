CREATE OR REPLACE FUNCTION public.preview_ap_settlement(p_expense_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_exp RECORD;
  v_ap_parent uuid;
  v_ap_account uuid;
  v_cash_account uuid;
  v_ap_net numeric;
  v_amount numeric;
  v_existing jsonb;
  v_planned jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_ap_row RECORD;
  v_cash_row RECORD;
BEGIN
  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'not_found', 'message', 'Expense not found');
  END IF;

  IF v_exp.tenant_id IS NULL OR NOT public.can_access_restaurant(v_exp.restaurant_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'forbidden', 'message', 'Not allowed to preview this expense');
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'created_at'), '[]'::jsonb) INTO v_existing
  FROM (
    SELECT jsonb_build_object(
      'account_code', a.account_code,
      'account_name', a.account_name,
      'debit', COALESCE(t.debit, 0),
      'credit', COALESCE(t.credit, 0),
      'description', t.description,
      'transaction_date', t.transaction_date,
      'created_at', t.created_at,
      'reference_type', t.reference_type,
      'line_kind', CASE
        WHEN t.reference_type = 'expense' THEN 'original'
        WHEN t.reference_type IN ('adjustment', 'correction') THEN 'correction'
        ELSE 'adjustment'
      END,
      'batch_reference', b.reference_number
    ) AS x
    FROM public.account_transactions t
    JOIN public.chart_of_accounts a ON a.id = t.account_id
    LEFT JOIN public.journal_entry_batches b ON b.id = t.batch_id
    WHERE t.reference_type IN ('expense', 'adjustment', 'correction', 'reversal', 'settlement')
      AND t.reference_id = p_expense_id
      AND COALESCE(t.is_voided, false) = false
  ) s;

  IF COALESCE(v_exp.ledger_posted, false) = false THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason_code', 'not_posted',
      'message', 'This expense is not posted to the ledger yet, so no settlement entry will be created.',
      'existing_lines', v_existing, 'planned_lines', '[]'::jsonb, 'amount', 0
    );
  END IF;

  SELECT id INTO v_ap_parent FROM public.chart_of_accounts
   WHERE tenant_id = v_exp.tenant_id AND account_code = '2000' AND is_active = true LIMIT 1;

  v_cash_account := public.resolve_expense_funding_account(p_expense_id);

  IF v_ap_parent IS NULL OR v_cash_account IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason_code', 'missing_account',
      'message', 'Payable (2000) or the paying account could not be resolved.',
      'existing_lines', v_existing, 'planned_lines', '[]'::jsonb, 'amount', 0
    );
  END IF;

  v_ap_account := public.resolve_branch_account(v_ap_parent, v_exp.branch_id);

  SELECT COALESCE(sum(COALESCE(credit,0) - COALESCE(debit,0)), 0) INTO v_ap_net
  FROM public.account_transactions
  WHERE reference_type IN ('expense', 'adjustment', 'correction', 'reversal', 'settlement')
    AND reference_id = p_expense_id
    AND account_id IN (v_ap_account, v_ap_parent)
    AND COALESCE(is_voided, false) = false;

  v_amount := round(GREATEST(v_ap_net, 0), 2);

  SELECT account_code, account_name, account_type INTO v_ap_row
  FROM public.chart_of_accounts WHERE id = v_ap_account;
  SELECT account_code, account_name, account_type INTO v_cash_row
  FROM public.chart_of_accounts WHERE id = v_cash_account;

  IF v_amount <= 0.005 THEN
    v_warnings := v_warnings || jsonb_build_object(
      'level', 'info',
      'message', 'No open payable remains on this expense — marking it paid will not create a new settlement entry.');
  END IF;

  IF v_cash_row.account_type IS DISTINCT FROM 'asset'
     AND v_cash_row.account_type IS DISTINCT FROM 'equity' THEN
    v_warnings := v_warnings || jsonb_build_object(
      'level', 'error',
      'message', format('The paying account %s - %s is a %s account. Payments should credit a cash, bank or partner capital account.',
        v_cash_row.account_code, v_cash_row.account_name, v_cash_row.account_type));
  ELSIF v_exp.capital_account_id IS NULL
    AND v_cash_row.account_type = 'asset'
    AND v_cash_row.account_code NOT BETWEEN '1000' AND '1099' THEN
    v_warnings := v_warnings || jsonb_build_object(
      'level', 'warning',
      'message', format('The paying account %s - %s is outside the cash/bank range (1000-1099). Confirm this is really where the money left from.',
        v_cash_row.account_code, v_cash_row.account_name));
  END IF;

  IF v_exp.payment_method IN ('bank_transfer','cheque','card') AND v_cash_row.account_code = '1000' THEN
    v_warnings := v_warnings || jsonb_build_object(
      'level', 'warning',
      'message', format('Payment method is "%s" but the credit will hit 1000 Cash on Hand. Pick the matching bank account instead.', v_exp.payment_method));
  END IF;

  IF v_amount > 0.005 THEN
    v_planned := jsonb_build_array(
      jsonb_build_object(
        'account_code', v_ap_row.account_code,
        'account_name', v_ap_row.account_name,
        'debit', v_amount,
        'credit', 0,
        'line_kind', 'planned',
        'reference_type', 'expense',
        'description', 'Payable settled'
      ),
      jsonb_build_object(
        'account_code', v_cash_row.account_code,
        'account_name', v_cash_row.account_name,
        'debit', 0,
        'credit', v_amount,
        'line_kind', 'planned',
        'reference_type', 'expense',
        'description', 'Paid from ' || v_cash_row.account_name
      )
    );
  ELSE
    v_planned := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'expense_id', p_expense_id,
    'amount', v_amount,
    'open_payable', v_amount,
    'payment_method', v_exp.payment_method,
    'funding_source', v_exp.funding_source,
    'existing_lines', v_existing,
    'planned_lines', v_planned,
    'warnings', v_warnings
  );
END;
$function$;