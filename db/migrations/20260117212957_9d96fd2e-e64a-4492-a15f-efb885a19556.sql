-- Add status column to expenses table with default 'paid'
ALTER TABLE public.expenses 
ADD COLUMN status TEXT NOT NULL DEFAULT 'paid' 
CHECK (status IN ('paid', 'pending'));