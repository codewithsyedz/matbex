
-- Branch scope for expense categories
ALTER TABLE public.expense_categories
  ADD COLUMN IF NOT EXISTS branch_id uuid NULL
    REFERENCES public.branches(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_expense_categories_branch
  ON public.expense_categories(restaurant_id, branch_id);

-- Prevent duplicate copies of the same name within a branch (or among shared)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_expense_categories_rest_branch_name
  ON public.expense_categories(restaurant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- Branch scope for suppliers
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS branch_id uuid NULL
    REFERENCES public.branches(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_suppliers_branch
  ON public.suppliers(restaurant_id, branch_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_suppliers_rest_branch_name
  ON public.suppliers(restaurant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
