-- 1. Failure log table
CREATE TABLE public.sale_posting_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  restaurant_id UUID NOT NULL,
  branch_id UUID,
  business_date DATE NOT NULL,
  shift_id UUID,
  source TEXT NOT NULL DEFAULT 'daily_sales',
  error_code TEXT,
  error_message TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.sale_posting_failures TO authenticated;
GRANT ALL ON public.sale_posting_failures TO service_role;

ALTER TABLE public.sale_posting_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View sale posting failures in accessible restaurants"
ON public.sale_posting_failures FOR SELECT TO authenticated
USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "Insert sale posting failures in accessible restaurants"
ON public.sale_posting_failures FOR INSERT TO authenticated
WITH CHECK (public.can_access_restaurant(restaurant_id));

CREATE POLICY "Managers can resolve sale posting failures"
ON public.sale_posting_failures FOR UPDATE TO authenticated
USING (
  public.can_access_restaurant(restaurant_id)
  AND (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('owner'::public.app_role,'manager'::public.app_role,'accountant'::public.app_role,'superadmin'::public.app_role)
    )
  )
)
WITH CHECK (public.can_access_restaurant(restaurant_id));

CREATE INDEX idx_sale_posting_failures_lookup
  ON public.sale_posting_failures (restaurant_id, business_date DESC, resolved_at);
CREATE INDEX idx_sale_posting_failures_shift
  ON public.sale_posting_failures (shift_id) WHERE shift_id IS NOT NULL;

CREATE TRIGGER trg_sale_posting_failures_updated_at
BEFORE UPDATE ON public.sale_posting_failures
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Idempotency replay counters
ALTER TABLE public.pos_idempotency_keys
  ADD COLUMN IF NOT EXISTS replay_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_replay_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shift_id UUID;

-- 3. Logging RPC
CREATE OR REPLACE FUNCTION public.log_sale_posting_failure(
  _restaurant_id UUID,
  _business_date DATE,
  _error_message TEXT,
  _branch_id UUID DEFAULT NULL,
  _shift_id UUID DEFAULT NULL,
  _source TEXT DEFAULT 'daily_sales',
  _error_code TEXT DEFAULT NULL,
  _context JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_id UUID;
  v_user RECORD;
BEGIN
  IF NOT public.can_access_restaurant(_restaurant_id) THEN
    RAISE EXCEPTION 'Not authorised for this restaurant';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.restaurants WHERE id = _restaurant_id;

  INSERT INTO public.sale_posting_failures (
    tenant_id, restaurant_id, branch_id, business_date, shift_id,
    source, error_code, error_message, context, created_by
  ) VALUES (
    v_tenant, _restaurant_id, _branch_id, _business_date, _shift_id,
    COALESCE(_source, 'daily_sales'), _error_code, _error_message,
    COALESCE(_context, '{}'::jsonb), auth.uid()
  ) RETURNING id INTO v_id;

  FOR v_user IN
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE p.tenant_id = v_tenant
      AND ur.role IN ('owner'::public.app_role,'manager'::public.app_role,'accountant'::public.app_role)
  LOOP
    INSERT INTO public.in_app_notifications (
      tenant_id, user_id, title, message, action_type, entity_type, entity_id, metadata
    ) VALUES (
      v_tenant, v_user.user_id,
      'Sale posting to ledger failed',
      format('Posting for %s failed: %s', _business_date, left(_error_message, 200)),
      'sale_posting_failure', 'sale_posting_failure', v_id,
      jsonb_build_object('branch_id', _branch_id, 'shift_id', _shift_id, 'business_date', _business_date)
    );
  END LOOP;

  RETURN v_id;
END;
$$;

-- 4. Resolve RPC
CREATE OR REPLACE FUNCTION public.resolve_sale_posting_failure(_failure_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.sale_posting_failures
  SET resolved_at = now(), resolved_by = auth.uid()
  WHERE id = _failure_id
    AND public.can_access_restaurant(restaurant_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failure not found or not authorised';
  END IF;
END;
$$;

-- 5. Monitoring RPC
CREATE OR REPLACE FUNCTION public.sale_posting_monitor(
  _restaurant_id UUID,
  _from DATE,
  _to DATE,
  _branch_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.can_access_restaurant(_restaurant_id) THEN
    RAISE EXCEPTION 'Not authorised for this restaurant';
  END IF;

  SELECT jsonb_build_object(
    'failures_total', (
      SELECT count(*) FROM public.sale_posting_failures f
      WHERE f.restaurant_id = _restaurant_id
        AND f.business_date BETWEEN _from AND _to
        AND (_branch_id IS NULL OR f.branch_id = _branch_id)
    ),
    'failures_unresolved', (
      SELECT count(*) FROM public.sale_posting_failures f
      WHERE f.restaurant_id = _restaurant_id
        AND f.business_date BETWEEN _from AND _to
        AND f.resolved_at IS NULL
        AND (_branch_id IS NULL OR f.branch_id = _branch_id)
    ),
    'unposted_closed_days', (
      SELECT count(*) FROM public.daily_sales_summary d
      WHERE d.restaurant_id = _restaurant_id
        AND d.sales_date BETWEEN _from AND _to
        AND d.status IN ('closed','approved','submitted')
        AND COALESCE(d.ledger_posted, false) = false
        AND (_branch_id IS NULL OR d.branch_id = _branch_id)
    ),
    'unposted_night_shifts', (
      SELECT count(*) FROM public.night_shift_summaries n
      WHERE n.restaurant_id = _restaurant_id
        AND n.business_date BETWEEN _from AND _to
        AND COALESCE(n.ledger_posted, false) = false
    ),
    'idempotency_replays', (
      SELECT COALESCE(sum(k.replay_count), 0) FROM public.pos_idempotency_keys k
      WHERE k.restaurant_id = _restaurant_id
        AND k.created_at::date BETWEEN _from AND _to
    ),
    'idempotency_replayed_keys', (
      SELECT count(*) FROM public.pos_idempotency_keys k
      WHERE k.restaurant_id = _restaurant_id
        AND k.replay_count > 0
        AND k.created_at::date BETWEEN _from AND _to
    ),
    'affected_shift_ids', (
      SELECT COALESCE(jsonb_agg(DISTINCT s), '[]'::jsonb) FROM (
        SELECT f.shift_id AS s FROM public.sale_posting_failures f
        WHERE f.restaurant_id = _restaurant_id
          AND f.business_date BETWEEN _from AND _to
          AND f.shift_id IS NOT NULL
          AND (_branch_id IS NULL OR f.branch_id = _branch_id)
        UNION
        SELECT k.shift_id FROM public.pos_idempotency_keys k
        WHERE k.restaurant_id = _restaurant_id
          AND k.replay_count > 0
          AND k.shift_id IS NOT NULL
          AND k.created_at::date BETWEEN _from AND _to
      ) t
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- 6. Replay recorder used by sync functions
CREATE OR REPLACE FUNCTION public.record_idempotency_replay(
  _restaurant_id UUID,
  _idempotency_key TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.pos_idempotency_keys
  SET replay_count = replay_count + 1, last_replay_at = now()
  WHERE restaurant_id = _restaurant_id AND idempotency_key = _idempotency_key;
$$;

GRANT EXECUTE ON FUNCTION public.log_sale_posting_failure(UUID, DATE, TEXT, UUID, UUID, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_sale_posting_failure(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sale_posting_monitor(UUID, DATE, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_idempotency_replay(UUID, TEXT) TO service_role;