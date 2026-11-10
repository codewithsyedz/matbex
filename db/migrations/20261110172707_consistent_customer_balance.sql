-- One rule for a customer's balance (what they owe), recomputed whenever any input changes.
--
-- Before: two triggers kept customers.current_balance with different rules.
--   * update_customer_balance (on sales_transactions): SUM(total) of unpaid sales + every
--     balance adjustment (credit/write_off/settlement negative, debit/correction positive).
--   * apply_balance_adjustment (on adjustment insert): current_balance +/- amount.
-- Several screens record the same money twice under the first rule:
--   * write-off: the sale becomes "settled" (drops out of the sum) AND a write_off adjustment
--     of its total is subtracted;
--   * paying a sale in instalments: each instalment is a credit adjustment, and when the sale
--     is fully paid it also drops out of the sum;
--   * paying a settlement invoice in full: its sales become "settled" AND a settlement
--     adjustment of the invoice total is subtracted;
--   * partial payments on a settlement invoice lowered nothing until it was fully paid.
-- The GREATEST(0, ...) clamp hid the double count only when nothing else was owed.
--
-- Now:
--   balance = SUM(total - paid_amount) of the customer's unpaid, non-voided sales
--           + adjustments NOT tied to a sale (transaction_id IS NULL):
--               debit/correction add, credit/write_off subtract
--           - amount_paid of settlement invoices that have no sales linked ("custom amount")
--   Settlement adjustments are history only (the invoice's payments already count), and
--   adjustments tied to a sale (instalments, write-offs) are reflected on the sale itself.
--   Never below zero, as before.

CREATE OR REPLACE FUNCTION public.recompute_customer_balance(_customer_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.customers c
     SET current_balance = GREATEST(0,
           COALESCE((SELECT SUM(GREATEST(st.total - COALESCE(st.paid_amount, 0), 0))
                       FROM public.sales_transactions st
                      WHERE st.customer_id = c.id
                        AND st.settlement_status = 'unpaid'
                        AND st.voided_at IS NULL), 0)
         + COALESCE((SELECT SUM(CASE WHEN a.adjustment_type IN ('debit', 'correction') THEN a.amount
                                     WHEN a.adjustment_type IN ('credit', 'write_off') THEN -a.amount
                                     ELSE 0 END)
                       FROM public.customer_balance_adjustments a
                      WHERE a.customer_id = c.id AND a.transaction_id IS NULL), 0)
         - COALESCE((SELECT SUM(si.amount_paid)
                       FROM public.settlement_invoices si
                      WHERE si.customer_id = c.id
                        AND NOT EXISTS (SELECT 1 FROM public.sales_transactions l WHERE l.settlement_invoice_id = si.id)), 0)
         ),
         updated_at = now()
   WHERE c.id = _customer_id;
$$;
REVOKE ALL ON FUNCTION public.recompute_customer_balance(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_customer_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.customer_id IS NOT NULL THEN
    PERFORM public.recompute_customer_balance(OLD.customer_id);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.customer_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.customer_id IS DISTINCT FROM OLD.customer_id) THEN
    PERFORM public.recompute_customer_balance(NEW.customer_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Adjustments and invoices: recompute instead of adding to the stored balance.
CREATE OR REPLACE FUNCTION public.recompute_customer_balance_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.customer_id IS NOT NULL THEN
    PERFORM public.recompute_customer_balance(OLD.customer_id);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.customer_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.customer_id IS DISTINCT FROM OLD.customer_id) THEN
    PERFORM public.recompute_customer_balance(NEW.customer_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS apply_customer_balance_adjustment ON public.customer_balance_adjustments;
CREATE TRIGGER apply_customer_balance_adjustment
  AFTER INSERT OR UPDATE OR DELETE ON public.customer_balance_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.recompute_customer_balance_trigger();

DROP TRIGGER IF EXISTS update_customer_balance_trigger ON public.sales_transactions;
CREATE TRIGGER update_customer_balance_trigger
  AFTER INSERT OR UPDATE OF customer_id, total, paid_amount, settlement_status, voided_at, settlement_invoice_id
  ON public.sales_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_customer_balance();

DROP TRIGGER IF EXISTS recompute_customer_balance_on_invoice ON public.settlement_invoices;
CREATE TRIGGER recompute_customer_balance_on_invoice
  AFTER INSERT OR UPDATE OF amount_paid, customer_id OR DELETE ON public.settlement_invoices
  FOR EACH ROW EXECUTE FUNCTION public.recompute_customer_balance_trigger();

-- apply_balance_adjustment is no longer used by any trigger.
DROP FUNCTION IF EXISTS public.apply_balance_adjustment();

-- Historical write-offs were not tied to their sale; the sale was settled at the same time.
-- Tie them (reason "Write-off for transaction <receipt>") so they are not subtracted twice.
UPDATE public.customer_balance_adjustments a
   SET transaction_id = st.id
  FROM public.sales_transactions st
 WHERE a.adjustment_type = 'write_off'
   AND a.transaction_id IS NULL
   AND st.customer_id = a.customer_id
   AND st.receipt_number IS NOT NULL
   AND a.reason = 'Write-off for transaction ' || st.receipt_number;

-- Settlement invoices that are deleted keep their audit trail.
ALTER TABLE public.settlement_audit_logs DROP CONSTRAINT IF EXISTS settlement_audit_logs_settlement_invoice_id_fkey;
ALTER TABLE public.settlement_audit_logs
  ADD CONSTRAINT settlement_audit_logs_settlement_invoice_id_fkey
  FOREIGN KEY (settlement_invoice_id) REFERENCES public.settlement_invoices(id) ON DELETE SET NULL;

-- Recompute every customer and report how many balances changed (review before go-live).
CREATE TEMP TABLE _balance_before ON COMMIT DROP AS SELECT id, current_balance FROM public.customers;
SELECT public.recompute_customer_balance(id) FROM public.customers;
DO $$
DECLARE n int; d numeric;
BEGIN
  SELECT count(*), COALESCE(SUM(c.current_balance - b.current_balance), 0) INTO n, d
    FROM public.customers c JOIN _balance_before b USING (id)
   WHERE c.current_balance IS DISTINCT FROM b.current_balance;
  RAISE NOTICE 'customer balances changed by the new rule: % customers, net change %', n, d;
END $$;
