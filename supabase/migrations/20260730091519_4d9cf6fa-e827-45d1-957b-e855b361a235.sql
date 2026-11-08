ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS vat_rate numeric(5,2) NOT NULL DEFAULT 15;

CREATE OR REPLACE FUNCTION public.validate_branch_vat_rate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.vat_rate IS NULL OR NEW.vat_rate < 0 OR NEW.vat_rate > 100 THEN
    RAISE EXCEPTION 'vat_rate must be between 0 and 100';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_branch_vat_rate ON public.branches;
CREATE TRIGGER trg_validate_branch_vat_rate
BEFORE INSERT OR UPDATE ON public.branches
FOR EACH ROW EXECUTE FUNCTION public.validate_branch_vat_rate();