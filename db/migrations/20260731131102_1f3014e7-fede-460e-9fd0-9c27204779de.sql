ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_customers_branch_id ON public.customers(branch_id);
COMMENT ON COLUMN public.customers.branch_id IS 'Home branch for this customer. NULL = shared across all branches of the tenant.';