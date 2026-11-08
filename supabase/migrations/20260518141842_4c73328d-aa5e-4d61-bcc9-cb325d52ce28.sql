-- Trigger function: when a branch is set is_primary=true,
-- demote any other primary branch for the same restaurant atomically.
CREATE OR REPLACE FUNCTION public.enforce_single_primary_branch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_primary IS TRUE AND NEW.deleted_at IS NULL THEN
    UPDATE public.branches
       SET is_primary = false,
           updated_at = now()
     WHERE restaurant_id = NEW.restaurant_id
       AND id <> NEW.id
       AND is_primary = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_single_primary_branch ON public.branches;
CREATE TRIGGER trg_enforce_single_primary_branch
BEFORE INSERT OR UPDATE OF is_primary, deleted_at ON public.branches
FOR EACH ROW
EXECUTE FUNCTION public.enforce_single_primary_branch();

-- Hard guarantee: at most one active primary branch per restaurant.
CREATE UNIQUE INDEX IF NOT EXISTS branches_one_primary_per_restaurant
ON public.branches (restaurant_id)
WHERE is_primary = true AND deleted_at IS NULL;