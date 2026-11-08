-- 1. Seed the daily overhead expense account (6995) for tenants that already have a COA
INSERT INTO public.chart_of_accounts (tenant_id, account_code, account_name, account_type, is_active)
SELECT DISTINCT c.tenant_id, '6995', 'Daily Overhead Allocation', 'expense'::account_type, true
FROM public.chart_of_accounts c
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts x
  WHERE x.tenant_id = c.tenant_id AND x.account_code = '6995'
);

INSERT INTO public.chart_of_accounts (tenant_id, account_code, account_name, account_type, is_active)
SELECT DISTINCT c.tenant_id, '2100', 'Accrued Expenses', 'liability'::account_type, true
FROM public.chart_of_accounts c
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts x
  WHERE x.tenant_id = c.tenant_id AND x.account_code = '2100'
);

-- 2. Settings
CREATE TABLE public.daily_overhead_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  debit_account_id uuid REFERENCES public.chart_of_accounts(id),
  credit_account_id uuid REFERENCES public.chart_of_accounts(id),
  auto_post boolean NOT NULL DEFAULT true,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX daily_overhead_settings_scope_uidx
  ON public.daily_overhead_settings (restaurant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_overhead_settings TO authenticated;
GRANT ALL ON public.daily_overhead_settings TO service_role;
ALTER TABLE public.daily_overhead_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View daily overhead settings" ON public.daily_overhead_settings
FOR SELECT TO authenticated USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "Finance can manage daily overhead settings" ON public.daily_overhead_settings
FOR ALL TO authenticated
USING (
  public.can_access_restaurant(restaurant_id) AND (
    public.has_role(auth.uid(), restaurant_id, 'owner') OR
    public.has_role(auth.uid(), restaurant_id, 'manager') OR
    public.has_role(auth.uid(), restaurant_id, 'accountant') OR
    public.has_role(auth.uid(), restaurant_id, 'superadmin')
  )
)
WITH CHECK (
  public.can_access_restaurant(restaurant_id) AND (
    public.has_role(auth.uid(), restaurant_id, 'owner') OR
    public.has_role(auth.uid(), restaurant_id, 'manager') OR
    public.has_role(auth.uid(), restaurant_id, 'accountant') OR
    public.has_role(auth.uid(), restaurant_id, 'superadmin')
  )
);

-- 3. Closures
CREATE TABLE public.daily_overhead_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  business_date date NOT NULL,
  overhead_amount numeric(14,2) NOT NULL CHECK (overhead_amount >= 0),
  original_amount numeric(14,2),
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'finalized'
    CHECK (status IN ('draft','finalized','posted','posting_failed','adjusted','reopened')),
  gl_reference text NOT NULL,
  batch_id uuid REFERENCES public.journal_entry_batches(id),
  posted_at timestamptz,
  posting_error text,
  finalized_by uuid,
  finalized_at timestamptz,
  reopened_by uuid,
  reopened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: one live closure per business date + branch scope
CREATE UNIQUE INDEX daily_overhead_closures_date_uidx
  ON public.daily_overhead_closures (restaurant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), business_date);
CREATE UNIQUE INDEX daily_overhead_closures_ref_uidx
  ON public.daily_overhead_closures (tenant_id, gl_reference);
CREATE INDEX daily_overhead_closures_lookup_idx
  ON public.daily_overhead_closures (restaurant_id, business_date DESC, status);

GRANT SELECT, INSERT, UPDATE ON public.daily_overhead_closures TO authenticated;
GRANT ALL ON public.daily_overhead_closures TO service_role;
ALTER TABLE public.daily_overhead_closures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View daily overhead closures" ON public.daily_overhead_closures
FOR SELECT TO authenticated USING (public.can_access_restaurant(restaurant_id));

