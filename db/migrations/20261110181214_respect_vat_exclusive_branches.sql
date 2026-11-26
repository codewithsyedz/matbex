-- VAT-exclusive branches (branches.prices_vat_inclusive = false) were broken by two triggers
-- that assume every listed price contains VAT.
--
-- 1. normalize_vat_inclusive_sale_from_items (sales_items, after insert) "repaired" any sale
--    whose total equals its lines plus VAT by rewriting it to the line sum. That is exactly
--    what a correct sale on a VAT-exclusive branch looks like, so every such sale was stored at
--    its pre-VAT amount: a customer charged 115.00 was recorded as 100.00 (13.04 VAT instead
--    of 15.00), understating sales and output VAT. It now leaves VAT-exclusive branches alone.
-- 2. detect_vat_incident logged those correct sales as "vat_on_top" incidents. It now computes
--    the expected split with the branch's pricing mode and the document discount/surcharge.
--
-- Sales already rewritten cannot be told apart from genuine inclusive sales by the data alone;
-- see docs/self-hosting/ARCHITECTURE.md (check production for VAT-exclusive branches).

CREATE OR REPLACE FUNCTION public.detect_vat_incident()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rate numeric := 0.15;
  v_items_gross numeric;
  v_gross numeric;
  v_net numeric;
  v_vat numeric;
  v_issue text;
  v_tol numeric := 0.02;
  v_inclusive boolean := true;
  v_listed numeric;
BEGIN
  IF NEW.branch_id IS NOT NULL THEN
    SELECT COALESCE(b.vat_rate, 15) / 100.0, COALESCE(b.prices_vat_inclusive, true)
      INTO v_rate, v_inclusive
      FROM public.branches b WHERE b.id = NEW.branch_id;
    v_rate := COALESCE(v_rate, 0.15);
    v_inclusive := COALESCE(v_inclusive, true);
  END IF;

  SELECT SUM(si.total_price) INTO v_items_gross
  FROM public.sales_items si WHERE si.transaction_id = NEW.id;

  -- [20261110] Expected totals follow the branch pricing mode and the document
  -- discount/surcharge (same rule as the API): inclusive -> listed amount is the gross;
  -- exclusive -> listed amount is the net and VAT is added on top.
  IF v_items_gross IS NOT NULL THEN
    v_listed := ROUND(v_items_gross - COALESCE(NEW.document_discount, 0) + COALESCE(NEW.document_surcharge, 0), 2);
    IF v_inclusive THEN
      v_gross := v_listed;
      v_net := ROUND(v_gross / (1 + v_rate), 2);
    ELSE
      v_net := v_listed;
      v_gross := ROUND(v_net * (1 + v_rate), 2);
    END IF;
  ELSE
    v_gross := ROUND(COALESCE(NEW.total, 0)::numeric, 2);
    v_net := ROUND(v_gross / (1 + v_rate), 2);
  END IF;
  v_vat := ROUND(v_gross - v_net, 2);

  IF v_items_gross IS NOT NULL AND ABS(COALESCE(NEW.total,0) - v_gross) > v_tol THEN
    IF v_inclusive AND ABS(COALESCE(NEW.total,0) - ROUND(v_listed * (1 + v_rate), 2)) <= v_tol THEN
      v_issue := 'vat_on_top';
    ELSE
      v_issue := 'items_mismatch';
    END IF;
  ELSIF COALESCE(NEW.tax,0) = 0 AND v_vat > 0 THEN
    v_issue := 'missing_vat';
  ELSIF ABS(COALESCE(NEW.subtotal,0) - v_net) > v_tol OR ABS(COALESCE(NEW.tax,0) - v_vat) > v_tol THEN
    v_issue := 'wrong_split';
  END IF;

  IF v_issue IS NULL THEN
    UPDATE public.vat_incidents
       SET status = 'resolved', resolved_at = now(), note = COALESCE(note, 'Auto-resolved: totals now reconcile')
     WHERE transaction_id = NEW.id AND status = 'open';
    RETURN NEW;
  END IF;

  INSERT INTO public.vat_incidents (
    restaurant_id, branch_id, transaction_id, receipt_number, transaction_date,
    issue_kind, vat_rate, stored_subtotal, stored_tax, stored_total,
    expected_subtotal, expected_tax, expected_total, delta
  ) VALUES (
    NEW.restaurant_id, NEW.branch_id, NEW.id, NEW.receipt_number, NEW.created_at,
    v_issue, v_rate, COALESCE(NEW.subtotal,0), COALESCE(NEW.tax,0), COALESCE(NEW.total,0),
    v_net, v_vat, v_gross, ROUND(v_gross - COALESCE(NEW.total,0), 2)
  )
  ON CONFLICT (transaction_id) DO UPDATE SET
    issue_kind = EXCLUDED.issue_kind,
    vat_rate = EXCLUDED.vat_rate,
    stored_subtotal = EXCLUDED.stored_subtotal,
    stored_tax = EXCLUDED.stored_tax,
    stored_total = EXCLUDED.stored_total,
    expected_subtotal = EXCLUDED.expected_subtotal,
    expected_tax = EXCLUDED.expected_tax,
    expected_total = EXCLUDED.expected_total,
    delta = EXCLUDED.delta,
    status = CASE WHEN public.vat_incidents.status = 'ignored' THEN 'ignored' ELSE 'open' END,
    updated_at = now();

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_vat_inclusive_sale_from_items()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_transaction_id uuid;
  v_items_total numeric;
  v_rate numeric;
  v_inclusive boolean;
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

    SELECT COALESCE(b.vat_rate, 15), COALESCE(b.prices_vat_inclusive, true)
      INTO v_rate, v_inclusive
    FROM public.branches b
    WHERE b.id = v_current.branch_id;
    v_rate := COALESCE(v_rate, 15);
    v_inclusive := COALESCE(v_inclusive, true);

    -- VAT on top of the lines is correct on a VAT-exclusive branch: nothing to repair.
    IF NOT v_inclusive THEN
      CONTINUE;
    END IF;

    SELECT round(COALESCE(sum(COALESCE(total_price, unit_price * quantity)), 0), 2)
      INTO v_items_total
    FROM public.sales_items
    WHERE transaction_id = v_transaction_id;

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
$function$;
