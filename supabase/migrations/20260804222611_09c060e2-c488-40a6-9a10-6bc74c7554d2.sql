-- 0. Helper: who may manage partner capital for a tenant
CREATE OR REPLACE FUNCTION public.can_manage_capital(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_superadmin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_tenant_roles utr
      WHERE utr.user_id = auth.uid()
        AND utr.tenant_id = _tenant_id
        AND utr.role IN ('owner', 'manager', 'accountant')
    );
$$;

CREATE OR REPLACE FUNCTION public.can_reverse_capital(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_superadmin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_tenant_roles utr
      WHERE utr.user_id = auth.uid()
        AND utr.tenant_id = _tenant_id
        AND utr.role IN ('owner', 'accountant')
    );
$$;

-- 1. Owner / partner capital accounts
CREATE TABLE public.owner_capital_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  partner_name text NOT NULL,
  bank_name text NOT NULL,
  account_last4 text NOT NULL CHECK (account_last4 ~ '^[0-9]{4}$'),
  equity_account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  opening_balance numeric(15,2) NOT NULL DEFAULT 0,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, equity_account_id)
);

CREATE INDEX idx_owner_capital_accounts_tenant ON public.owner_capital_accounts(tenant_id, is_active);
CREATE INDEX idx_owner_capital_accounts_branch ON public.owner_capital_accounts(tenant_id, branch_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_capital_accounts TO authenticated;
GRANT ALL ON public.owner_capital_accounts TO service_role;
ALTER TABLE public.owner_capital_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance roles view capital accounts"
ON public.owner_capital_accounts FOR SELECT TO authenticated
USING (public.can_manage_capital(tenant_id));

CREATE POLICY "Finance roles manage capital accounts"
ON public.owner_capital_accounts FOR ALL TO authenticated
USING (public.can_manage_capital(tenant_id))
WITH CHECK (public.can_manage_capital(tenant_id));

CREATE TRIGGER trg_owner_capital_accounts_updated_at
BEFORE UPDATE ON public.owner_capital_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Capital movements (injections / withdrawals)
CREATE TABLE public.capital_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  capital_account_id uuid NOT NULL REFERENCES public.owner_capital_accounts(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  counter_account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('injection', 'withdrawal')),
  movement_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  reference_number text,
  description text,
  batch_id uuid REFERENCES public.journal_entry_batches(id),
  is_reversed boolean NOT NULL DEFAULT false,
  reversed_at timestamptz,
  reversed_by uuid,
  reversal_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_capital_movements_account ON public.capital_movements(capital_account_id, movement_date DESC);
CREATE INDEX idx_capital_movements_tenant_branch ON public.capital_movements(tenant_id, branch_id, movement_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.capital_movements TO authenticated;
GRANT ALL ON public.capital_movements TO service_role;
ALTER TABLE public.capital_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance roles view capital movements"
ON public.capital_movements FOR SELECT TO authenticated
USING (public.can_manage_capital(tenant_id));

CREATE POLICY "Finance roles manage capital movements"
ON public.capital_movements FOR ALL TO authenticated
USING (public.can_manage_capital(tenant_id))
WITH CHECK (public.can_manage_capital(tenant_id));

CREATE TRIGGER trg_capital_movements_updated_at
BEFORE UPDATE ON public.capital_movements
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Create a capital account together with its equity CoA account
CREATE OR REPLACE FUNCTION public.create_owner_capital_account(
  p_tenant_id uuid,
  p_partner_name text,
  p_bank_name text,
  p_account_last4 text,
  p_branch_id uuid DEFAULT NULL,
  p_opening_balance numeric DEFAULT 0,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_account_id uuid;
  v_id uuid;
  v_name text;
BEGIN
  IF NOT public.can_manage_capital(p_tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only owners, managers or accountants can create capital accounts';
  END IF;

  IF p_account_last4 !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'INVALID_LAST4: account_last4 must be exactly 4 digits';
  END IF;

  SELECT lpad((COALESCE(MAX(account_code::int), 3400) + 1)::text, 4, '0')
  INTO v_code
  FROM public.chart_of_accounts
  WHERE tenant_id = p_tenant_id
    AND account_code ~ '^34[0-9]{2}$';

  IF v_code IS NULL OR v_code >= '3500' THEN
    RAISE EXCEPTION 'NO_CODE_AVAILABLE: partner capital code range 3401-3499 is exhausted';
  END IF;

  v_name := trim(p_partner_name) || ' - ' || trim(p_bank_name) || ' ..' || p_account_last4;

  INSERT INTO public.chart_of_accounts (tenant_id, account_code, account_name, account_type, description)
  VALUES (p_tenant_id, v_code, left(v_name, 100), 'equity',
          'Owner/partner capital account (bank ' || p_bank_name || ' ending ' || p_account_last4 || ')')
  RETURNING id INTO v_account_id;

  INSERT INTO public.owner_capital_accounts
    (tenant_id, branch_id, partner_name, bank_name, account_last4, equity_account_id, opening_balance, notes, created_by)
  VALUES
    (p_tenant_id, p_branch_id, trim(p_partner_name), trim(p_bank_name), p_account_last4,
     v_account_id, COALESCE(p_opening_balance, 0), p_notes, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 4. Post a capital movement to the ledger
CREATE OR REPLACE FUNCTION public.post_capital_movement(
  p_capital_account_id uuid,
  p_counter_account_id uuid,
  p_movement_type text,
  p_amount numeric,
  p_movement_date date DEFAULT CURRENT_DATE,
  p_branch_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_description text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_equity_account uuid;
  v_branch uuid;
  v_batch uuid;
  v_movement uuid;
  v_label text;
  v_desc text;
BEGIN
  SELECT tenant_id, equity_account_id, COALESCE(p_branch_id, branch_id),
         partner_name || ' - ' || bank_name || ' ..' || account_last4
  INTO v_tenant, v_equity_account, v_branch, v_label
  FROM public.owner_capital_accounts
  WHERE id = p_capital_account_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'CAPITAL_ACCOUNT_NOT_FOUND';
  END IF;

  IF NOT public.can_manage_capital(v_tenant) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only owners, managers or accountants can post capital movements';
  END IF;

  IF p_movement_type NOT IN ('injection', 'withdrawal') THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT_TYPE';
  END IF;

  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: amount must be greater than zero';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                 WHERE id = p_counter_account_id AND tenant_id = v_tenant AND is_active) THEN
    RAISE EXCEPTION 'INVALID_COUNTER_ACCOUNT';
  END IF;

  v_desc := COALESCE(NULLIF(trim(p_description), ''),
                     CASE WHEN p_movement_type = 'injection'
                          THEN 'Capital injection - ' || v_label
                          ELSE 'Capital withdrawal - ' || v_label END);

  INSERT INTO public.journal_entry_batches
    (tenant_id, batch_date, description, reference_number, entry_type, journal_type,
     created_by, is_posted, posted_at, posted_by, approval_status, approved_by, approved_at, branch_id)
  VALUES
    (v_tenant, p_movement_date, v_desc,
     COALESCE(p_reference_number, 'CAP-' || to_char(now(), 'YYYYMMDDHH24MISS')),
     'adjustment', 'adjustment', auth.uid(), true, now(), auth.uid(), 'approved', auth.uid(), now(), v_branch)
  RETURNING id INTO v_batch;

  INSERT INTO public.capital_movements
    (tenant_id, capital_account_id, branch_id, counter_account_id, movement_type,
     movement_date, amount, reference_number, description, batch_id, created_by)
  VALUES
    (v_tenant, p_capital_account_id, v_branch, p_counter_account_id, p_movement_type,
     p_movement_date, p_amount, p_reference_number, v_desc, v_batch, auth.uid())
  RETURNING id INTO v_movement;

  IF p_movement_type = 'injection' THEN
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES
      (v_tenant, p_counter_account_id, p_movement_date, p_amount, 0, v_desc,
       'capital_movement', v_movement, auth.uid(), v_batch, v_branch),
      (v_tenant, v_equity_account, p_movement_date, 0, p_amount, v_desc,
       'capital_movement', v_movement, auth.uid(), v_batch, v_branch);
  ELSE
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES
      (v_tenant, v_equity_account, p_movement_date, p_amount, 0, v_desc,
       'capital_movement', v_movement, auth.uid(), v_batch, v_branch),
      (v_tenant, p_counter_account_id, p_movement_date, 0, p_amount, v_desc,
       'capital_movement', v_movement, auth.uid(), v_batch, v_branch);
  END IF;

  RETURN v_movement;
END;
$$;

-- 5. Reverse a posted capital movement (never delete)
CREATE OR REPLACE FUNCTION public.reverse_capital_movement(
  p_movement_id uuid,
  p_reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m public.capital_movements%ROWTYPE;
  v_equity_account uuid;
  v_batch uuid;
  v_desc text;
BEGIN
  SELECT * INTO m FROM public.capital_movements WHERE id = p_movement_id;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'MOVEMENT_NOT_FOUND';
  END IF;
  IF m.is_reversed THEN
    RAISE EXCEPTION 'ALREADY_REVERSED';
  END IF;

  IF NOT public.can_reverse_capital(m.tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only owners or accountants can reverse capital movements';
  END IF;

  SELECT equity_account_id INTO v_equity_account
  FROM public.owner_capital_accounts WHERE id = m.capital_account_id;

  v_desc := 'Reversal - ' || COALESCE(m.description, 'capital movement')
            || COALESCE(' (' || NULLIF(trim(p_reason), '') || ')', '');

  INSERT INTO public.journal_entry_batches
    (tenant_id, batch_date, description, reference_number, entry_type, journal_type,
     created_by, is_posted, posted_at, posted_by, approval_status, approved_by, approved_at, branch_id)
  VALUES
    (m.tenant_id, CURRENT_DATE, v_desc, 'CAPREV-' || to_char(now(), 'YYYYMMDDHH24MISS'),
     'reversal', 'adjustment', auth.uid(), true, now(), auth.uid(), 'approved', auth.uid(), now(), m.branch_id)
  RETURNING id INTO v_batch;

  IF m.movement_type = 'injection' THEN
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES
      (m.tenant_id, v_equity_account, CURRENT_DATE, m.amount, 0, v_desc,
       'capital_movement_reversal', m.id, auth.uid(), v_batch, m.branch_id),
      (m.tenant_id, m.counter_account_id, CURRENT_DATE, 0, m.amount, v_desc,
       'capital_movement_reversal', m.id, auth.uid(), v_batch, m.branch_id);
  ELSE
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description,
       reference_type, reference_id, created_by, batch_id, branch_id)
    VALUES
      (m.tenant_id, m.counter_account_id, CURRENT_DATE, m.amount, 0, v_desc,
       'capital_movement_reversal', m.id, auth.uid(), v_batch, m.branch_id),
      (m.tenant_id, v_equity_account, CURRENT_DATE, 0, m.amount, v_desc,
       'capital_movement_reversal', m.id, auth.uid(), v_batch, m.branch_id);
  END IF;

  UPDATE public.capital_movements
  SET is_reversed = true, reversed_at = now(), reversed_by = auth.uid(), reversal_reason = p_reason
  WHERE id = m.id;

  RETURN v_batch;
END;
$$;