CREATE TABLE public.vat_remittances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  vat_return_id uuid REFERENCES public.vat_returns(id) ON DELETE SET NULL,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  period_start date,
  period_end date,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id),
  vat_account_id uuid REFERENCES public.chart_of_accounts(id),
  reference text,
  notes text,
  journal_batch_id uuid REFERENCES public.journal_entry_batches(id),
  is_voided boolean NOT NULL DEFAULT false,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vat_remittances TO authenticated;
GRANT ALL ON public.vat_remittances TO service_role;

ALTER TABLE public.vat_remittances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "VAT remittances viewable by tenant members"
ON public.vat_remittances FOR SELECT TO authenticated
USING (public.can_access_restaurant(tenant_id));

CREATE POLICY "VAT remittances manageable by owners/managers"
ON public.vat_remittances FOR ALL TO authenticated
USING (
  public.can_access_restaurant(tenant_id)
  AND (public.has_role(auth.uid(), tenant_id, 'owner'::app_role)
       OR public.has_role(auth.uid(), tenant_id, 'manager'::app_role))
)
WITH CHECK (
  public.can_access_restaurant(tenant_id)
  AND (public.has_role(auth.uid(), tenant_id, 'owner'::app_role)
       OR public.has_role(auth.uid(), tenant_id, 'manager'::app_role))
);

CREATE INDEX idx_vat_remittances_tenant_date ON public.vat_remittances (tenant_id, payment_date DESC);
CREATE INDEX idx_vat_remittances_return ON public.vat_remittances (vat_return_id) WHERE vat_return_id IS NOT NULL;

