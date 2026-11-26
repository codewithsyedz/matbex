CREATE OR REPLACE FUNCTION public.restaurant_exists(_restaurant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = _restaurant_id);
$$;

GRANT EXECUTE ON FUNCTION public.restaurant_exists(uuid) TO anon, authenticated;

DROP POLICY IF EXISTS "Guests can create reservations" ON public.table_reservations;
CREATE POLICY "Guests can create reservations"
  ON public.table_reservations FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    reserved_date >= (now() AT TIME ZONE 'UTC')::date - 1
    AND public.restaurant_exists(restaurant_id)
  );