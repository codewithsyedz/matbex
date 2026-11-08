CREATE TABLE public.expense_vat_split_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  restaurant_id uuid,
  branch_id uuid,
  expense_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('applied','marked_not_applicable')),
  rate_percent numeric(6,3),
  amount_before numeric(15,2),
  net_before numeric(15,2),
  vat_before numeric(15,2),
  status_before text,
  amount_after numeric(15,2),
  net_after numeric(15,2),
  vat_after numeric(15,2),
  status_after text,
  ledger_posted boolean,
  batch_id uuid,
  ledger_before jsonb,
  ledger_after jsonb,
  note text,
  performed_by uuid,
  performed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_expense_vat_split_audit_expense ON public.expense_vat_split_audit(expense_id, performed_at DESC);
CREATE INDEX idx_expense_vat_split_audit_tenant ON public.expense_vat_split_audit(tenant_id, performed_at DESC);

GRANT SELECT ON public.expense_vat_split_audit TO authenticated;
GRANT ALL ON public.expense_vat_split_audit TO service_role;

ALTER TABLE public.expense_vat_split_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance roles can view VAT split audit"
ON public.expense_vat_split_audit
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner'::app_role,'manager'::app_role,'accountant'::app_role)
  )
  AND EXISTS (
    SELECT 1 FROM public.expenses e
    WHERE e.id = expense_vat_split_audit.expense_id
      AND public.can_access_restaurant(e.restaurant_id)
  )
);

