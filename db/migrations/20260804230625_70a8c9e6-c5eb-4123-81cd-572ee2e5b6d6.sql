-- 1. Seed 1015 Card Settlements Receivable for every tenant that lacks it
INSERT INTO public.chart_of_accounts (tenant_id, account_code, account_name, account_type, description, is_system_account, is_active)
SELECT DISTINCT c.tenant_id, '1015', 'Card Settlements Receivable', 'asset'::account_type,
       'Card takings held until the acquirer payout lands in the bank', true, true
FROM public.chart_of_accounts c
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts x
  WHERE x.tenant_id = c.tenant_id AND x.account_code = '1015'
);

-- 2. Route card sales to 1015 (fallback to bank when not configured)
CREATE OR REPLACE FUNCTION public.post_daily_sales_to_ledger(p_sales_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sales RECORD;
  v_batch_id uuid;
  v_cash_account_id uuid;
  v_bank_account_id uuid;
  v_card_clearing_id uuid;
  v_ar_account_id uuid;
  v_revenue_account_id uuid;
  v_delivery_revenue_id uuid;
BEGIN
  SELECT * INTO v_sales FROM daily_sales_summary WHERE id = p_sales_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales record not found';
  END IF;
  IF v_sales.ledger_posted THEN
    RAISE EXCEPTION 'Sales already posted to ledger';
  END IF;

  SELECT id INTO v_cash_account_id FROM chart_of_accounts
  WHERE tenant_id = v_sales.tenant_id AND account_code = '1000' AND is_active = true LIMIT 1;
  SELECT id INTO v_bank_account_id FROM chart_of_accounts
  WHERE tenant_id = v_sales.tenant_id AND account_code = '1010' AND is_active = true LIMIT 1;
  SELECT id INTO v_card_clearing_id FROM chart_of_accounts
  WHERE tenant_id = v_sales.tenant_id AND account_code = '1015' AND is_active = true LIMIT 1;
  SELECT id INTO v_ar_account_id FROM chart_of_accounts
  WHERE tenant_id = v_sales.tenant_id AND account_code = '1100' AND is_active = true LIMIT 1;
  SELECT id INTO v_revenue_account_id FROM chart_of_accounts
  WHERE tenant_id = v_sales.tenant_id AND account_code = '4000' AND is_active = true LIMIT 1;
  SELECT id INTO v_delivery_revenue_id FROM chart_of_accounts
  WHERE tenant_id = v_sales.tenant_id AND account_code = '4100' AND is_active = true LIMIT 1;

  IF v_delivery_revenue_id IS NULL THEN
    v_delivery_revenue_id := v_revenue_account_id;
  END IF;
  IF v_card_clearing_id IS NULL THEN
    v_card_clearing_id := v_bank_account_id;
  END IF;

  IF v_cash_account_id IS NULL OR v_bank_account_id IS NULL OR v_revenue_account_id IS NULL THEN
    RAISE EXCEPTION 'Required COA accounts not configured for tenant';
  END IF;

  INSERT INTO journal_entry_batches (
    tenant_id, description, batch_date, created_by, entry_type, journal_type,
    is_posted, posted_at, posted_by
  )
  VALUES (
    v_sales.tenant_id,
    'Daily Sales - ' || v_sales.sales_date::text,
    v_sales.sales_date,
    v_sales.created_by,
    'adjustment',
    'adjustment',
    true,
    now(),
    v_sales.created_by
  )
  RETURNING id INTO v_batch_id;

  IF v_sales.cash_sales > 0 THEN
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_cash_account_id, v_sales.sales_date, v_sales.cash_sales, 'Cash Sales - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;

  IF v_sales.card_sales > 0 THEN
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_card_clearing_id, v_sales.sales_date, v_sales.card_sales, 'Card Sales (awaiting settlement) - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;

  IF v_sales.delivery_sales > 0 THEN
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_ar_account_id, v_sales.sales_date, v_sales.delivery_sales, 'Delivery Sales Receivable - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;

  IF v_sales.other_sales > 0 THEN
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_cash_account_id, v_sales.sales_date, v_sales.other_sales, 'Other Sales - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;

  IF (v_sales.cash_sales + v_sales.card_sales + v_sales.other_sales) > 0 THEN
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, credit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_revenue_account_id, v_sales.sales_date,
            v_sales.cash_sales + v_sales.card_sales + v_sales.other_sales,
            'Sales Revenue - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;

  IF v_sales.delivery_sales > 0 THEN
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, credit, description, reference_type, reference_id, batch_id)
    VALUES (v_sales.tenant_id, v_delivery_revenue_id, v_sales.sales_date, v_sales.delivery_sales,
            'Delivery Revenue - ' || v_sales.sales_date, 'sale', p_sales_id, v_batch_id);
  END IF;

  UPDATE daily_sales_summary
  SET ledger_posted = true,
      ledger_posted_at = now(),
      ledger_batch_id = v_batch_id
  WHERE id = p_sales_id;

  RETURN v_batch_id;
