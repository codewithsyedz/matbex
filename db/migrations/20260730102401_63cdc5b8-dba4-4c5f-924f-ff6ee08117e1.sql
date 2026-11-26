WITH s AS (
  SELECT t.id,
         (SELECT round(sum(i.total_price), 2) FROM public.sales_items i WHERE i.transaction_id = t.id) AS items_sum,
         t.total
  FROM public.sales_transactions t
  WHERE t.branch_id IN ('949c17b7-2b58-49c3-a828-17f1c797246d','b5828a9b-bce6-4bf9-b5a5-6c0d42a66705')
), f AS (
  SELECT id, items_sum FROM s
  WHERE items_sum IS NOT NULL
    AND items_sum > 0
    AND round(total, 2) <> items_sum
    AND abs(round(total / items_sum, 4) - 1.15) < 0.0001
)
UPDATE public.sales_transactions t
SET total = f.items_sum,
    subtotal = round(f.items_sum / 1.15, 2),
    tax = f.items_sum - round(f.items_sum / 1.15, 2),
    paid_amount = CASE WHEN t.settlement_status = 'unpaid' THEN t.paid_amount ELSE f.items_sum END
FROM f
WHERE t.id = f.id;