-- 4. Audit trail
CREATE TABLE public.daily_overhead_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  closure_id uuid NOT NULL REFERENCES public.daily_overhead_closures(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  action text NOT NULL,
  amount_before numeric(14,2),
  amount_after numeric(14,2),
  batch_id uuid,
  gl_reference text,
  reason text,
  error_message text,
  performed_by uuid,
  performed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX daily_overhead_audit_closure_idx ON public.daily_overhead_audit (closure_id, performed_at DESC);

GRANT SELECT ON public.daily_overhead_audit TO authenticated;
GRANT ALL ON public.daily_overhead_audit TO service_role;
ALTER TABLE public.daily_overhead_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View daily overhead audit" ON public.daily_overhead_audit
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.daily_overhead_closures c
  WHERE c.id = closure_id AND public.can_access_restaurant(c.restaurant_id)
));

-- 5. Permission helper
CREATE OR REPLACE FUNCTION public.can_manage_daily_overhead(_restaurant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), _restaurant_id, 'owner')
      OR public.has_role(auth.uid(), _restaurant_id, 'manager')
      OR public.has_role(auth.uid(), _restaurant_id, 'accountant')
      OR public.has_role(auth.uid(), _restaurant_id, 'superadmin');
$$;

-- 6. Immutability guard: block direct writes to finalized/posted closures
CREATE OR REPLACE FUNCTION public.protect_daily_overhead_closure()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DAILY_OVERHEAD_IMMUTABLE: closures cannot be deleted; use an authorised adjustment/reversal';
  END IF;

  IF current_setting('app.daily_overhead_ctx', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'DAILY_OVERHEAD_LOCKED: use finalize_daily_overhead() to create a closure';
  END IF;

  IF OLD.status IN ('finalized','posted','posting_failed','adjusted') THEN
    RAISE EXCEPTION 'DAILY_OVERHEAD_LOCKED: business date % is finalized and read-only', OLD.business_date
      USING HINT = 'Reopen the day or post an authorised adjustment instead.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_daily_overhead_closure
BEFORE INSERT OR UPDATE OR DELETE ON public.daily_overhead_closures
FOR EACH ROW EXECUTE FUNCTION public.protect_daily_overhead_closure();

-- 7. Resolve accounts for a scope
CREATE OR REPLACE FUNCTION public.resolve_daily_overhead_accounts(_restaurant_id uuid, _branch_id uuid)
RETURNS TABLE (debit_account_id uuid, credit_account_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_debit uuid;
  v_credit uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.restaurants WHERE id = _restaurant_id;

  SELECT s.debit_account_id, s.credit_account_id INTO v_debit, v_credit
  FROM public.daily_overhead_settings s
  WHERE s.restaurant_id = _restaurant_id
    AND (s.branch_id = _branch_id OR (s.branch_id IS NULL AND _branch_id IS NULL))
  LIMIT 1;

  IF v_debit IS NULL AND _branch_id IS NOT NULL THEN
    SELECT s.debit_account_id, s.credit_account_id INTO v_debit, v_credit
    FROM public.daily_overhead_settings s
    WHERE s.restaurant_id = _restaurant_id AND s.branch_id IS NULL
    LIMIT 1;
  END IF;

  IF v_debit IS NULL THEN
    SELECT id INTO v_debit FROM public.chart_of_accounts
    WHERE tenant_id = v_tenant AND account_code = '6995' AND is_active = true LIMIT 1;
  END IF;
  IF v_credit IS NULL THEN
    SELECT id INTO v_credit FROM public.chart_of_accounts
    WHERE tenant_id = v_tenant AND account_code = '2100' AND is_active = true LIMIT 1;
  END IF;

  RETURN QUERY SELECT v_debit, v_credit;
END;
$$;

-- 8. Finalize the day (locks the amount; does not post)
CREATE OR REPLACE FUNCTION public.finalize_daily_overhead(
  p_restaurant_id uuid,
  p_business_date date,
  p_amount numeric,
  p_branch_id uuid DEFAULT NULL,
  p_breakdown jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_existing public.daily_overhead_closures%ROWTYPE;
  v_ref text;
  v_id uuid;
BEGIN
  IF p_business_date IS NULL THEN
    RAISE EXCEPTION 'A valid business date is required';
  END IF;
  IF p_business_date > (now() AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'Cannot finalize a future business date';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Overhead amount must be zero or greater';
  END IF;
  IF NOT public.can_manage_daily_overhead(p_restaurant_id) THEN
    RAISE EXCEPTION 'Not authorised to finalize the day''s overhead';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.restaurants WHERE id = p_restaurant_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Restaurant not found';
  END IF;

  SELECT * INTO v_existing FROM public.daily_overhead_closures
  WHERE restaurant_id = p_restaurant_id
    AND business_date = p_business_date
    AND COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(p_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  FOR UPDATE;

  v_ref := 'OH-' || to_char(p_business_date, 'YYYYMMDD')
           || COALESCE('-' || UPPER(SUBSTRING(REPLACE(p_branch_id::text, '-', '') FROM 1 FOR 6)), '');

  PERFORM set_config('app.daily_overhead_ctx', 'on', true);

  IF FOUND THEN
    IF v_existing.status IN ('finalized','posted','posting_failed','adjusted') THEN
      -- Idempotent: already finalized
      PERFORM set_config('app.daily_overhead_ctx', 'off', true);
      RETURN v_existing.id;
    END IF;

    UPDATE public.daily_overhead_closures
    SET overhead_amount = ROUND(p_amount, 2),
        original_amount = COALESCE(original_amount, ROUND(p_amount, 2)),
        breakdown = COALESCE(p_breakdown, '{}'::jsonb),
        status = 'finalized',
        finalized_by = auth.uid(),
        finalized_at = now(),
        posting_error = NULL,
        updated_at = now()
    WHERE id = v_existing.id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.daily_overhead_closures (
      tenant_id, restaurant_id, branch_id, business_date, overhead_amount, original_amount,
      breakdown, status, gl_reference, finalized_by, finalized_at
    ) VALUES (
      v_tenant, p_restaurant_id, p_branch_id, p_business_date, ROUND(p_amount, 2), ROUND(p_amount, 2),
      COALESCE(p_breakdown, '{}'::jsonb), 'finalized', v_ref, auth.uid(), now()
    )
    RETURNING id INTO v_id;
  END IF;

  PERFORM set_config('app.daily_overhead_ctx', 'off', true);

  INSERT INTO public.daily_overhead_audit (
    tenant_id, closure_id, business_date, action, amount_after, gl_reference, performed_by
  ) VALUES (v_tenant, v_id, p_business_date, 'finalized', ROUND(p_amount, 2), v_ref, auth.uid());

  RETURN v_id;
END;
$$;

-- 9. Post the finalized overhead to the GL (idempotent)
CREATE OR REPLACE FUNCTION public.post_daily_overhead(p_closure_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c public.daily_overhead_closures%ROWTYPE;
  v_debit uuid;
  v_credit uuid;
  v_batch uuid;
BEGIN
  SELECT * INTO c FROM public.daily_overhead_closures WHERE id = p_closure_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Closure not found';
  END IF;
  IF NOT public.can_manage_daily_overhead(c.restaurant_id) THEN
    RAISE EXCEPTION 'Not authorised to post daily overhead';
  END IF;

  -- Idempotency guard: never post the same business date twice
  IF c.status = 'posted' AND c.batch_id IS NOT NULL THEN
    RETURN c.batch_id;
  END IF;
  IF c.status NOT IN ('finalized','posting_failed','adjusted') THEN
    RAISE EXCEPTION 'Day must be finalized before posting';
  END IF;

  SELECT b.id INTO v_batch FROM public.journal_entry_batches b
  WHERE b.tenant_id = c.tenant_id AND b.reference_number = c.gl_reference LIMIT 1;
  IF v_batch IS NOT NULL THEN
    PERFORM set_config('app.daily_overhead_ctx', 'on', true);
    UPDATE public.daily_overhead_closures
    SET status = 'posted', batch_id = v_batch, posted_at = COALESCE(posted_at, now()),
        posting_error = NULL, updated_at = now()
    WHERE id = c.id;
    PERFORM set_config('app.daily_overhead_ctx', 'off', true);
    RETURN v_batch;
  END IF;

  IF c.overhead_amount <= 0 THEN
    RAISE EXCEPTION 'Nothing to post: overhead amount is zero';
  END IF;

  SELECT r.debit_account_id, r.credit_account_id INTO v_debit, v_credit
  FROM public.resolve_daily_overhead_accounts(c.restaurant_id, c.branch_id) r;

  IF v_debit IS NULL OR v_credit IS NULL THEN
    PERFORM set_config('app.daily_overhead_ctx', 'on', true);
    UPDATE public.daily_overhead_closures
    SET status = 'posting_failed',
        posting_error = 'Overhead accounts are not configured (need a daily overhead expense account and an accrual account)',
        updated_at = now()
    WHERE id = c.id;
    PERFORM set_config('app.daily_overhead_ctx', 'off', true);
    INSERT INTO public.daily_overhead_audit (tenant_id, closure_id, business_date, action, error_message, performed_by)
    VALUES (c.tenant_id, c.id, c.business_date, 'post_failed', 'Overhead accounts are not configured', auth.uid());
    RAISE EXCEPTION 'Overhead accounts are not configured for this branch';
  END IF;

  INSERT INTO public.journal_entry_batches (
    tenant_id, branch_id, description, batch_date, reference_number, created_by,
    entry_type, journal_type, is_posted, posted_at, posted_by, approval_status
  ) VALUES (
    c.tenant_id, c.branch_id, 'Daily Overhead Allocation', c.business_date, c.gl_reference,
    COALESCE(auth.uid(), c.finalized_by), 'adjustment', 'adjustment', true, now(),
    COALESCE(auth.uid(), c.finalized_by), 'approved'
  ) RETURNING id INTO v_batch;

  INSERT INTO public.account_transactions (
    tenant_id, branch_id, account_id, transaction_date, debit, credit, description,
    reference_type, reference_id, created_by, batch_id
  ) VALUES
  (c.tenant_id, c.branch_id, v_debit, c.business_date, c.overhead_amount, 0,
   'Daily Overhead Allocation ' || c.gl_reference, 'daily_overhead', c.id, COALESCE(auth.uid(), c.finalized_by), v_batch),
  (c.tenant_id, c.branch_id, v_credit, c.business_date, 0, c.overhead_amount,
   'Daily Overhead Allocation ' || c.gl_reference, 'daily_overhead', c.id, COALESCE(auth.uid(), c.finalized_by), v_batch);

  PERFORM set_config('app.daily_overhead_ctx', 'on', true);
  UPDATE public.daily_overhead_closures
  SET status = 'posted', batch_id = v_batch, posted_at = now(), posting_error = NULL, updated_at = now()
  WHERE id = c.id;
  PERFORM set_config('app.daily_overhead_ctx', 'off', true);

  INSERT INTO public.daily_overhead_audit (
    tenant_id, closure_id, business_date, action, amount_after, batch_id, gl_reference, performed_by
  ) VALUES (c.tenant_id, c.id, c.business_date, 'posted', c.overhead_amount, v_batch, c.gl_reference, auth.uid());

  RETURN v_batch;
END;
$$;

-- 10. Finalize + post in one call
CREATE OR REPLACE FUNCTION public.close_business_day_overhead(
  p_restaurant_id uuid,
  p_business_date date,
  p_amount numeric,
  p_branch_id uuid DEFAULT NULL,
  p_breakdown jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_auto boolean := true;
BEGIN
  v_id := public.finalize_daily_overhead(p_restaurant_id, p_business_date, p_amount, p_branch_id, p_breakdown);

  SELECT COALESCE(s.auto_post, true) INTO v_auto
  FROM public.daily_overhead_settings s
  WHERE s.restaurant_id = p_restaurant_id
    AND (s.branch_id = p_branch_id OR (s.branch_id IS NULL AND p_branch_id IS NULL))
  LIMIT 1;

  IF COALESCE(v_auto, true) THEN
    BEGIN
      PERFORM public.post_daily_overhead(v_id);
    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('app.daily_overhead_ctx', 'on', true);
      UPDATE public.daily_overhead_closures
      SET status = 'posting_failed', posting_error = SQLERRM, updated_at = now()
      WHERE id = v_id AND status <> 'posted';
      PERFORM set_config('app.daily_overhead_ctx', 'off', true);

      INSERT INTO public.daily_overhead_audit (tenant_id, closure_id, business_date, action, error_message, performed_by)
      SELECT tenant_id, id, business_date, 'post_failed', SQLERRM, auth.uid()
      FROM public.daily_overhead_closures WHERE id = v_id;
    END;
  END IF;

  RETURN v_id;
END;
$$;

-- 11. Reopen a finalized (not yet posted) day
CREATE OR REPLACE FUNCTION public.reopen_daily_overhead(p_closure_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c public.daily_overhead_closures%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.daily_overhead_closures WHERE id = p_closure_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Closure not found'; END IF;
  IF NOT public.can_manage_daily_overhead(c.restaurant_id) THEN
    RAISE EXCEPTION 'Not authorised to reopen a finalized day';
  END IF;
  IF COALESCE(p_reason, '') = '' THEN
    RAISE EXCEPTION 'A reason is required to reopen a finalized day';
  END IF;
  IF c.status = 'posted' THEN
    RAISE EXCEPTION 'This day is already posted to the ledger; use an authorised adjustment instead';
  END IF;

  PERFORM set_config('app.daily_overhead_ctx', 'on', true);
  UPDATE public.daily_overhead_closures
  SET status = 'draft', reopened_by = auth.uid(), reopened_at = now(),
      posting_error = NULL, updated_at = now()
  WHERE id = c.id;
  PERFORM set_config('app.daily_overhead_ctx', 'off', true);

  INSERT INTO public.daily_overhead_audit (tenant_id, closure_id, business_date, action, amount_before, reason, performed_by)
  VALUES (c.tenant_id, c.id, c.business_date, 'reopened', c.overhead_amount, p_reason, auth.uid());
END;
$$;

-- 12. Authorised adjustment: reverse the posted entry and post the corrected amount
CREATE OR REPLACE FUNCTION public.adjust_daily_overhead(
  p_closure_id uuid,
  p_new_amount numeric,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c public.daily_overhead_closures%ROWTYPE;
  v_rev_batch uuid;
  v_batch uuid;
  v_debit uuid;
  v_credit uuid;
  v_rev_ref text;
BEGIN
  SELECT * INTO c FROM public.daily_overhead_closures WHERE id = p_closure_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Closure not found'; END IF;
  IF NOT public.can_manage_daily_overhead(c.restaurant_id) THEN
    RAISE EXCEPTION 'Not authorised to adjust daily overhead';
  END IF;
  IF COALESCE(p_reason, '') = '' THEN
    RAISE EXCEPTION 'A reason is required for an overhead adjustment';
  END IF;
  IF p_new_amount IS NULL OR p_new_amount < 0 THEN
    RAISE EXCEPTION 'Adjusted amount must be zero or greater';
  END IF;
  IF c.status <> 'posted' OR c.batch_id IS NULL THEN
    RAISE EXCEPTION 'Only a posted day can be adjusted';
  END IF;

  SELECT r.debit_account_id, r.credit_account_id INTO v_debit, v_credit
  FROM public.resolve_daily_overhead_accounts(c.restaurant_id, c.branch_id) r;
  IF v_debit IS NULL OR v_credit IS NULL THEN
    RAISE EXCEPTION 'Overhead accounts are not configured for this branch';
  END IF;

  v_rev_ref := c.gl_reference || '-ADJ-' || to_char(now(), 'YYYYMMDDHH24MISS');

  -- Reversal of the original posting (original transactions stay untouched)
  INSERT INTO public.journal_entry_batches (
    tenant_id, branch_id, description, batch_date, reference_number, created_by,
    entry_type, journal_type, is_posted, posted_at, posted_by, approval_status
  ) VALUES (
    c.tenant_id, c.branch_id, 'Reversal - Daily Overhead Allocation ' || c.gl_reference,
    c.business_date, v_rev_ref || '-REV', auth.uid(), 'reversal', 'reversal', true, now(), auth.uid(), 'approved'
  ) RETURNING id INTO v_rev_batch;

  INSERT INTO public.account_transactions (
    tenant_id, branch_id, account_id, transaction_date, debit, credit, description,
    reference_type, reference_id, created_by, batch_id
  ) VALUES
  (c.tenant_id, c.branch_id, v_debit, c.business_date, 0, c.overhead_amount,
   'Reversal ' || c.gl_reference || ' - ' || p_reason, 'daily_overhead_reversal', c.id, auth.uid(), v_rev_batch),
  (c.tenant_id, c.branch_id, v_credit, c.business_date, c.overhead_amount, 0,
   'Reversal ' || c.gl_reference || ' - ' || p_reason, 'daily_overhead_reversal', c.id, auth.uid(), v_rev_batch);

  -- Corrected posting
  IF ROUND(p_new_amount, 2) > 0 THEN
    INSERT INTO public.journal_entry_batches (
      tenant_id, branch_id, description, batch_date, reference_number, created_by,
      entry_type, journal_type, is_posted, posted_at, posted_by, approval_status
    ) VALUES (
      c.tenant_id, c.branch_id, 'Daily Overhead Allocation (Adjusted) ' || c.gl_reference,
      c.business_date, v_rev_ref, auth.uid(), 'adjustment', 'adjustment', true, now(), auth.uid(), 'approved'
    ) RETURNING id INTO v_batch;

    INSERT INTO public.account_transactions (
      tenant_id, branch_id, account_id, transaction_date, debit, credit, description,
      reference_type, reference_id, created_by, batch_id
    ) VALUES
    (c.tenant_id, c.branch_id, v_debit, c.business_date, ROUND(p_new_amount, 2), 0,
     'Adjusted Daily Overhead ' || c.gl_reference || ' - ' || p_reason, 'daily_overhead', c.id, auth.uid(), v_batch),
    (c.tenant_id, c.branch_id, v_credit, c.business_date, 0, ROUND(p_new_amount, 2),
     'Adjusted Daily Overhead ' || c.gl_reference || ' - ' || p_reason, 'daily_overhead', c.id, auth.uid(), v_batch);
  END IF;

  PERFORM set_config('app.daily_overhead_ctx', 'on', true);
  UPDATE public.daily_overhead_closures
  SET overhead_amount = ROUND(p_new_amount, 2),
      status = 'posted',
      batch_id = COALESCE(v_batch, batch_id),
      posted_at = now(),
      updated_at = now()
  WHERE id = c.id;
  PERFORM set_config('app.daily_overhead_ctx', 'off', true);

  INSERT INTO public.daily_overhead_audit (
    tenant_id, closure_id, business_date, action, amount_before, amount_after,
    batch_id, gl_reference, reason, performed_by
  ) VALUES (
    c.tenant_id, c.id, c.business_date, 'adjusted', c.overhead_amount, ROUND(p_new_amount, 2),
    COALESCE(v_batch, v_rev_batch), v_rev_ref, p_reason, auth.uid()
  );

  RETURN COALESCE(v_batch, v_rev_batch);
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_daily_overhead(uuid, date, numeric, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_daily_overhead(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_business_day_overhead(uuid, date, numeric, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_daily_overhead(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_daily_overhead(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_daily_overhead_accounts(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_daily_overhead(uuid) TO authenticated;

CREATE TRIGGER trg_daily_overhead_settings_updated_at
BEFORE UPDATE ON public.daily_overhead_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();