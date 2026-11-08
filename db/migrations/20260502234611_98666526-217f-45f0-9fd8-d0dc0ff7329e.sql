
CREATE TABLE IF NOT EXISTS public.cogs_trueup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  stocktake_id uuid NOT NULL,
  stocktake_kind text NOT NULL CHECK (stocktake_kind IN ('daily','weekly')),
  period_start date,
  period_end date NOT NULL,
  total_provisional_cogs numeric(14,4) NOT NULL DEFAULT 0,
  total_actual_cogs numeric(14,4) NOT NULL DEFAULT 0,
  total_variance numeric(14,4) NOT NULL DEFAULT 0,
  items_count int NOT NULL DEFAULT 0,
  items_with_variance int NOT NULL DEFAULT 0,
  wac_corrected boolean NOT NULL DEFAULT false,
  ledger_batch_id uuid,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stocktake_id, stocktake_kind)
);

CREATE TABLE IF NOT EXISTS public.cogs_trueup_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trueup_run_id uuid NOT NULL REFERENCES public.cogs_trueup_runs(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL,
  provisional_cogs numeric(14,4) NOT NULL DEFAULT 0,
  actual_cogs numeric(14,4) NOT NULL DEFAULT 0,
  variance numeric(14,4) NOT NULL DEFAULT 0,
  prev_wac numeric(14,6),
  new_wac numeric(14,6),
  wac_corrected boolean NOT NULL DEFAULT false,
  inventory_account_code text,
  cogs_account_code text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cogs_trueup_runs_restaurant ON public.cogs_trueup_runs(restaurant_id, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_cogs_trueup_adj_run ON public.cogs_trueup_adjustments(trueup_run_id);

ALTER TABLE public.cogs_trueup_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_trueup_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can read trueup runs" ON public.cogs_trueup_runs;
CREATE POLICY "Tenant members can read trueup runs"
ON public.cogs_trueup_runs FOR SELECT TO authenticated
USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "Managers can create trueup runs" ON public.cogs_trueup_runs;
CREATE POLICY "Managers can create trueup runs"
ON public.cogs_trueup_runs FOR INSERT TO authenticated
WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "Tenant members can read trueup adjustments" ON public.cogs_trueup_adjustments;
CREATE POLICY "Tenant members can read trueup adjustments"
ON public.cogs_trueup_adjustments FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.cogs_trueup_runs r
  WHERE r.id = trueup_run_id AND r.tenant_id = public.get_user_tenant_id(auth.uid())
));

DROP POLICY IF EXISTS "Managers can insert trueup adjustments" ON public.cogs_trueup_adjustments;
CREATE POLICY "Managers can insert trueup adjustments"
ON public.cogs_trueup_adjustments FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.cogs_trueup_runs r
  WHERE r.id = trueup_run_id AND r.tenant_id = public.get_user_tenant_id(auth.uid())
));

