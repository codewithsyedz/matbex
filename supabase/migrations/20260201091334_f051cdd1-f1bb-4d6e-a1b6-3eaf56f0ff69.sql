-- Add account_id to expense_categories for auto-selection of CoA
ALTER TABLE public.expense_categories 
ADD COLUMN account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;

-- Add index for faster lookups
CREATE INDEX idx_expense_categories_account_id ON public.expense_categories(account_id);