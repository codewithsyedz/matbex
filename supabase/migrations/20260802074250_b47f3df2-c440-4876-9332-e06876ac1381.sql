ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS prices_vat_inclusive boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.branches.prices_vat_inclusive IS
  'true = menu/POS prices are stored and displayed VAT-inclusive (VAT is backed out of the listed price). false = prices are net and VAT is added on top at checkout.';

UPDATE public.branches SET prices_vat_inclusive = true WHERE prices_vat_inclusive IS NULL;