END;
$function$;

-- 3. Role helper for card settlements
CREATE OR REPLACE FUNCTION public.can_reverse_card_settlement(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.is_superadmin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_tenant_roles utr
      WHERE utr.user_id = auth.uid()
        AND utr.tenant_id = _tenant_id
        AND utr.role IN ('owner', 'accountant')
    );
$function$;

-- 4. Deposits table
CREATE TABLE public.card_settlement_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid REFERENCES public.branches(id),
  deposit_date date NOT NULL,
  period_from date,
  period_to date,
  gross_amount numeric(14,2) NOT NULL CHECK (gross_amount > 0),
  fee_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  net_amount numeric(14,2) NOT NULL CHECK (net_amount >= 0),
  bank_account_id uuid REFERENCES public.chart_of_accounts(id),
  reference text,
  notes text,
  journal_batch_id uuid REFERENCES public.journal_entry_batches(id),
  is_reversed boolean NOT NULL DEFAULT false,
  reversed_at timestamptz,
  reversed_by uuid,
  reversal_reason text,
  reversal_batch_id uuid REFERENCES public.journal_entry_batches(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.card_settlement_deposits TO authenticated;
GRANT ALL ON public.card_settlement_deposits TO service_role;

ALTER TABLE public.card_settlement_deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance roles can view card deposits"
ON public.card_settlement_deposits FOR SELECT TO authenticated
USING (public.can_manage_capital(tenant_id));

CREATE POLICY "Finance roles can record card deposits"
ON public.card_settlement_deposits FOR INSERT TO authenticated
WITH CHECK (public.can_manage_capital(tenant_id));

CREATE POLICY "Senior finance roles can update card deposits"
ON public.card_settlement_deposits FOR UPDATE TO authenticated
USING (public.can_reverse_card_settlement(tenant_id))
WITH CHECK (public.can_reverse_card_settlement(tenant_id));

CREATE TRIGGER update_card_settlement_deposits_updated_at
BEFORE UPDATE ON public.card_settlement_deposits
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_card_settlement_deposits_tenant_date
ON public.card_settlement_deposits (tenant_id, deposit_date DESC);

-- 5. Post a deposit: DR bank (net) + DR bank charges (fee) / CR 1015 (gross)
CREATE OR REPLACE FUNCTION public.post_card_settlement_deposit(
  p_deposit_date date,
  p_gross_amount numeric,
  p_fee_amount numeric DEFAULT 0,
  p_branch_id uuid DEFAULT NULL,
  p_bank_account_id uuid DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_period_from date DEFAULT NULL,
  p_period_to date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid := public.get_user_tenant_id(auth.uid());
  v_bank_id uuid := p_bank_account_id;
  v_clearing_id uuid;
  v_fee_id uuid;
  v_batch_id uuid;
  v_deposit_id uuid;
  v_net numeric(14,2);
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No tenant context';
  END IF;
  IF NOT public.can_manage_capital(v_tenant_id) THEN
    RAISE EXCEPTION 'Not authorised to record card settlement deposits';
  END IF;
  IF p_gross_amount IS NULL OR p_gross_amount <= 0 THEN
    RAISE EXCEPTION 'Gross amount must be greater than zero';
  END IF;
  IF COALESCE(p_fee_amount, 0) < 0 OR COALESCE(p_fee_amount, 0) > p_gross_amount THEN
    RAISE EXCEPTION 'Acquirer fee must be between zero and the gross amount';
  END IF;

  v_net := ROUND(p_gross_amount - COALESCE(p_fee_amount, 0), 2);

  SELECT id INTO v_clearing_id FROM chart_of_accounts
  WHERE tenant_id = v_tenant_id AND account_code = '1015' AND is_active = true LIMIT 1;
  IF v_clearing_id IS NULL THEN
    RAISE EXCEPTION 'Card Settlements Receivable (1015) is not configured';
  END IF;

  IF v_bank_id IS NULL THEN
    SELECT id INTO v_bank_id FROM chart_of_accounts
    WHERE tenant_id = v_tenant_id AND account_code = '1010' AND is_active = true LIMIT 1;
  ELSE
    PERFORM 1 FROM chart_of_accounts
    WHERE id = v_bank_id AND tenant_id = v_tenant_id AND is_active = true AND account_type = 'asset'::account_type;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid bank account selected';
    END IF;
  END IF;
  IF v_bank_id IS NULL THEN
    RAISE EXCEPTION 'Bank account (1010) is not configured';
  END IF;

  SELECT id INTO v_fee_id FROM chart_of_accounts
  WHERE tenant_id = v_tenant_id AND account_code = '6620' AND is_active = true LIMIT 1;
  IF COALESCE(p_fee_amount, 0) > 0 AND v_fee_id IS NULL THEN
    RAISE EXCEPTION 'Bank Charges (6620) is not configured';
  END IF;

  INSERT INTO journal_entry_batches (
    tenant_id, branch_id, description, batch_date, created_by, entry_type, journal_type,
    is_posted, posted_at, posted_by
  ) VALUES (
    v_tenant_id, p_branch_id,
    'Card settlement deposit - ' || p_deposit_date::text || COALESCE(' / ' || p_reference, ''),
    p_deposit_date, auth.uid(), 'adjustment', 'adjustment', true, now(), auth.uid()
  ) RETURNING id INTO v_batch_id;

  IF v_net > 0 THEN
    INSERT INTO account_transactions (tenant_id, branch_id, account_id, transaction_date, debit, description, reference_type, batch_id, created_by)
    VALUES (v_tenant_id, p_branch_id, v_bank_id, p_deposit_date, v_net, 'Acquirer payout received', 'card_settlement', v_batch_id, auth.uid());
  END IF;

  IF COALESCE(p_fee_amount, 0) > 0 THEN
    INSERT INTO account_transactions (tenant_id, branch_id, account_id, transaction_date, debit, description, reference_type, batch_id, created_by)
    VALUES (v_tenant_id, p_branch_id, v_fee_id, p_deposit_date, ROUND(p_fee_amount, 2), 'Acquirer / card processing fee', 'card_settlement', v_batch_id, auth.uid());
  END IF;

  INSERT INTO account_transactions (tenant_id, branch_id, account_id, transaction_date, credit, description, reference_type, batch_id, created_by)
  VALUES (v_tenant_id, p_branch_id, v_clearing_id, p_deposit_date, ROUND(p_gross_amount, 2), 'Clear card settlements receivable', 'card_settlement', v_batch_id, auth.uid());

  INSERT INTO card_settlement_deposits (
    tenant_id, branch_id, deposit_date, period_from, period_to, gross_amount, fee_amount,
    net_amount, bank_account_id, reference, notes, journal_batch_id, created_by
  ) VALUES (
    v_tenant_id, p_branch_id, p_deposit_date, p_period_from, p_period_to,
    ROUND(p_gross_amount, 2), ROUND(COALESCE(p_fee_amount, 0), 2), v_net,
    v_bank_id, p_reference, p_notes, v_batch_id, auth.uid()
  ) RETURNING id INTO v_deposit_id;

  UPDATE account_transactions SET reference_id = v_deposit_id WHERE batch_id = v_batch_id;

  RETURN v_deposit_id;
END;
$function$;

-- 6. Reverse a deposit with a mirrored entry
CREATE OR REPLACE FUNCTION public.reverse_card_settlement_deposit(
  p_deposit_id uuid,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid := public.get_user_tenant_id(auth.uid());
  v_dep RECORD;
  v_batch_id uuid;
  v_line RECORD;
BEGIN
  IF v_tenant_id IS NULL OR NOT public.can_reverse_card_settlement(v_tenant_id) THEN
    RAISE EXCEPTION 'Only owners, accountants or superadmins can reverse a card settlement deposit';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'A reversal reason is required';
  END IF;

  SELECT * INTO v_dep FROM card_settlement_deposits
  WHERE id = p_deposit_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deposit not found';
  END IF;
  IF v_dep.is_reversed THEN
    RAISE EXCEPTION 'Deposit already reversed';
  END IF;

  INSERT INTO journal_entry_batches (
    tenant_id, branch_id, description, batch_date, created_by, entry_type, journal_type,
    is_posted, posted_at, posted_by
  ) VALUES (
    v_tenant_id, v_dep.branch_id,
    'Reversal of card settlement deposit - ' || v_dep.deposit_date::text,
    CURRENT_DATE, auth.uid(), 'reversal', 'adjustment', true, now(), auth.uid()
  ) RETURNING id INTO v_batch_id;

  FOR v_line IN
    SELECT * FROM account_transactions WHERE batch_id = v_dep.journal_batch_id
  LOOP
    INSERT INTO account_transactions (tenant_id, branch_id, account_id, transaction_date, debit, credit, description, reference_type, reference_id, batch_id, created_by)
    VALUES (v_tenant_id, v_line.branch_id, v_line.account_id, CURRENT_DATE,
            v_line.credit, v_line.debit,
            'Reversal: ' || COALESCE(v_line.description, ''), 'card_settlement_reversal', p_deposit_id, v_batch_id, auth.uid());
  END LOOP;

  UPDATE card_settlement_deposits
  SET is_reversed = true, reversed_at = now(), reversed_by = auth.uid(),
      reversal_reason = p_reason, reversal_batch_id = v_batch_id
  WHERE id = p_deposit_id;

  RETURN v_batch_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.post_card_settlement_deposit(date, numeric, numeric, uuid, uuid, text, text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_card_settlement_deposit(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_reverse_card_settlement(uuid) TO authenticated;