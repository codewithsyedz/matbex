CREATE OR REPLACE FUNCTION public.normalize_vat_inclusive_sale_from_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction_id uuid;
  v_items_total numeric;
  v_rate numeric;
  v_net numeric;
  v_tax numeric;
  v_current public.sales_transactions%ROWTYPE;
BEGIN
  FOR v_transaction_id IN
    SELECT DISTINCT transaction_id
    FROM new_sales_items
    WHERE transaction_id IS NOT NULL
  LOOP
    SELECT * INTO v_current
    FROM public.sales_transactions
    WHERE id = v_transaction_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT round(COALESCE(sum(COALESCE(total_price, unit_price * quantity)), 0), 2)
      INTO v_items_total
    FROM public.sales_items
    WHERE transaction_id = v_transaction_id;

    SELECT COALESCE(b.vat_rate, 15)
      INTO v_rate
    FROM public.branches b
    WHERE b.id = v_current.branch_id;
    v_rate := COALESCE(v_rate, 15);

    -- Only repair the recognizable legacy VAT-on-top payload. Correct inclusive
    -- sales already have total = item sum and are intentionally left untouched.
    IF v_items_total > 0
       AND abs(v_current.total - round(v_items_total * (1 + v_rate / 100), 2)) <= 0.02
       AND abs(v_current.subtotal - v_items_total) <= 0.02
    THEN
      v_net := round(v_items_total / (1 + v_rate / 100), 2);
      v_tax := round(v_items_total - v_net, 2);

      UPDATE public.sales_transactions
      SET subtotal = v_net,
          tax = v_tax,
          total = v_items_total,
          paid_amount = CASE
            WHEN settlement_status = 'paid' THEN v_items_total
            ELSE LEAST(COALESCE(paid_amount, 0), v_items_total)
          END
      WHERE id = v_transaction_id;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_vat_inclusive_sale_from_items ON public.sales_items;
CREATE TRIGGER trg_normalize_vat_inclusive_sale_from_items
AFTER INSERT ON public.sales_items
REFERENCING NEW TABLE AS new_sales_items
FOR EACH STATEMENT
EXECUTE FUNCTION public.normalize_vat_inclusive_sale_from_items();

WITH item_totals AS (
  SELECT s.transaction_id,
         round(sum(COALESCE(s.total_price, s.unit_price * s.quantity)), 2) AS gross
  FROM public.sales_items s
  GROUP BY s.transaction_id
), repair AS (
  SELECT st.id,
         it.gross,
         round(it.gross / (1 + COALESCE(b.vat_rate, 15) / 100), 2) AS net
  FROM public.sales_transactions st
  JOIN item_totals it ON it.transaction_id = st.id
  LEFT JOIN public.branches b ON b.id = st.branch_id
  WHERE st.branch_id IN (
    '949c17b7-2b58-49c3-a828-17f1c797246d'::uuid,
    'b5828a9b-bce6-4bf9-b5a5-6c0d42a66705'::uuid
  )
    AND st.created_at >= '2026-07-30 00:00:00+03'::timestamptz
    AND abs(st.total - round(it.gross * (1 + COALESCE(b.vat_rate, 15) / 100), 2)) <= 0.02
    AND abs(st.subtotal - it.gross) <= 0.02
)
UPDATE public.sales_transactions st
SET subtotal = r.net,
    tax = round(r.gross - r.net, 2),
    total = r.gross,
    paid_amount = CASE
      WHEN st.settlement_status = 'paid' THEN r.gross
      ELSE LEAST(COALESCE(st.paid_amount, 0), r.gross)
    END
FROM repair r
WHERE st.id = r.id;