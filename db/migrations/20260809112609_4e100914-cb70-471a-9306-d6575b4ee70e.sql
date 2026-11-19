CREATE OR REPLACE FUNCTION public.log_reversal_linkage_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orig public.account_transactions%ROWTYPE;
  v_acct_code text;
  v_acct_name text;
BEGIN
  -- Only reversal lines carry a linkage worth auditing.
  IF NEW.original_transaction_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_orig
  FROM public.account_transactions
  WHERE id = NEW.original_transaction_id;

  SELECT account_code, account_name INTO v_acct_code, v_acct_name
  FROM public.chart_of_accounts
  WHERE id = NEW.account_id;

  INSERT INTO public.audit_logs (user_id, tenant_id, action, entity_type, entity_id, old_data, new_data)
  VALUES (
    COALESCE(NEW.created_by, auth.uid()),
    NEW.tenant_id,
    'REVERSAL_POSTED',
    'account_transaction',
    NEW.id,
    jsonb_build_object(
      'original_transaction_id', v_orig.id,
      'original_reference_type', v_orig.reference_type,
      'original_reference_id', v_orig.reference_id,
      'original_batch_id', v_orig.batch_id,
      'original_transaction_date', v_orig.transaction_date,
      'original_debit', v_orig.debit,
      'original_credit', v_orig.credit,
      'original_side', CASE WHEN COALESCE(v_orig.debit, 0) > 0 THEN 'DR' ELSE 'CR' END,
      'original_description', v_orig.description
    ),
    jsonb_build_object(
      'reversal_transaction_id', NEW.id,
      'reversal_reference_type', NEW.reference_type,
      'reversal_reference_id', NEW.reference_id,
      'reversal_batch_id', NEW.batch_id,
      'reversal_transaction_date', NEW.transaction_date,
      'reversal_debit', NEW.debit,
      'reversal_credit', NEW.credit,
      'reversal_side', CASE WHEN COALESCE(NEW.debit, 0) > 0 THEN 'DR' ELSE 'CR' END,
      'account_id', NEW.account_id,
      'account_code', v_acct_code,
      'account_name', v_acct_name,
      'branch_id', NEW.branch_id,
      'mirror_mapping',
        CASE WHEN COALESCE(v_orig.debit, 0) > 0 THEN 'DR -> CR' ELSE 'CR -> DR' END,
      'mirror_amount', GREATEST(COALESCE(NEW.debit, 0), COALESCE(NEW.credit, 0)),
      'mirror_balanced',
        (ROUND(COALESCE(NEW.debit, 0), 2) = ROUND(COALESCE(v_orig.credit, 0), 2)
         AND ROUND(COALESCE(NEW.credit, 0), 2) = ROUND(COALESCE(v_orig.debit, 0), 2)),
      'posted_at', now()
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_reversal_linkage_audit ON public.account_transactions;
CREATE TRIGGER trg_log_reversal_linkage_audit
AFTER INSERT ON public.account_transactions
FOR EACH ROW
EXECUTE FUNCTION public.log_reversal_linkage_audit();