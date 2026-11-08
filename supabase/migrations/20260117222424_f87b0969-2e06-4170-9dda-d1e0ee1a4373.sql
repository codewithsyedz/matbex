-- Add termination_date to staff table for versioned overhead calculation
ALTER TABLE public.staff 
ADD COLUMN termination_date DATE DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.staff.termination_date IS 'Date when staff member resigned/terminated. Used for versioned overhead calculations - staff is included in overhead for periods before this date.';