CREATE OR REPLACE FUNCTION public.reconcile_provisional_cogs(
  _stocktake_id uuid,
  _kind text DEFAULT 'weekly',
  _correct_wac boolean DEFAULT false,
  _reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
  v_existing uuid;
  v_tenant_id uuid;
  v_restaurant_id uuid;
  v_period_start date;
  v_period_end date;
  v_batch_id uuid;
  v_total_prov numeric(14,4) := 0;
  v_total_act  numeric(14,4) := 0;
  v_total_var  numeric(14,4) := 0;
  v_items_count int := 0;
  v_items_var int := 0;
  v_item record;
  v_prov numeric(14,4);
  v_actual numeric(14,4);
  v_variance numeric(14,4);
  v_inv record;
  v_inv_acct_code text;
  v_cogs_acct_code text;
  v_inv_acct_id uuid;
  v_cogs_acct_id uuid;
  v_new_wac numeric(14,6);
BEGIN
  SELECT id INTO v_existing FROM public.cogs_trueup_runs
   WHERE stocktake_id = _stocktake_id AND stocktake_kind = _kind;
  IF FOUND THEN RETURN v_existing; END IF;

  IF _kind = 'weekly' THEN
    SELECT tenant_id, restaurant_id, week_start_date, COALESCE(week_end_date, stocktake_date)
      INTO v_tenant_id, v_restaurant_id, v_period_start, v_period_end
    FROM public.weekly_stocktakes WHERE id = _stocktake_id;
  ELSIF _kind = 'daily' THEN
    SELECT NULL::uuid, restaurant_id, NULL::date, stocktake_date
      INTO v_tenant_id, v_restaurant_id, v_period_start, v_period_end
    FROM public.stocktakes WHERE id = _stocktake_id;
    IF v_restaurant_id IS NOT NULL THEN
      SELECT tenant_id INTO v_tenant_id FROM public.restaurants WHERE id = v_restaurant_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid stocktake kind: %', _kind;
  END IF;

  IF v_restaurant_id IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Stocktake % not found', _stocktake_id;
  END IF;

  INSERT INTO public.cogs_trueup_runs
    (tenant_id, restaurant_id, stocktake_id, stocktake_kind,
     period_start, period_end, wac_corrected, reason, created_by)
  VALUES
    (v_tenant_id, v_restaurant_id, _stocktake_id, _kind,
     v_period_start, v_period_end, _correct_wac, _reason, auth.uid())
  RETURNING id INTO v_run_id;

  INSERT INTO public.journal_entry_batches
    (tenant_id, batch_date, description, reference_number,
     entry_type, journal_type, is_posted, posted_at)
  VALUES
    (v_tenant_id, v_period_end,
     'COGS true-up for ' || _kind || ' stocktake ' || _stocktake_id::text,
     'TRUEUP-' || v_run_id::text,
     'cogs_trueup', 'cogs_trueup', true, now())
  RETURNING id INTO v_batch_id;

  UPDATE public.cogs_trueup_runs SET ledger_batch_id = v_batch_id WHERE id = v_run_id;

  FOR v_item IN
    SELECT
      sti.inventory_item_id,
      CASE WHEN _kind = 'weekly' THEN sti.consumption_value
           ELSE COALESCE(sti.variance_value, 0) END AS actual_cogs_val,
      CASE WHEN _kind = 'weekly' THEN sti.closing_qty   ELSE sti.counted_quantity END AS closing_qty,
      CASE WHEN _kind = 'weekly' THEN sti.closing_value ELSE (sti.counted_quantity * sti.unit_cost) END AS closing_val
    FROM (
      SELECT inventory_item_id,
             NULL::numeric AS consumption_value,
             NULL::numeric AS closing_qty,
             NULL::numeric AS closing_value,
             variance_value, counted_quantity, unit_cost
      FROM public.stocktake_items WHERE stocktake_id = _stocktake_id AND _kind = 'daily'
      UNION ALL
      SELECT inventory_item_id, consumption_value, closing_qty, closing_value,
             NULL::numeric, NULL::numeric, NULL::numeric
      FROM public.weekly_stocktake_items WHERE stocktake_id = _stocktake_id AND _kind = 'weekly'
    ) sti
  LOOP
    v_items_count := v_items_count + 1;

    SELECT COALESCE(SUM(cogs_amount), 0) INTO v_prov
    FROM public.provisional_cogs_postings
    WHERE inventory_item_id = v_item.inventory_item_id
      AND restaurant_id = v_restaurant_id
      AND status IN ('posted','negative_stock_flag')
      AND posted_at::date <= v_period_end
      AND (v_period_start IS NULL OR posted_at::date >= v_period_start);

    v_actual := COALESCE(v_item.actual_cogs_val, 0);
    v_variance := ROUND(v_actual - v_prov, 4);

    SELECT id, COALESCE(unit_cost,0) AS unit_cost, category_id,
           inventory_account_code, cogs_account_code
      INTO v_inv
    FROM public.inventory_items
    WHERE id = v_item.inventory_item_id;

    v_inv_acct_code  := v_inv.inventory_account_code;
    v_cogs_acct_code := v_inv.cogs_account_code;
    IF v_inv_acct_code IS NULL OR v_cogs_acct_code IS NULL THEN
      SELECT COALESCE(v_inv_acct_code, ic.inventory_account_code),
             COALESCE(v_cogs_acct_code, ic.cogs_account_code)
        INTO v_inv_acct_code, v_cogs_acct_code
      FROM public.inventory_categories ic
      WHERE ic.id = v_inv.category_id;
    END IF;
    v_inv_acct_code  := COALESCE(v_inv_acct_code, '1200');
    v_cogs_acct_code := COALESCE(v_cogs_acct_code, '5000');

    v_inv_acct_id  := public.get_account_id_by_code(v_tenant_id, v_inv_acct_code);
    v_cogs_acct_id := public.get_account_id_by_code(v_tenant_id, v_cogs_acct_code);

    IF ABS(v_variance) >= 0.01 AND v_inv_acct_id IS NOT NULL AND v_cogs_acct_id IS NOT NULL THEN
      v_items_var := v_items_var + 1;
      IF v_variance > 0 THEN
        INSERT INTO public.account_transactions
          (tenant_id, account_id, transaction_date, debit, credit,
           description, reference_type, reference_id, batch_id)
        VALUES
          (v_tenant_id, v_cogs_acct_id, v_period_end, v_variance, 0,
           'COGS true-up DR', 'cogs_trueup_item', v_item.inventory_item_id, v_batch_id),
          (v_tenant_id, v_inv_acct_id, v_period_end, 0, v_variance,
           'COGS true-up CR Inventory', 'cogs_trueup_item', v_item.inventory_item_id, v_batch_id);
      ELSE
        INSERT INTO public.account_transactions
          (tenant_id, account_id, transaction_date, debit, credit,
           description, reference_type, reference_id, batch_id)
        VALUES
          (v_tenant_id, v_inv_acct_id, v_period_end, ABS(v_variance), 0,
           'COGS true-up DR Inventory', 'cogs_trueup_item', v_item.inventory_item_id, v_batch_id),
          (v_tenant_id, v_cogs_acct_id, v_period_end, 0, ABS(v_variance),
           'COGS true-up CR COGS reversal', 'cogs_trueup_item', v_item.inventory_item_id, v_batch_id);
      END IF;
    END IF;

    v_new_wac := NULL;
    IF _correct_wac AND v_item.closing_qty IS NOT NULL AND v_item.closing_qty > 0 AND v_item.closing_val IS NOT NULL THEN
      v_new_wac := ROUND(v_item.closing_val / v_item.closing_qty, 6);
      UPDATE public.inventory_items
         SET unit_cost = v_new_wac, updated_at = now()
       WHERE id = v_item.inventory_item_id
         AND ABS(COALESCE(unit_cost,0) - v_new_wac) >= 0.0001;
    END IF;

    INSERT INTO public.cogs_trueup_adjustments
      (trueup_run_id, inventory_item_id,
       provisional_cogs, actual_cogs, variance,
       prev_wac, new_wac, wac_corrected,
       inventory_account_code, cogs_account_code)
    VALUES
      (v_run_id, v_item.inventory_item_id,
       v_prov, v_actual, v_variance,
       v_inv.unit_cost, v_new_wac, (v_new_wac IS NOT NULL),
       v_inv_acct_code, v_cogs_acct_code);

    v_total_prov := v_total_prov + v_prov;
    v_total_act  := v_total_act + v_actual;
    v_total_var  := v_total_var + v_variance;
  END LOOP;

  UPDATE public.cogs_trueup_runs
     SET total_provisional_cogs = v_total_prov,
         total_actual_cogs = v_total_act,
         total_variance = v_total_var,
         items_count = v_items_count,
         items_with_variance = v_items_var
   WHERE id = v_run_id;

  RETURN v_run_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_provisional_cogs(uuid, text, boolean, text) TO authenticated;