CREATE TRIGGER update_vat_remittances_updated_at
BEFORE UPDATE ON public.vat_remittances
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.post_vat_remittance(
  p_payment_date date,
  p_amount numeric,
  p_payment_account_id uuid,
  p_branch_id uuid DEFAULT NULL,
  p_vat_return_id uuid DEFAULT NULL,
  p_period_start date DEFAULT NULL,
  p_period_end date DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.get_user_tenant_id(auth.uid());
  v_vat_account_id uuid;
  v_batch_id uuid;
  v_remittance_id uuid;
  v_amount numeric(14,2);
  v_outstanding numeric(14,2);
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No tenant context';
  END IF;

  IF NOT (public.has_role(auth.uid(), v_tenant_id, 'owner'::app_role)
          OR public.has_role(auth.uid(), v_tenant_id, 'manager'::app_role)) THEN
    RAISE EXCEPTION 'Not authorised to record VAT remittances';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'VAT_REMITTANCE_ERROR: Payment amount must be greater than zero';
  END IF;

  v_amount := ROUND(p_amount, 2);

  SELECT id INTO v_vat_account_id
  FROM public.chart_of_accounts
  WHERE tenant_id = v_tenant_id AND account_code = '2200' AND is_active = true
  LIMIT 1;

  IF v_vat_account_id IS NULL THEN
    RAISE EXCEPTION 'VAT_CONFIG_ERROR: Account 2200 VAT Payable is missing or inactive. Add or reactivate it in the Chart of Accounts before recording a remittance.';
  END IF;

  PERFORM 1 FROM public.chart_of_accounts
  WHERE id = p_payment_account_id
    AND tenant_id = v_tenant_id
    AND is_active = true
    AND account_type = 'asset'::account_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VAT_REMITTANCE_ERROR: Select an active cash or bank (asset) account to pay the tax authority from.';
  END IF;

  SELECT ROUND(COALESCE(SUM(COALESCE(credit,0) - COALESCE(debit,0)), 0), 2)
  INTO v_outstanding
  FROM public.account_transactions
  WHERE tenant_id = v_tenant_id
    AND account_id = v_vat_account_id
    AND COALESCE(is_voided, false) = false
    AND (p_branch_id IS NULL OR branch_id = p_branch_id);

  IF v_amount > v_outstanding + 0.01 THEN
    RAISE EXCEPTION 'VAT_REMITTANCE_ERROR: Payment of % exceeds the outstanding VAT payable balance of %.', v_amount, v_outstanding;
  END IF;

  INSERT INTO public.journal_entry_batches (
    tenant_id, branch_id, description, batch_date, created_by,
    entry_type, journal_type, reference_number, is_posted, posted_at, posted_by
  ) VALUES (
    v_tenant_id, p_branch_id,
    'VAT remittance to tax authority - ' || p_payment_date::text || COALESCE(' / ' || p_reference, ''),
    p_payment_date, auth.uid(), 'adjustment', 'adjustment',
    COALESCE(p_reference, 'VAT-' || to_char(p_payment_date, 'YYYYMMDD')),
    true, now(), auth.uid()
  ) RETURNING id INTO v_batch_id;

  INSERT INTO public.account_transactions (
    tenant_id, branch_id, account_id, transaction_date, debit, description, reference_type, batch_id, created_by
  ) VALUES (
    v_tenant_id, p_branch_id, v_vat_account_id, p_payment_date, v_amount,
    'Clear VAT payable on remittance', 'vat_remittance', v_batch_id, auth.uid()
  );

  INSERT INTO public.account_transactions (
    tenant_id, branch_id, account_id, transaction_date, credit, description, reference_type, batch_id, created_by
  ) VALUES (
    v_tenant_id, p_branch_id, p_payment_account_id, p_payment_date, v_amount,
    'VAT paid to tax authority', 'vat_remittance', v_batch_id, auth.uid()
  );

  INSERT INTO public.vat_remittances (
    tenant_id, branch_id, vat_return_id, payment_date, period_start, period_end,
    amount, payment_account_id, vat_account_id, reference, notes, journal_batch_id, created_by
  ) VALUES (
    v_tenant_id, p_branch_id, p_vat_return_id, p_payment_date, p_period_start, p_period_end,
    v_amount, p_payment_account_id, v_vat_account_id, p_reference, p_notes, v_batch_id, auth.uid()
  ) RETURNING id INTO v_remittance_id;

  UPDATE public.account_transactions
  SET reference_id = v_remittance_id
  WHERE batch_id = v_batch_id;

  IF p_vat_return_id IS NOT NULL THEN
    UPDATE public.vat_returns
    SET status = 'paid', paid_at = COALESCE(paid_at, now()),
        sadad_number = COALESCE(sadad_number, p_reference)
    WHERE id = p_vat_return_id AND restaurant_id = v_tenant_id;
  END IF;

  RETURN v_remittance_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_vat_remittance(
  p_remittance_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.get_user_tenant_id(auth.uid());
  v_rem public.vat_remittances%ROWTYPE;
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No tenant context';
  END IF;

  IF NOT public.has_role(auth.uid(), v_tenant_id, 'owner'::app_role) THEN
    RAISE EXCEPTION 'Only owners can void a VAT remittance';
  END IF;

  SELECT * INTO v_rem FROM public.vat_remittances
  WHERE id = p_remittance_id AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VAT remittance not found';
  END IF;

  IF v_rem.is_voided THEN
    RAISE EXCEPTION 'This VAT remittance is already voided';
  END IF;

  UPDATE public.account_transactions
  SET is_voided = true, voided_at = now(), voided_by = auth.uid(),
      void_reason = COALESCE(p_reason, 'VAT remittance voided')
  WHERE batch_id = v_rem.journal_batch_id
    AND COALESCE(is_voided, false) = false;

  UPDATE public.vat_remittances
  SET is_voided = true, voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
  WHERE id = p_remittance_id;

  IF v_rem.vat_return_id IS NOT NULL THEN
    UPDATE public.vat_returns
    SET status = 'submitted', paid_at = NULL
    WHERE id = v_rem.vat_return_id AND restaurant_id = v_tenant_id AND status = 'paid';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_vat_remittance(date, numeric, uuid, uuid, uuid, date, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_vat_remittance(uuid, text) TO authenticated;