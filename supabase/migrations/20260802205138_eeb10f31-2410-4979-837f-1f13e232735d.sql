-- Report: sale lines whose unit price matches no valid price tier for the
-- line's branch on the sale's local calendar date.
CREATE OR REPLACE FUNCTION public.sales_price_variance(
  _restaurant_id uuid,
  _from date,
  _to date,
  _branch_id uuid DEFAULT NULL
)
RETURNS TABLE(
  sale_item_id uuid,
  transaction_id uuid,
  receipt_number text,
  sold_at timestamptz,
  sale_date date,
  branch_id uuid,
  branch_name text,
  menu_item_id uuid,
  item_name text,
  quantity integer,
  unit_price numeric,
  line_total numeric,
  expected_quarter numeric,
  expected_half numeric,
  expected_full numeric,
  nearest_expected numeric,
  variance_per_unit numeric,
  variance_total numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH tz AS (
    SELECT COALESCE(r.timezone, 'Asia/Riyadh') AS name
    FROM public.restaurants r WHERE r.id = _restaurant_id
  ),
  lines AS (
    SELECT
      si.id,
      si.transaction_id,
      st.receipt_number,
      st.created_at AS sold_at,
      (st.created_at AT TIME ZONE (SELECT name FROM tz))::date AS sale_date,
      COALESCE(si.branch_id, st.branch_id) AS branch_id,
      si.menu_item_id,
      mi.name AS item_name,
      si.quantity,
      si.unit_price,
      COALESCE(si.total_price, si.unit_price * si.quantity) AS line_total,
      mi.quarter_price AS base_quarter,
      mi.half_price AS base_half,
      mi.full_price AS base_full,
      mi.selling_price AS base_selling
    FROM public.sales_items si
    JOIN public.sales_transactions st ON st.id = si.transaction_id
    JOIN public.menu_items mi ON mi.id = si.menu_item_id
    WHERE si.restaurant_id = _restaurant_id
      AND (st.created_at AT TIME ZONE (SELECT name FROM tz))::date BETWEEN _from AND _to
      AND (_branch_id IS NULL OR COALESCE(si.branch_id, st.branch_id) = _branch_id)
  ),
  priced AS (
    SELECT
      l.*,
      b.name AS branch_name,
      COALESCE(p.quarter_price, l.base_quarter) AS exp_quarter,
      COALESCE(p.half_price, l.base_half) AS exp_half,
      COALESCE(p.full_price, l.base_full, l.base_selling) AS exp_full
    FROM lines l
    LEFT JOIN public.branches b ON b.id = l.branch_id
    LEFT JOIN LATERAL (
      SELECT mp.quarter_price, mp.half_price, mp.full_price
      FROM public.menu_item_branch_prices mp
      WHERE mp.branch_id = l.branch_id
        AND mp.menu_item_id = l.menu_item_id
        AND mp.effective_from <= l.sale_date
        AND (mp.effective_to IS NULL OR mp.effective_to >= l.sale_date)
      ORDER BY mp.effective_from DESC, mp.created_at DESC, mp.id DESC
      LIMIT 1
    ) p ON TRUE
  ),
  flagged AS (
    SELECT
      pr.*,
      (
        SELECT v FROM (
          SELECT unnest(ARRAY[pr.exp_quarter, pr.exp_half, pr.exp_full]) AS v
        ) c
        WHERE c.v IS NOT NULL AND c.v > 0
        ORDER BY abs(c.v - pr.unit_price)
        LIMIT 1
      ) AS nearest
    FROM priced pr
  )
  SELECT
    f.id,
    f.transaction_id,
    f.receipt_number,
    f.sold_at,
    f.sale_date,
    f.branch_id,
    f.branch_name,
    f.menu_item_id,
    f.item_name,
    f.quantity,
    f.unit_price,
    f.line_total,
    f.exp_quarter,
    f.exp_half,
    f.exp_full,
    f.nearest,
    round(f.unit_price - f.nearest, 2),
    round((f.unit_price - f.nearest) * f.quantity, 2)
  FROM flagged f
  WHERE f.nearest IS NOT NULL
    AND abs(f.unit_price - f.nearest) > 0.005
  ORDER BY f.sold_at DESC;
$$;

REVOKE ALL ON FUNCTION public.sales_price_variance(uuid, date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_price_variance(uuid, date, date, uuid) TO authenticated, service_role;

-- Correction: set a sale line to the correct unit price and re-derive the
-- receipt's net / VAT / gross totals from the item sum (gross, VAT-inclusive
-- branches) or by adding VAT on top (VAT-exclusive branches).
CREATE OR REPLACE FUNCTION public.correct_sale_item_price(
  _sale_item_id uuid,
  _new_unit_price numeric,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item public.sales_items%ROWTYPE;
  v_txn public.sales_transactions%ROWTYPE;
  v_branch uuid;
  v_rate numeric := 15;
  v_inclusive boolean := true;
  v_items_total numeric;
  v_net numeric;
  v_tax numeric;
  v_gross numeric;
  v_old_price numeric;
BEGIN
  IF _new_unit_price IS NULL OR _new_unit_price < 0 THEN
    RAISE EXCEPTION 'Invalid price';
  END IF;

  SELECT * INTO v_item FROM public.sales_items WHERE id = _sale_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale line not found';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), v_item.restaurant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), v_item.restaurant_id, 'manager'::app_role)
    OR public.has_role(auth.uid(), v_item.restaurant_id, 'accountant'::app_role)
  ) THEN
    RAISE EXCEPTION 'Not authorised to correct sale prices';
  END IF;

  SELECT * INTO v_txn FROM public.sales_transactions
  WHERE id = v_item.transaction_id FOR UPDATE;

  v_branch := COALESCE(v_item.branch_id, v_txn.branch_id);
  IF v_branch IS NOT NULL AND NOT public.user_can_access_branch(auth.uid(), v_item.restaurant_id, v_branch) THEN
    RAISE EXCEPTION 'Not authorised for this branch';
  END IF;

  SELECT COALESCE(b.vat_rate, 15), COALESCE(b.prices_vat_inclusive, true)
    INTO v_rate, v_inclusive
  FROM public.branches b WHERE b.id = v_branch;
  v_rate := COALESCE(v_rate, 15);
  v_inclusive := COALESCE(v_inclusive, true);

  v_old_price := v_item.unit_price;

  UPDATE public.sales_items
  SET unit_price = round(_new_unit_price, 2),
      total_price = round(_new_unit_price * quantity, 2)
  WHERE id = _sale_item_id;

  SELECT round(COALESCE(sum(COALESCE(total_price, unit_price * quantity)), 0), 2)
    INTO v_items_total
  FROM public.sales_items WHERE transaction_id = v_item.transaction_id;

  IF v_inclusive THEN
    v_gross := v_items_total;
    v_net := round(v_items_total / (1 + v_rate / 100), 2);
  ELSE
    v_net := v_items_total;
    v_gross := round(v_items_total * (1 + v_rate / 100), 2);
  END IF;
  v_tax := round(v_gross - v_net, 2);

  UPDATE public.sales_transactions
  SET subtotal = v_net,
      tax = v_tax,
      total = v_gross,
      paid_amount = CASE
        WHEN settlement_status = 'paid' THEN v_gross
        ELSE LEAST(COALESCE(paid_amount, 0), v_gross)
      END
  WHERE id = v_item.transaction_id;

  INSERT INTO public.audit_logs (restaurant_id, user_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    v_item.restaurant_id,
    auth.uid(),
    'sale_price_corrected',
    'sales_items',
    _sale_item_id,
    jsonb_build_object('unit_price', v_old_price, 'transaction_total', v_txn.total),
    jsonb_build_object(
      'unit_price', round(_new_unit_price, 2),
      'transaction_total', v_gross,
      'branch_id', v_branch,
      'reason', _reason
    )
  );

  RETURN jsonb_build_object(
    'sale_item_id', _sale_item_id,
    'old_unit_price', v_old_price,
    'new_unit_price', round(_new_unit_price, 2),
    'transaction_id', v_item.transaction_id,
    'subtotal', v_net,
    'tax', v_tax,
    'total', v_gross
  );
END;
$$;

REVOKE ALL ON FUNCTION public.correct_sale_item_price(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_sale_item_price(uuid, numeric, text) TO authenticated, service_role;