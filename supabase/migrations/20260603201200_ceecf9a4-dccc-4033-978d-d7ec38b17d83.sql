
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS paused_until timestamptz,
  ADD COLUMN IF NOT EXISTS paused_reason text;

CREATE INDEX IF NOT EXISTS idx_restaurants_paused_until ON public.restaurants(paused_until);

CREATE OR REPLACE FUNCTION public.is_branch_emailable(_restaurant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurants r
    WHERE r.id = _restaurant_id
      AND r.status = 'active'
      AND r.suspended_at IS NULL
      AND (r.paused_until IS NULL OR r.paused_until <= now())
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_branch_emailable(uuid) TO authenticated, service_role;
