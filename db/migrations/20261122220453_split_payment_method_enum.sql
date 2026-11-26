-- Split tender: a sale paid by more than one method stores payment_method = 'split'
-- and lists its tenders in sale_payments (next migration). Readers that still look
-- only at sales_transactions.payment_method then show "split" instead of counting
-- the whole sale as cash or card.
--
-- Its own file: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'split';
