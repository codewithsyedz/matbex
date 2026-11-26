-- Split bill at checkout (docs/plans/split-payments.md, phase 2a): one cart divided between
-- guests by item becomes one sale per guest, recorded together by
-- POST /api/v1/pos/sales/bill-split. The parts share bill_group_id, so the sales list can show
-- "1 of 3" and find a part's siblings. Each part stays an ordinary sale (own receipt number,
-- ZATCA invoice, tenders, void). Written only by the API; browsers read it like the rest of the
-- row (RLS on sales_transactions is unchanged).
ALTER TABLE public.sales_transactions ADD COLUMN IF NOT EXISTS bill_group_id uuid;

CREATE INDEX IF NOT EXISTS sales_transactions_bill_group_id_idx
  ON public.sales_transactions (bill_group_id)
  WHERE bill_group_id IS NOT NULL;

COMMENT ON COLUMN public.sales_transactions.bill_group_id IS
  'Split bill: shared by the sales one cart was divided into (POST /api/v1/pos/sales/bill-split); null for ordinary sales.';
