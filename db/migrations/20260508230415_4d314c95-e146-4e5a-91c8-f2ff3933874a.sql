ALTER TABLE public.variance_thresholds
  ADD COLUMN IF NOT EXISTS require_adjustment_for_close BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.variance_thresholds.require_adjustment_for_close
  IS 'When true, Day-End closure with a non-zero variance requires a posted Day-End Adjustment, not just an explanation note.';