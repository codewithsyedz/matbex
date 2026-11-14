ALTER TABLE public.employee_fines
  ADD COLUMN IF NOT EXISTS installment_group_id uuid,
  ADD COLUMN IF NOT EXISTS installment_number integer,
  ADD COLUMN IF NOT EXISTS installment_count integer,
  ADD COLUMN IF NOT EXISTS installment_total_amount numeric;

CREATE INDEX IF NOT EXISTS idx_employee_fines_installment_group
  ON public.employee_fines (installment_group_id)
  WHERE installment_group_id IS NOT NULL;