CREATE TABLE IF NOT EXISTS public.vat_posting_integrity_settings (
  tenant_id uuid PRIMARY KEY,
  enforce boolean NOT NULL DEFAULT false,
  tolerance numeric NOT NULL DEFAULT 1.00,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.vat_posting_integrity_settings TO authenticated;
GRANT ALL ON public.vat_posting_integrity_settings TO service_role;
ALTER TABLE public.vat_posting_integrity_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read vat integrity settings"
ON public.vat_posting_integrity_settings FOR SELECT TO authenticated
USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Owners manage vat integrity settings insert"
ON public.vat_posting_integrity_settings FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role IN ('owner'::app_role, 'accountant'::app_role)
  )
);

CREATE POLICY "Owners manage vat integrity settings update"
ON public.vat_posting_integrity_settings FOR UPDATE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role IN ('owner'::app_role, 'accountant'::app_role)
  )
)
WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE TRIGGER trg_vat_posting_integrity_settings_updated_at
BEFORE UPDATE ON public.vat_posting_integrity_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.vat_posting_integrity_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid,
  batch_id uuid,
  source text NOT NULL,
  source_id uuid,
  posting_date date,
  vat_rate numeric,
  revenue_credit numeric NOT NULL DEFAULT 0,
  vat_recorded numeric NOT NULL DEFAULT 0,
  vat_expected numeric NOT NULL DEFAULT 0,
  variance numeric NOT NULL DEFAULT 0,
  tolerance numeric NOT NULL DEFAULT 0,
  was_blocked boolean NOT NULL DEFAULT false,
  details text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vat_integrity_incidents_tenant_date
  ON public.vat_posting_integrity_incidents (tenant_id, posting_date DESC);
CREATE INDEX IF NOT EXISTS idx_vat_integrity_incidents_branch
  ON public.vat_posting_integrity_incidents (branch_id);

