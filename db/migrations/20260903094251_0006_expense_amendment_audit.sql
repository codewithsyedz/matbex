CREATE TABLE IF NOT EXISTS public.expense_amendment_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid,
  expense_id uuid NOT NULL,
  amended_by uuid,
  amended_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  changed_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  before_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  reversal_batch_id uuid,
  reversed_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  reversed_line_count integer NOT NULL DEFAULT 0,
  new_transaction_id uuid,
  new_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.expense_amendment_audit TO authenticated;
GRANT ALL ON public.expense_amendment_audit TO service_role;

ALTER TABLE public.expense_amendment_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members read expense amendment audit" ON public.expense_amendment_audit;
CREATE POLICY "Tenant members read expense amendment audit"
ON public.expense_amendment_audit
FOR SELECT
TO authenticated
USING (tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_expense_amendment_audit_expense
  ON public.expense_amendment_audit (expense_id, amended_at DESC);
CREATE INDEX IF NOT EXISTS idx_expense_amendment_audit_tenant
  ON public.expense_amendment_audit (tenant_id, amended_at DESC);

CREATE OR REPLACE FUNCTION public.amend_posted_expense(
  p_expense_id uuid,
  p_reason text,
  p_amount numeric DEFAULT NULL,
  p_vat_amount numeric DEFAULT NULL,
  p_expense_date date DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_account_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense RECORD;
  v_actor uuid := auth.uid();
  v_batch_id uuid;
  v_amount numeric;
  v_vat numeric;
  v_account uuid;
  v_new_tx uuid;
  v_rows int := 0;
  r RECORD;
  v_before jsonb;
  v_after jsonb;
  v_changed text[] := ARRAY[]::text[];
  v_reversed jsonb := '[]'::jsonb;
  v_new_lines jsonb := '[]'::jsonb;
  v_audit_id uuid;
  k text;
BEGIN
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: A reason is required to amend a posted expense';
  END IF;

  SELECT * INTO v_expense FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Expense not found';
  END IF;
  IF NOT COALESCE(v_expense.ledger_posted, false) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: This expense is not posted to the ledger — edit it normally';
  END IF;

  IF NOT (
    public.has_role(v_actor, 'owner'::app_role)
    OR public.has_role(v_actor, 'manager'::app_role)
    OR public.has_role(v_actor, 'accountant'::app_role)
    OR public.has_role(v_actor, 'superadmin'::app_role)
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Only owners, managers or accountants can amend a posted expense';
  END IF;

  v_amount := ROUND(COALESCE(p_amount, v_expense.amount), 2);
  v_vat := ROUND(COALESCE(p_vat_amount, v_expense.vat_amount, 0), 2);
  v_account := COALESCE(p_account_id, v_expense.account_id);

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Amended amount must be greater than zero';
  END IF;
  IF v_vat < 0 OR v_vat > v_amount + 0.005 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Amended VAT amount % is not valid for an expense of %', v_vat, v_amount;
  END IF;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Amended expense must have a Chart of Accounts mapping';
  END IF;

  v_before := jsonb_build_object(
    'amount', v_expense.amount,
    'vat_amount', COALESCE(v_expense.vat_amount, 0),
    'expense_date', v_expense.expense_date,
    'description', v_expense.description,
    'category_id', v_expense.category_id,
    'account_id', v_expense.account_id,
    'supplier_id', v_expense.supplier_id
  );
  v_after := jsonb_build_object(
    'amount', v_amount,
    'vat_amount', v_vat,
    'expense_date', COALESCE(p_expense_date, v_expense.expense_date),
    'description', COALESCE(p_description, v_expense.description),
    'category_id', COALESCE(p_category_id, v_expense.category_id),
    'account_id', v_account,
    'supplier_id', COALESCE(p_supplier_id, v_expense.supplier_id)
  );
  FOR k IN SELECT jsonb_object_keys(v_before) LOOP
    IF (v_before -> k) IS DISTINCT FROM (v_after -> k) THEN
      v_changed := v_changed || k;
    END IF;
  END LOOP;

  -- 2a. Reversing adjusting journal entry for the current posted footprint
  INSERT INTO public.journal_entry_batches (
    tenant_id, branch_id, batch_date, description, reference_number, entry_type,
    created_by, is_posted, posted_at, posted_by, journal_type,
    approval_status, approved_by, approved_at
  ) VALUES (
    v_expense.tenant_id, v_expense.branch_id,
    COALESCE(p_expense_date, v_expense.expense_date),
    'Adjusting reversal before amendment: ' || COALESCE(v_expense.description, v_expense.id::text)
      || ' — ' || btrim(p_reason),
    'EXPADJ-' || v_expense.id::text || '-' || to_char(now(), 'YYYYMMDDHH24MISS'),
    'reversal', v_actor, true, now(), v_actor, 'reversal', 'approved', v_actor, now()
  ) RETURNING id INTO v_batch_id;

  FOR r IN
    SELECT t.account_id,
           t.branch_id,
           ROUND(COALESCE(SUM(t.debit), 0) - COALESCE(SUM(t.credit), 0), 2) AS net
    FROM public.account_transactions t
    WHERE t.reference_type = 'expense'
      AND t.reference_id = p_expense_id
      AND COALESCE(t.is_voided, false) = false
      AND t.batch_id IS DISTINCT FROM v_batch_id
    GROUP BY t.account_id, t.branch_id
    HAVING ABS(ROUND(COALESCE(SUM(t.debit), 0) - COALESCE(SUM(t.credit), 0), 2)) > 0.005
  LOOP
    INSERT INTO public.account_transactions (
      tenant_id, account_id, transaction_date, debit, credit, description,
      reference_type, reference_id, created_by, branch_id, batch_id
    ) VALUES (
      v_expense.tenant_id, r.account_id,
      COALESCE(p_expense_date, v_expense.expense_date),
      CASE WHEN r.net < 0 THEN ABS(r.net) ELSE NULL END,
      CASE WHEN r.net > 0 THEN r.net ELSE NULL END,
      'Reversal before amendment — ' || COALESCE(v_expense.description, 'Expense'),
      'expense', p_expense_id, v_actor,
      COALESCE(r.branch_id, v_expense.branch_id), v_batch_id
    );
    v_rows := v_rows + 1;
  END LOOP;

  IF v_rows = 0 THEN
    DELETE FROM public.journal_entry_batches WHERE id = v_batch_id;
    v_batch_id := NULL;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'transaction_id', t.id,
             'account_id', t.account_id,
             'account_code', a.account_code,
             'account_name', a.account_name,
             'branch_id', t.branch_id,
             'debit', t.debit,
             'credit', t.credit,
             'transaction_date', t.transaction_date
           ) ORDER BY a.account_code), '[]'::jsonb)
      INTO v_reversed
      FROM public.account_transactions t
      LEFT JOIN public.chart_of_accounts a ON a.id = t.account_id
     WHERE t.batch_id = v_batch_id;
  END IF;

  BEGIN
    INSERT INTO public.expense_posting_audit (
      tenant_id, expense_id, branch_id, action, outcome, reason_code, reason_detail,
      batch_id, dr_total, cr_total, trigger_source, triggered_by
    )
    SELECT v_expense.tenant_id, p_expense_id, v_expense.branch_id, 'void', 'success',
           'amend_reversal', btrim(p_reason), v_batch_id,
           COALESCE(SUM(t.debit), 0), COALESCE(SUM(t.credit), 0), 'manual', v_actor
    FROM public.account_transactions t WHERE t.batch_id = v_batch_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 2b. Apply the amended values and re-post a fresh, balanced entry
  PERFORM set_config('matbex.expense_amend', 'on', true);

  UPDATE public.expenses
  SET amount = v_amount,
      vat_amount = v_vat,
      net_amount = ROUND(v_amount - v_vat, 2),
      expense_date = COALESCE(p_expense_date, expense_date),
      description = COALESCE(p_description, description),
      category_id = COALESCE(p_category_id, category_id),
      account_id = v_account,
      supplier_id = COALESCE(p_supplier_id, supplier_id),
      paid_amount = CASE WHEN COALESCE(status, 'unpaid') = 'paid' THEN v_amount ELSE LEAST(COALESCE(paid_amount, 0), v_amount) END,
      ledger_posted = false,
      ledger_transaction_id = NULL,
      updated_at = now()
  WHERE id = p_expense_id;

  v_new_tx := public.post_expense_to_ledger(p_expense_id, v_account);

  PERFORM set_config('matbex.expense_amend', 'off', true);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'transaction_id', t.id,
           'account_id', t.account_id,
           'account_code', a.account_code,
           'account_name', a.account_name,
           'branch_id', t.branch_id,
           'debit', t.debit,
           'credit', t.credit,
           'transaction_date', t.transaction_date
         ) ORDER BY a.account_code), '[]'::jsonb)
    INTO v_new_lines
    FROM public.account_transactions t
    LEFT JOIN public.chart_of_accounts a ON a.id = t.account_id
   WHERE t.reference_type = 'expense'
     AND t.reference_id = p_expense_id
     AND COALESCE(t.is_voided, false) = false
     AND (v_batch_id IS NULL OR t.batch_id IS DISTINCT FROM v_batch_id)
     AND t.created_at >= now() - interval '5 minutes';

  INSERT INTO public.expense_amendment_audit (
    tenant_id, branch_id, expense_id, amended_by, reason, changed_fields,
    before_values, after_values, reversal_batch_id, reversed_lines,
    reversed_line_count, new_transaction_id, new_lines
  ) VALUES (
    v_expense.tenant_id, v_expense.branch_id, p_expense_id, v_actor, btrim(p_reason), v_changed,
    v_before, v_after, v_batch_id, v_reversed, v_rows, v_new_tx, v_new_lines
  ) RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'expense_id', p_expense_id,
    'reversal_batch_id', v_batch_id,
    'reversed_lines', v_rows,
    'new_transaction_id', v_new_tx,
    'amount', v_amount,
    'vat_amount', v_vat,
    'audit_id', v_audit_id,
    'changed_fields', to_jsonb(v_changed)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.amend_posted_expense(uuid, text, numeric, numeric, date, text, uuid, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.amend_posted_expense(uuid, text, numeric, numeric, date, text, uuid, uuid, uuid) TO authenticated, service_role;