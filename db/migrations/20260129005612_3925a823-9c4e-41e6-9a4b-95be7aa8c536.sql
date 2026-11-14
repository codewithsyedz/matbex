-- Add soft delete column to expenses table
ALTER TABLE public.expenses 
ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add index for efficient querying of non-deleted expenses
CREATE INDEX idx_expenses_deleted_at ON public.expenses(deleted_at) WHERE deleted_at IS NULL;

-- Add comment explaining the column
COMMENT ON COLUMN public.expenses.deleted_at IS 'Soft delete timestamp - null means active, non-null means deleted';