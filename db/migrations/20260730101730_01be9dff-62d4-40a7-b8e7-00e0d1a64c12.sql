UPDATE public.sales_transactions t
SET subtotal = round(t.total / 1.15, 2),
    tax = round(t.total, 2) - round(t.total / 1.15, 2)
WHERE t.branch_id IN ('949c17b7-2b58-49c3-a828-17f1c797246d','b5828a9b-bce6-4bf9-b5a5-6c0d42a66705')
  AND round(t.total - t.total / 1.15, 2) <> round(t.tax, 2);