-- Backfill: when a settlement_invoice is fully paid (status='settled'),
-- ensure all linked sales_transactions are marked settled with paid_amount = total.
UPDATE public.sales_transactions st
SET 
  settlement_status = 'settled',
  settled_at = COALESCE(st.settled_at, si.paid_at, now()),
  paid_amount = st.total
FROM public.settlement_invoices si
WHERE st.settlement_invoice_id = si.id
  AND si.status = 'settled'
  AND st.settlement_status <> 'settled';