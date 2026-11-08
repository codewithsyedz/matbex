
-- Add paid_amount column to track partial payments on individual transactions
ALTER TABLE public.sales_transactions
ADD COLUMN paid_amount numeric NOT NULL DEFAULT 0;

-- Add transaction_id to customer_balance_adjustments to link payments to specific transactions
ALTER TABLE public.customer_balance_adjustments
ADD COLUMN transaction_id uuid REFERENCES public.sales_transactions(id) ON DELETE SET NULL;

-- Create index for faster lookups
CREATE INDEX idx_balance_adjustments_transaction ON public.customer_balance_adjustments(transaction_id) WHERE transaction_id IS NOT NULL;

-- Comment for clarity
COMMENT ON COLUMN public.sales_transactions.paid_amount IS 'Amount paid against this transaction (for tracking partial payments)';
COMMENT ON COLUMN public.customer_balance_adjustments.transaction_id IS 'Optional link to specific transaction this adjustment applies to';