GRANT SELECT ON public.vat_posting_integrity_incidents TO authenticated;
GRANT ALL ON public.vat_posting_integrity_incidents TO service_role;
ALTER TABLE public.vat_posting_integrity_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read vat integrity incidents"
ON public.vat_posting_integrity_incidents FOR SELECT TO authenticated
USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE OR REPLACE FUNCTION public.check_sale_posting_vat_integrity(
  p_batch_id uuid,
  p_source text DEFAULT 'sale',
  p_source_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_batch record;
  v_branch_id uuid;
  v_branch_name text;
  v_rate numeric;
  v_revenue numeric := 0;
  v_vat numeric := 0;
  v_expected numeric := 0;
  v_variance numeric := 0;
  v_tolerance numeric := 1.00;
  v_enforce boolean := false;
  v_blocked boolean := false;
BEGIN
  SELECT * INTO v_batch FROM journal_entry_batches WHERE id = p_batch_id;
  IF v_batch IS NULL THEN
    RETURN jsonb_build_object('checked', false, 'reason', 'batch_not_found');
  END IF;

  SELECT COALESCE(SUM(CASE WHEN coa.account_type = 'revenue' THEN COALESCE(t.credit,0) - COALESCE(t.debit,0) ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN coa.account_code = '2200' THEN COALESCE(t.credit,0) - COALESCE(t.debit,0) ELSE 0 END), 0),
         (MAX(t.branch_id::text))::uuid
    INTO v_revenue, v_vat, v_branch_id
  FROM account_transactions t
  JOIN chart_of_accounts coa ON coa.id = t.account_id
  WHERE t.batch_id = p_batch_id
    AND COALESCE(t.is_voided, false) = false;

  v_branch_id := COALESCE(v_batch.branch_id, v_branch_id);

  SELECT b.vat_rate, b.name INTO v_rate, v_branch_name FROM branches b WHERE b.id = v_branch_id;

  IF v_branch_id IS NULL OR v_rate IS NULL THEN
    RETURN jsonb_build_object('checked', false, 'reason', 'no_branch_rate');
  END IF;

  SELECT s.enforce, s.tolerance INTO v_enforce, v_tolerance
  FROM vat_posting_integrity_settings s
  WHERE s.tenant_id = v_batch.tenant_id;
  v_tolerance := COALESCE(v_tolerance, 1.00);
  v_enforce := COALESCE(v_enforce, false);

  v_expected := ROUND(v_revenue * v_rate / 100.0, 2);
  v_variance := ROUND(COALESCE(v_vat, 0) - v_expected, 2);

  IF ABS(v_variance) <= v_tolerance THEN
    RETURN jsonb_build_object(
      'checked', true, 'ok', true,
      'revenue', v_revenue, 'vat_recorded', v_vat, 'vat_expected', v_expected,
      'variance', v_variance, 'rate', v_rate
    );
  END IF;

  v_blocked := v_enforce;

  INSERT INTO vat_posting_integrity_incidents (
    tenant_id, branch_id, batch_id, source, source_id, posting_date, vat_rate,
    revenue_credit, vat_recorded, vat_expected, variance, tolerance, was_blocked, details
  ) VALUES (
    v_batch.tenant_id, v_branch_id, p_batch_id, p_source, p_source_id,
    COALESCE(v_batch.batch_date, CURRENT_DATE), v_rate,
    v_revenue, v_vat, v_expected, v_variance, v_tolerance, v_blocked,
    format('Revenue credited %s at %s%% VAT should carry output VAT of %s, but %s was posted (variance %s).',
      ROUND(v_revenue, 2), ROUND(v_rate, 2), v_expected, ROUND(COALESCE(v_vat,0), 2), v_variance)
  );

  IF v_enforce THEN
    RAISE EXCEPTION 'VAT_INTEGRITY_ERROR: Output VAT does not match the revenue posted for branch "%". Revenue credited % at a VAT rate of %%% should produce output VAT of %, but this posting records % (variance %). Posting is blocked.',
      COALESCE(v_branch_name, 'unknown'), ROUND(v_revenue, 2), ROUND(v_rate, 2), v_expected, ROUND(COALESCE(v_vat,0), 2), v_variance
      USING HINT = 'Re-check the sales figures for the day, the branch VAT rate in Settings > Branches, or the tolerance in the VAT posting integrity settings.';
  END IF;

  RETURN jsonb_build_object(
    'checked', true, 'ok', false, 'blocked', false,
    'revenue', v_revenue, 'vat_recorded', v_vat, 'vat_expected', v_expected,
    'variance', v_variance, 'rate', v_rate
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.scan_sale_posting_vat_integrity(
  p_tenant_id uuid,
  p_from date,
  p_to date,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  batch_id uuid,
  branch_id uuid,
  branch_name text,
  posting_date date,
  reference_number text,
  description text,
  vat_rate numeric,
  revenue_credit numeric,
  vat_recorded numeric,
  vat_expected numeric,
  variance numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH legs AS (
    SELECT t.batch_id,
           COALESCE(jb.branch_id, (MAX(t.branch_id::text))::uuid) AS branch_id,
           jb.batch_date,
           jb.reference_number,
           jb.description,
           SUM(CASE WHEN coa.account_type = 'revenue' THEN COALESCE(t.credit,0) - COALESCE(t.debit,0) ELSE 0 END) AS revenue_credit,
           SUM(CASE WHEN coa.account_code = '2200' THEN COALESCE(t.credit,0) - COALESCE(t.debit,0) ELSE 0 END) AS vat_recorded
    FROM account_transactions t
    JOIN journal_entry_batches jb ON jb.id = t.batch_id
    JOIN chart_of_accounts coa ON coa.id = t.account_id
    WHERE t.tenant_id = p_tenant_id
      AND COALESCE(t.is_voided, false) = false
      AND jb.batch_date BETWEEN p_from AND p_to
      AND (p_branch_id IS NULL OR COALESCE(jb.branch_id, t.branch_id) = p_branch_id)
      AND EXISTS (
        SELECT 1 FROM account_transactions t2
        WHERE t2.batch_id = t.batch_id AND t2.reference_type IN ('sale', 'night_summary')
      )
    GROUP BY t.batch_id, jb.branch_id, jb.batch_date, jb.reference_number, jb.description
  )
  SELECT l.batch_id,
         l.branch_id,
         b.name,
         l.batch_date,
         l.reference_number,
         l.description,
         b.vat_rate,
         ROUND(l.revenue_credit, 2),
         ROUND(l.vat_recorded, 2),
         ROUND(l.revenue_credit * b.vat_rate / 100.0, 2),
         ROUND(l.vat_recorded - ROUND(l.revenue_credit * b.vat_rate / 100.0, 2), 2)
  FROM legs l
  JOIN branches b ON b.id = l.branch_id
  WHERE b.vat_rate IS NOT NULL
    AND l.revenue_credit <> 0
    AND ABS(l.vat_recorded - ROUND(l.revenue_credit * b.vat_rate / 100.0, 2)) > COALESCE(
      (SELECT s.tolerance FROM vat_posting_integrity_settings s WHERE s.tenant_id = p_tenant_id), 1.00)
  ORDER BY l.batch_date DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.scan_sale_posting_vat_integrity(uuid, date, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_sale_posting_vat_integrity(uuid, text, uuid) TO authenticated;