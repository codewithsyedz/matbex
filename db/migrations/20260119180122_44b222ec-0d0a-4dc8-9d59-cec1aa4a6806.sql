-- Update expenses status from 'pending' to 'unpaid'
-- First, drop the existing check constraint
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_status_check;

-- Update existing 'pending' values to 'unpaid'
UPDATE public.expenses SET status = 'unpaid' WHERE status = 'pending';

-- Add new check constraint with 'paid' and 'unpaid' values
ALTER TABLE public.expenses ADD CONSTRAINT expenses_status_check CHECK (status IN ('paid', 'unpaid'));