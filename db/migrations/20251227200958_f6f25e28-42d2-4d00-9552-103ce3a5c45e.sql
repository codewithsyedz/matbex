-- Add card amount columns to shifts table
ALTER TABLE public.shifts 
ADD COLUMN expected_card numeric DEFAULT 0,
ADD COLUMN counted_card numeric DEFAULT 0;