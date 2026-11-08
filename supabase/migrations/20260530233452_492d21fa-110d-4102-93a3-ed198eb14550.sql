
-- 1. Helper: haversine distance in km
CREATE OR REPLACE FUNCTION public.haversine_km(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (
    6371 * 2 * asin(
      sqrt(
        power(sin(radians(($3 - $1) / 2)), 2)
        + cos(radians($1)) * cos(radians($3)) * power(sin(radians(($4 - $2) / 2)), 2)
      )
    )
  )::numeric
$$;

-- 2. Auto-assign nearest available rider to an order
CREATE OR REPLACE FUNCTION public.auto_assign_rider(_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_rider RECORD;
  v_dlat numeric;
  v_dlng numeric;
  v_assignment_id uuid;
BEGIN
  SELECT id, restaurant_id, order_type, delivery_address, payment_status
    INTO v_order
  FROM public.online_orders
  WHERE id = _order_id;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.order_type <> 'delivery' THEN
    RETURN NULL;
  END IF;

  -- Skip if already assigned & active
  IF EXISTS (
    SELECT 1 FROM public.delivery_assignments
    WHERE order_id = _order_id AND status IN ('assigned','picked_up')
  ) THEN
    RETURN NULL;
  END IF;

  v_dlat := NULLIF(v_order.delivery_address->>'lat','')::numeric;
  v_dlng := NULLIF(v_order.delivery_address->>'lng','')::numeric;

  -- Pick the nearest 'available' rider with a recent ping (15 min)
  -- If no coords on order or rider, fall back to any available rider.
  SELECT r.id, r.current_lat, r.current_lng
    INTO v_rider
  FROM public.riders r
  WHERE r.restaurant_id = v_order.restaurant_id
    AND r.active = true
    AND r.status = 'available'
    AND (r.last_ping_at IS NULL OR r.last_ping_at > now() - interval '15 minutes')
  ORDER BY
    CASE
      WHEN v_dlat IS NOT NULL AND v_dlng IS NOT NULL
       AND r.current_lat IS NOT NULL AND r.current_lng IS NOT NULL
      THEN public.haversine_km(r.current_lat, r.current_lng, v_dlat, v_dlng)
      ELSE 9999
    END ASC,
    r.last_ping_at DESC NULLS LAST
  LIMIT 1;

  IF v_rider.id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.delivery_assignments (
    restaurant_id, order_id, rider_id, status,
    delivery_address, delivery_lat, delivery_lng, created_by
  ) VALUES (
    v_order.restaurant_id, _order_id, v_rider.id, 'assigned',
    v_order.delivery_address->>'address', v_dlat, v_dlng, auth.uid()
  )
  RETURNING id INTO v_assignment_id;

  -- Bump rider status
  UPDATE public.riders SET status = 'on_delivery', updated_at = now() WHERE id = v_rider.id;

  -- Move order forward if still pending/confirmed
  UPDATE public.online_orders
     SET status = CASE WHEN status IN ('pending','confirmed','preparing','ready') THEN 'out_for_delivery' ELSE status END,
         updated_at = now()
   WHERE id = _order_id;

  RETURN v_assignment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_assign_rider(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_assign_rider(uuid) TO service_role;

-- 3. Trigger: auto-dispatch when a delivery order is paid
CREATE OR REPLACE FUNCTION public.trg_auto_dispatch_on_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.order_type = 'delivery'
     AND NEW.payment_status = 'paid'
     AND (TG_OP = 'INSERT' OR OLD.payment_status IS DISTINCT FROM NEW.payment_status)
  THEN
    PERFORM public.auto_assign_rider(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_dispatch_on_paid ON public.online_orders;
CREATE TRIGGER trg_auto_dispatch_on_paid
AFTER INSERT OR UPDATE OF payment_status ON public.online_orders
FOR EACH ROW EXECUTE FUNCTION public.trg_auto_dispatch_on_paid();

-- 4. View: paid delivery orders with no active assignment
CREATE OR REPLACE VIEW public.v_unassigned_delivery_orders AS
SELECT
  o.id,
  o.restaurant_id,
  o.order_number,
  o.customer_name,
  o.customer_phone,
  o.delivery_address,
  o.total,
  o.channel,
  o.payment_status,
  o.status,
  o.created_at,
  NULLIF(o.delivery_address->>'lat','')::numeric AS delivery_lat,
  NULLIF(o.delivery_address->>'lng','')::numeric AS delivery_lng
FROM public.online_orders o
WHERE o.order_type = 'delivery'
  AND o.payment_status = 'paid'
  AND o.status NOT IN ('completed','cancelled')
  AND NOT EXISTS (
    SELECT 1 FROM public.delivery_assignments a
     WHERE a.order_id = o.id AND a.status IN ('assigned','picked_up')
  );

GRANT SELECT ON public.v_unassigned_delivery_orders TO authenticated;
GRANT SELECT ON public.v_unassigned_delivery_orders TO service_role;