-- Rewrite apply_expense_vat_split to capture before/after ledger snapshots.
CREATE OR REPLACE FUNCTION public.apply_expense_vat_split(p_expense_id uuid, p_rate_percent numeric, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_exp record;
  v_net numeric(15,2);
  v_vat numeric(15,2);
  v_vat_account uuid;
  v_debit_account uuid;
  v_batch uuid;
  v_ledger_before jsonb;
  v_ledger_after jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner'::app_role, 'accountant'::app_role, 'manager'::app_role)
  ) THEN
    RAISE EXCEPTION 'Only owners, accountants or managers can apply a VAT split.';
  END IF;

  SELECT * INTO v_exp FROM expenses WHERE id = p_expense_id AND deleted_at IS NULL;
  IF v_exp.id IS NULL THEN
    RAISE EXCEPTION 'Expense not found.';
  END IF;
  IF v_exp.vat_split_status = 'applied' OR COALESCE(v_exp.vat_amount, 0) > 0 THEN
    RAISE EXCEPTION 'This expense already has a VAT split.';
  END IF;
  IF COALESCE(p_rate_percent, 0) <= 0 THEN
    RAISE EXCEPTION 'VAT rate must be greater than zero.';
  END IF;

  v_net := round(v_exp.amount / (1 + p_rate_percent / 100.0), 2);
  v_vat := round(v_exp.amount - v_net, 2);

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'account_code'), '[]'::jsonb) INTO v_ledger_before
  FROM (
    SELECT jsonb_build_object(
      'account_code', coa.account_code,
      'account_name', coa.account_name,
      'debit', at.debit,
      'credit', at.credit,
      'batch_id', at.batch_id,
      'transaction_date', at.transaction_date
    ) AS x
    FROM account_transactions at
    LEFT JOIN chart_of_accounts coa ON coa.id = at.account_id
    WHERE at.reference_id = p_expense_id
      AND at.reference_type IN ('expense','correction')
      AND COALESCE(at.is_voided, false) = false
  ) s;

  UPDATE expenses
  SET vat_amount = v_vat,
      net_amount = v_net,
      vat_rate = p_rate_percent,
      vat_inclusive = true,
      vat_split_status = 'applied',
      updated_at = now()
  WHERE id = p_expense_id;

  IF COALESCE(v_exp.ledger_posted, false) = true AND v_vat > 0 THEN
    SELECT id INTO v_vat_account
    FROM chart_of_accounts
    WHERE tenant_id = v_exp.tenant_id AND account_code = '1180' AND COALESCE(is_active, true)
    LIMIT 1;
    IF v_vat_account IS NULL THEN
      RAISE EXCEPTION 'Account 1180 Input VAT Recoverable is not configured.';
    END IF;

    SELECT account_id INTO v_debit_account
    FROM account_transactions
    WHERE reference_id = p_expense_id
      AND reference_type = 'expense'
      AND COALESCE(is_voided, false) = false
      AND debit > 0
    ORDER BY debit DESC
    LIMIT 1;
    v_debit_account := COALESCE(v_debit_account, v_exp.account_id);
    IF v_debit_account IS NULL THEN
      RAISE EXCEPTION 'Could not determine the expense account to reclassify.';
    END IF;

    INSERT INTO journal_entry_batches (
      tenant_id, branch_id, batch_date, description, reference_number,
      entry_type, journal_type, created_by, is_posted, posted_at, posted_by, approval_status
    ) VALUES (
      v_exp.tenant_id, v_exp.branch_id, v_exp.expense_date,
      'Retroactive VAT split - ' || COALESCE(v_exp.description, p_expense_id::text)
        || CASE WHEN p_note IS NOT NULL AND length(trim(p_note)) > 0 THEN ' (' || trim(p_note) || ')' ELSE '' END,
      'VATSPLIT-' || to_char(v_exp.expense_date, 'YYYYMMDD') || '-' || substr(p_expense_id::text, 1, 8),
      'correction', 'adjustment', auth.uid(), true, now(), auth.uid(), 'approved'
    ) RETURNING id INTO v_batch;

    INSERT INTO account_transactions (
      tenant_id, branch_id, account_id, batch_id, transaction_date,
      debit, credit, description, reference_type, reference_id, created_by
    ) VALUES
      (v_exp.tenant_id, v_exp.branch_id, v_vat_account, v_batch, v_exp.expense_date,
       v_vat, 0, 'Input VAT recovered on retroactive split', 'correction', p_expense_id, auth.uid()),
      (v_exp.tenant_id, v_exp.branch_id, v_debit_account, v_batch, v_exp.expense_date,
       0, v_vat, 'Net-of-VAT restatement of expense', 'correction', p_expense_id, auth.uid());
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'account_code'), '[]'::jsonb) INTO v_ledger_after
  FROM (
    SELECT jsonb_build_object(
      'account_code', coa.account_code,
      'account_name', coa.account_name,
      'debit', at.debit,
      'credit', at.credit,
      'batch_id', at.batch_id,
      'transaction_date', at.transaction_date
    ) AS x
    FROM account_transactions at
    LEFT JOIN chart_of_accounts coa ON coa.id = at.account_id
    WHERE at.reference_id = p_expense_id
      AND at.reference_type IN ('expense','correction')
      AND COALESCE(at.is_voided, false) = false
  ) s;

  INSERT INTO expense_vat_split_audit (
    tenant_id, restaurant_id, branch_id, expense_id, action, rate_percent,
    amount_before, net_before, vat_before, status_before,
    amount_after, net_after, vat_after, status_after,
    ledger_posted, batch_id, ledger_before, ledger_after, note, performed_by
  ) VALUES (
    v_exp.tenant_id, v_exp.restaurant_id, v_exp.branch_id, p_expense_id, 'applied', p_rate_percent,
    v_exp.amount, v_exp.net_amount, COALESCE(v_exp.vat_amount, 0), COALESCE(v_exp.vat_split_status, 'pending'),
    v_exp.amount, v_net, v_vat, 'applied',
    COALESCE(v_exp.ledger_posted, false), v_batch, v_ledger_before, v_ledger_after, p_note, auth.uid()
  );

  RETURN jsonb_build_object('ok', true, 'net', v_net, 'vat', v_vat, 'batch_id', v_batch);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_expense_vat_not_applicable(p_expense_id uuid, p_note text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_exp record;
  v_ledger jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner'::app_role, 'accountant'::app_role, 'manager'::app_role)
  ) THEN
    RAISE EXCEPTION 'Not allowed.';
  END IF;

  SELECT * INTO v_exp FROM expenses
  WHERE id = p_expense_id AND deleted_at IS NULL AND vat_split_status = 'pending';
  IF v_exp.id IS NULL THEN
    RETURN false;
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'account_code'), '[]'::jsonb) INTO v_ledger
  FROM (
    SELECT jsonb_build_object(
      'account_code', coa.account_code,
      'account_name', coa.account_name,
      'debit', at.debit,
      'credit', at.credit,
      'batch_id', at.batch_id,
      'transaction_date', at.transaction_date
    ) AS x
    FROM account_transactions at
    LEFT JOIN chart_of_accounts coa ON coa.id = at.account_id
    WHERE at.reference_id = p_expense_id
      AND at.reference_type IN ('expense','correction')
      AND COALESCE(at.is_voided, false) = false
  ) s;

  UPDATE expenses
  SET vat_split_status = 'not_applicable', updated_at = now()
  WHERE id = p_expense_id;

  INSERT INTO expense_vat_split_audit (
    tenant_id, restaurant_id, branch_id, expense_id, action, rate_percent,
    amount_before, net_before, vat_before, status_before,
    amount_after, net_after, vat_after, status_after,
    ledger_posted, batch_id, ledger_before, ledger_after, note, performed_by
  ) VALUES (
    v_exp.tenant_id, v_exp.restaurant_id, v_exp.branch_id, p_expense_id, 'marked_not_applicable', NULL,
    v_exp.amount, v_exp.net_amount, COALESCE(v_exp.vat_amount, 0), 'pending',
    v_exp.amount, v_exp.net_amount, COALESCE(v_exp.vat_amount, 0), 'not_applicable',
    COALESCE(v_exp.ledger_posted, false), NULL, v_ledger, v_ledger, p_note, auth.uid()
  );

  RETURN true;
END;
$function$;