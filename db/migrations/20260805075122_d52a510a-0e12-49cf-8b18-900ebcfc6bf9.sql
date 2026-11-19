CREATE OR REPLACE FUNCTION public.retry_ap_settlement(p_expense_id uuid, p_reason text DEFAULT 'manual retry')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_exp RECORD;
  v_ap_parent uuid;
  v_ap_account uuid;
  v_ap_net numeric;
  v_existing uuid;
  v_result jsonb;
BEGIN
  -- Serialize retries per expense so concurrent clicks cannot double-post.
  PERFORM pg_advisory_xact_lock(hashtextextended('ap_settlement', 0), hashtextextended(p_expense_id::text, 0));

  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','failed','reason_code','not_found','error','Expense not found');
  END IF;

  IF NOT public.can_access_restaurant(v_exp.tenant_id) THEN
    RAISE EXCEPTION 'Not allowed to retry settlements for this tenant' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_exp.ledger_posted,false) = false THEN
    RETURN jsonb_build_object('outcome','skipped','reason_code','not_posted',
      'reason_detail','Post the expense to the ledger before settling it');
  END IF;

  IF COALESCE(v_exp.status,'unpaid') <> 'paid' THEN
    RETURN jsonb_build_object('outcome','skipped','reason_code','not_paid',
      'reason_detail','Expense is not marked as paid, nothing to settle');
  END IF;

  -- Idempotency guard: a live settlement batch with open lines means it already posted.
  SELECT b.id INTO v_existing
  FROM public.journal_entry_batches b
  WHERE b.tenant_id = v_exp.tenant_id
    AND b.reference_number = 'EXPPAY-' || p_expense_id::text
    AND EXISTS (
      SELECT 1 FROM public.account_transactions t
      WHERE t.batch_id = b.id AND COALESCE(t.is_voided,false) = false
    )
  LIMIT 1;

  SELECT id INTO v_ap_parent FROM public.chart_of_accounts
   WHERE tenant_id = v_exp.tenant_id AND account_code = '2000' AND is_active = true LIMIT 1;
  v_ap_account := CASE WHEN v_ap_parent IS NULL THEN NULL
                       ELSE public.resolve_branch_account(v_ap_parent, v_exp.branch_id) END;

  SELECT COALESCE(sum(COALESCE(credit,0) - COALESCE(debit,0)), 0)
    INTO v_ap_net
  FROM public.account_transactions
  WHERE reference_type = 'expense'
    AND reference_id = p_expense_id
    AND v_ap_parent IS NOT NULL
    AND account_id IN (v_ap_account, v_ap_parent)
    AND COALESCE(is_voided,false) = false;

  IF v_existing IS NOT NULL AND COALESCE(v_ap_net,0) <= 0.005 THEN
    BEGIN
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome, reason_code, reason_detail,
        batch_id, dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (
        v_exp.tenant_id, p_expense_id, v_exp.branch_id, 'reconcile', 'success', 'retry_already_settled',
        'Retry skipped — settlement already posted, no duplicate created (' || p_reason || ')',
        v_existing, 0, 0, 'manual', auth.uid()
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RETURN jsonb_build_object('outcome','unchanged','reason_code','already_settled','batch_id',v_existing);
  END IF;

  BEGIN
    v_result := public.reclassify_expense_credit_account(p_expense_id, 'retry: ' || p_reason);
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.expense_posting_audit (
        tenant_id, expense_id, branch_id, action, outcome, reason_code, reason_detail,
        dr_total, cr_total, trigger_source, triggered_by
      ) VALUES (
        v_exp.tenant_id, p_expense_id, v_exp.branch_id, 'reconcile', 'failed', 'retry_failed',
        left(SQLERRM, 500), 0, 0, 'manual', auth.uid()
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RAISE;
  END;

  RETURN COALESCE(v_result, jsonb_build_object('outcome','failed','reason_code','no_result'))
         || jsonb_build_object('retried', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.retry_ap_settlement(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.retry_ap_settlement(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retry_ap_settlement(uuid, text) TO service_role;