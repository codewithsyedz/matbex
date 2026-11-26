-- Read-only: what migration 20261110172707 (consistent customer balance) will change.
-- Run it against a copy of production BEFORE that migration (for example right after the data
-- move rehearsal, before `npm run db:migrate`). It changes nothing.
--
--   psql "$DATABASE_URL" -f docs/self-hosting/customer-balance-review.sql
--
-- stored  = customers.current_balance today
-- new     = the balance under the new rule (see the migration header)
-- Rows are the customers whose balance changes, largest change first.
WITH tied_write_offs AS (
  -- Historical write-offs the migration ties to their sale (they stop counting twice).
  SELECT a.id
    FROM public.customer_balance_adjustments a
    JOIN public.sales_transactions st
      ON st.customer_id = a.customer_id
     AND st.receipt_number IS NOT NULL
     AND a.reason = 'Write-off for transaction ' || st.receipt_number
   WHERE a.adjustment_type = 'write_off' AND a.transaction_id IS NULL
),
proposed AS (
  SELECT c.id, c.restaurant_id, c.name, c.current_balance AS stored,
         GREATEST(0,
           COALESCE((SELECT SUM(GREATEST(st.total - COALESCE(st.paid_amount, 0), 0))
                       FROM public.sales_transactions st
                      WHERE st.customer_id = c.id AND st.settlement_status = 'unpaid'), 0)
         + COALESCE((SELECT SUM(CASE WHEN a.adjustment_type IN ('debit', 'correction') THEN a.amount
                                     WHEN a.adjustment_type IN ('credit', 'write_off') THEN -a.amount
                                     ELSE 0 END)
                       FROM public.customer_balance_adjustments a
                      WHERE a.customer_id = c.id AND a.transaction_id IS NULL
                        AND a.id NOT IN (SELECT id FROM tied_write_offs)), 0)
         - COALESCE((SELECT SUM(si.amount_paid)
                       FROM public.settlement_invoices si
                      WHERE si.customer_id = c.id
                        AND NOT EXISTS (SELECT 1 FROM public.sales_transactions l WHERE l.settlement_invoice_id = si.id)), 0)
         ) AS new
    FROM public.customers c
)
SELECT r.name AS restaurant, p.name AS customer, p.stored, p.new, p.new - p.stored AS change
  FROM proposed p
  JOIN public.restaurants r ON r.id = p.restaurant_id
 WHERE p.new IS DISTINCT FROM p.stored
 ORDER BY abs(p.new - p.stored) DESC;
