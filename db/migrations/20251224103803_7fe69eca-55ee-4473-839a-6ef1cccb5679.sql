-- Add cashier_staff_id column to shifts table
ALTER TABLE public.shifts ADD COLUMN cashier_staff_id uuid REFERENCES public.staff(id);

-- Create index for performance
CREATE INDEX idx_shifts_cashier_staff_id ON public.shifts(cashier_staff_id);