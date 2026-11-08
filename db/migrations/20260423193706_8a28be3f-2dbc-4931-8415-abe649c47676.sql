ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS stock_variance_explanation text,
  ADD COLUMN IF NOT EXISTS stock_variance_pct numeric;

COMMENT ON COLUMN public.shifts.stock_variance_explanation IS
  'Cashier-provided reason when stock spend variance during the shift is >= 15% at close time.';
COMMENT ON COLUMN public.shifts.stock_variance_pct IS
  'Stock spend variance percentage captured at shift close (|purchase - usage| / max(purchase, usage) * 100).';