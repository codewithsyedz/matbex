
-- ============================================================
-- Driver PWA: tokenized rider access for mobile driver app
-- ============================================================

ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS access_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;

CREATE INDEX IF NOT EXISTS idx_riders_access_token ON public.riders(access_token);

-- ------------------------------------------------------------
-- driver_get_state: returns rider profile + active assignments
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_get_state(_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rider riders%ROWTYPE;
  _result jsonb;
BEGIN
  SELECT * INTO _rider FROM public.riders WHERE access_token = _token AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  SELECT jsonb_build_object(
    'rider', jsonb_build_object(
      'id', _rider.id,
      'name', _rider.name,
      'phone', _rider.phone,
      'vehicle', _rider.vehicle,
      'status', _rider.status
    ),
    'assignments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'order_id', a.order_id,
        'status', a.status,
        'delivery_address', a.delivery_address,
        'delivery_lat', a.delivery_lat,
        'delivery_lng', a.delivery_lng,
        'assigned_at', a.assigned_at,
        'picked_up_at', a.picked_up_at,
        'notes', a.notes
      ) ORDER BY a.assigned_at DESC)
      FROM public.delivery_assignments a
      WHERE a.rider_id = _rider.id
        AND a.status IN ('assigned', 'picked_up')
    ), '[]'::jsonb)
  ) INTO _result;

  RETURN _result;
END;
$$;

-- ------------------------------------------------------------
-- driver_update_assignment: rider marks picked_up / delivered
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_update_assignment(
  _token uuid, _assignment_id uuid, _status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rider_id uuid;
BEGIN
  IF _status NOT IN ('picked_up', 'delivered') THEN
    RETURN jsonb_build_object('error', 'invalid_status');
  END IF;

  SELECT id INTO _rider_id FROM public.riders WHERE access_token = _token AND active = true;
  IF _rider_id IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  UPDATE public.delivery_assignments
  SET status = _status,
      picked_up_at = CASE WHEN _status = 'picked_up' THEN now() ELSE picked_up_at END,
      delivered_at = CASE WHEN _status = 'delivered' THEN now() ELSE delivered_at END
  WHERE id = _assignment_id AND rider_id = _rider_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'assignment_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ------------------------------------------------------------
-- driver_ping_location: record current GPS coordinates
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_ping_location(
  _token uuid, _lat numeric, _lng numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.riders
  SET current_lat = _lat,
      current_lng = _lng,
      last_ping_at = now()
  WHERE access_token = _token AND active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Grant execute to anon so the public /driver/:token page can call without auth.
-- Token serves as the bearer credential (UUID, 122 bits of entropy).
GRANT EXECUTE ON FUNCTION public.driver_get_state(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.driver_update_assignment(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.driver_ping_location(uuid, numeric, numeric) TO anon, authenticated;
