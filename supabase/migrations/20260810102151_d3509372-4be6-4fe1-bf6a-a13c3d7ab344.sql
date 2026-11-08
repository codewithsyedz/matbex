ALTER TABLE public.project_acquisition_allocations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();