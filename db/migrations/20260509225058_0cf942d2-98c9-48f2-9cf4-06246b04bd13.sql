UPDATE public.sales_transactions
SET paid_amount = total
WHERE settlement_status = 'settled' AND COALESCE(paid_amount,0) < total;