
-- Backfill sales_transactions linked to settlement_invoices that already received payments
DO $$
DECLARE
  inv RECORD;
  tx RECORD;
  remaining NUMERIC;
  apply NUMERIC;
  tx_outstanding NUMERIC;
BEGIN
  FOR inv IN
    SELECT id, amount_paid, total_amount, status, COALESCE(paid_at, updated_at, created_at) AS settled_at
    FROM public.settlement_invoices
    WHERE amount_paid > 0
  LOOP
    remaining := inv.amount_paid;

    -- Allocate oldest-first across linked transactions still unsettled
    FOR tx IN
      SELECT id, total, COALESCE(paid_amount, 0) AS paid_amount, settlement_status
      FROM public.sales_transactions
      WHERE settlement_invoice_id = inv.id
        AND settlement_status <> 'settled'
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN remaining <= 0;
      tx_outstanding := tx.total - tx.paid_amount;
      IF tx_outstanding <= 0 THEN
        UPDATE public.sales_transactions
          SET settlement_status = 'settled',
              settled_at = COALESCE(settled_at, inv.settled_at)
          WHERE id = tx.id;
        CONTINUE;
      END IF;
      apply := LEAST(remaining, tx_outstanding);
      IF apply + 0.0001 >= tx_outstanding THEN
        UPDATE public.sales_transactions
          SET paid_amount = tx.total,
              settlement_status = 'settled',
              settled_at = COALESCE(settled_at, inv.settled_at)
          WHERE id = tx.id;
      ELSE
        UPDATE public.sales_transactions
          SET paid_amount = tx.paid_amount + apply
          WHERE id = tx.id;
      END IF;
      remaining := remaining - apply;
    END LOOP;
  END LOOP;
END $$;
