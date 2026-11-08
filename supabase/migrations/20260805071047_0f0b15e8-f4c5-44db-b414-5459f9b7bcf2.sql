
-- Notify authorized users about daily overhead posting outcome
CREATE OR REPLACE FUNCTION public.notify_daily_overhead_posting(
  p_closure_id uuid,
  p_success boolean,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.daily_overhead_closures%ROWTYPE;
  v_link text;
  v_title text;
  v_message text;
BEGIN
  SELECT * INTO c FROM public.daily_overhead_closures WHERE id = p_closure_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_link := '/accounting/daily-overhead?date=' || c.business_date::text
            || COALESCE('&branch=' || c.branch_id::text, '');

  IF p_success THEN
    v_title := 'Daily overhead posted';
    v_message := 'Overhead for ' || to_char(c.business_date, 'DD Mon YYYY')
                 || ' was posted to the ledger (' || c.gl_reference || ').';
  ELSE
    v_title := 'Daily overhead posting failed';
    v_message := 'Overhead for ' || to_char(c.business_date, 'DD Mon YYYY')
                 || ' (' || c.gl_reference || ') could not be posted: '
                 || COALESCE(NULLIF(p_error, ''), 'unknown error')
                 || '. The day stays finalized — retry is safe.';
  END IF;

  INSERT INTO public.in_app_notifications (
    user_id, tenant_id, title, message, action_type, entity_type, entity_id, metadata
  )
  SELECT DISTINCT ur.user_id,
         c.tenant_id,
         v_title,
         v_message,
         CASE WHEN p_success THEN 'daily_overhead_posted' ELSE 'daily_overhead_posting_failed' END,
         'daily_overhead_closure',
         c.id,
         jsonb_build_object(
           'gl_reference', c.gl_reference,
           'business_date', c.business_date,
           'branch_id', c.branch_id,
           'amount', c.overhead_amount,
           'batch_id', c.batch_id,
           'status', CASE WHEN p_success THEN 'posted' ELSE 'posting_failed' END,
           'error', p_error,
           'link', v_link,
           'retry_link', CASE WHEN p_success THEN NULL ELSE v_link END
         )
  FROM public.user_roles ur
  WHERE ur.restaurant_id = c.restaurant_id
    AND ur.role IN ('owner', 'manager', 'accountant');
END;
$$;

-- Success notification inside the posting routine
CREATE OR REPLACE FUNCTION public.post_daily_overhead(p_closure_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    PERFORM public.notify_daily_overhead_posting(c.id, true, NULL);
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

  PERFORM public.notify_daily_overhead_posting(c.id, true, NULL);

  RETURN v_batch;
END;
$$;

-- Failure notification when auto-posting fails during close
CREATE OR REPLACE FUNCTION public.close_business_day_overhead(
  p_restaurant_id uuid,
  p_business_date date,
  p_amount numeric,
  p_branch_id uuid DEFAULT NULL,
  p_breakdown jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

      PERFORM public.notify_daily_overhead_posting(v_id, false, SQLERRM);
    END;
  END IF;

  RETURN v_id;
END;
$$;

-- Retry wrapper that survives a failure so the notification is persisted
CREATE OR REPLACE FUNCTION public.retry_daily_overhead_posting(p_closure_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch uuid;
  v_restaurant uuid;
BEGIN
  SELECT restaurant_id INTO v_restaurant FROM public.daily_overhead_closures WHERE id = p_closure_id;
  IF v_restaurant IS NULL THEN
    RAISE EXCEPTION 'Closure not found';
  END IF;
  IF NOT public.can_manage_daily_overhead(v_restaurant) THEN
    RAISE EXCEPTION 'Not authorised to post daily overhead';
  END IF;

  BEGIN
    v_batch := public.post_daily_overhead(p_closure_id);
    RETURN jsonb_build_object('success', true, 'batch_id', v_batch);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.daily_overhead_ctx', 'on', true);
    UPDATE public.daily_overhead_closures
    SET status = 'posting_failed', posting_error = SQLERRM, updated_at = now()
    WHERE id = p_closure_id AND status <> 'posted';
    PERFORM set_config('app.daily_overhead_ctx', 'off', true);

    INSERT INTO public.daily_overhead_audit (tenant_id, closure_id, business_date, action, error_message, performed_by)
    SELECT tenant_id, id, business_date, 'post_failed', SQLERRM, auth.uid()
    FROM public.daily_overhead_closures WHERE id = p_closure_id;

    PERFORM public.notify_daily_overhead_posting(p_closure_id, false, SQLERRM);
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.retry_daily_overhead_posting(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_daily_overhead_posting(uuid, boolean, text) FROM anon, authenticated;
