ALTER TABLE public.staff_branch_transfers
  ADD COLUMN IF NOT EXISTS note TEXT,
  ADD COLUMN IF NOT EXISTS retag_open_advances BOOLEAN NOT NULL DEFAULT false;