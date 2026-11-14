
-- =========================================================================
-- 1) cfd_sessions: drop anon "USING (true)" SELECT, add scoped RPCs
-- =========================================================================
DROP POLICY IF EXISTS "cfd_sessions_public_read_by_code" ON public.cfd_sessions;

CREATE OR REPLACE FUNCTION public.cfd_get_session(
  p_restaurant_id uuid,
  p_pair_code text
)
RETURNS TABLE (
  state text,
  cart jsonb,
  subtotal numeric,
  tax numeric,
  total numeric,
  message text,
  order_ref text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.state, s.cart, s.subtotal, s.tax, s.total, s.message, s.order_ref
  FROM public.cfd_sessions s
  WHERE s.restaurant_id = p_restaurant_id
    AND s.pair_code = p_pair_code
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.cfd_heartbeat(
  p_restaurant_id uuid,
  p_pair_code text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.cfd_sessions
  SET last_paired_at = now()
  WHERE restaurant_id = p_restaurant_id
    AND pair_code = p_pair_code
$$;

REVOKE ALL ON FUNCTION public.cfd_get_session(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.cfd_heartbeat(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.cfd_get_session(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfd_heartbeat(uuid, text) TO anon, authenticated;

-- =========================================================================
-- 2) online_orders & online_order_items: drop anon USING (true), add RPCs
-- =========================================================================
DROP POLICY IF EXISTS "Anyone can read own order by id" ON public.online_orders;
DROP POLICY IF EXISTS "Anyone can create online orders" ON public.online_orders;
DROP POLICY IF EXISTS "Anyone can read order items" ON public.online_order_items;
DROP POLICY IF EXISTS "Anyone can insert order items" ON public.online_order_items;

-- Guest checkout: validated + audited insertion via SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.public_create_online_order(
  p_payload jsonb,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
  v_order_id uuid;
  v_item jsonb;
BEGIN
  v_restaurant_id := (p_payload->>'restaurant_id')::uuid;
  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'restaurant_id is required';
  END IF;

  -- Restaurant must exist, be active, and accepting orders.
  IF NOT EXISTS (
    SELECT 1 FROM public.restaurants r
    WHERE r.id = v_restaurant_id
      AND r.status = 'active'
      AND r.suspended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Restaurant not available';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one item is required';
  END IF;

  INSERT INTO public.online_orders (
    restaurant_id, channel, order_type, status,
    customer_name, customer_phone, customer_email,
    delivery_address, delivery_notes,
    subtotal, delivery_fee, tax, total,
    payment_method, payment_status, external_order_id
  ) VALUES (
    v_restaurant_id,
    COALESCE(p_payload->>'channel', 'direct'),
    COALESCE(p_payload->>'order_type', 'pickup'),
    'pending',
    COALESCE(NULLIF(p_payload->>'customer_name',''), 'Guest'),
    COALESCE(NULLIF(p_payload->>'customer_phone',''), ''),
    NULLIF(p_payload->>'customer_email',''),
    CASE WHEN p_payload ? 'delivery_address' THEN p_payload->'delivery_address' END,
    NULLIF(p_payload->>'delivery_notes',''),
    COALESCE((p_payload->>'subtotal')::numeric, 0),
    COALESCE((p_payload->>'delivery_fee')::numeric, 0),
    COALESCE((p_payload->>'tax')::numeric, 0),
    COALESCE((p_payload->>'total')::numeric, 0),
    COALESCE(p_payload->>'payment_method', 'cash'),
    'pending',
    NULLIF(p_payload->>'external_order_id','')
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.online_order_items (
      order_id, menu_item_id, name_snapshot, variant, qty, unit_price, line_total, notes
    ) VALUES (
      v_order_id,
      NULLIF(v_item->>'menu_item_id','')::uuid,
      COALESCE(v_item->>'name_snapshot', v_item->>'name', 'Item'),
      NULLIF(v_item->>'variant',''),
      GREATEST(COALESCE((v_item->>'qty')::int, 1), 1),
      COALESCE((v_item->>'unit_price')::numeric, 0),
      COALESCE((v_item->>'line_total')::numeric,
               COALESCE((v_item->>'unit_price')::numeric,0) * GREATEST(COALESCE((v_item->>'qty')::int,1),1)),
      NULLIF(v_item->>'notes','')
    );
  END LOOP;

  RETURN v_order_id;
END;
$$;

-- Single-order lookup by unguessable UUID. Returns at most one row.
CREATE OR REPLACE FUNCTION public.public_get_online_order(p_id uuid)
RETURNS TABLE (
  id uuid,
  restaurant_id uuid,
  order_number integer,
  order_type text,
  status text,
  customer_name text,
  customer_phone text,
  delivery_address jsonb,
  delivery_notes text,
  subtotal numeric,
  delivery_fee numeric,
  tax numeric,
  total numeric,
  payment_method text,
  payment_status text,
  requested_for timestamptz,
  confirmed_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz,
  channel text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.restaurant_id, o.order_number, o.order_type, o.status,
         o.customer_name, o.customer_phone, o.delivery_address, o.delivery_notes,
         o.subtotal, o.delivery_fee, o.tax, o.total,
         o.payment_method, o.payment_status,
         o.requested_for, o.confirmed_at, o.ready_at, o.completed_at,
         o.cancelled_at, o.cancel_reason, o.created_at, o.channel
  FROM public.online_orders o
  WHERE o.id = p_id
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.public_get_online_order_items(p_order_id uuid)
RETURNS TABLE (
  id uuid,
  order_id uuid,
  menu_item_id uuid,
  name_snapshot text,
  variant text,
  qty integer,
  unit_price numeric,
  line_total numeric,
  notes text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id, i.order_id, i.menu_item_id, i.name_snapshot, i.variant,
         i.qty, i.unit_price, i.line_total, i.notes
  FROM public.online_order_items i
  WHERE i.order_id = p_order_id
$$;

REVOKE ALL ON FUNCTION public.public_create_online_order(jsonb, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.public_get_online_order(uuid) FROM public;
REVOKE ALL ON FUNCTION public.public_get_online_order_items(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.public_create_online_order(jsonb, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_get_online_order(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_get_online_order_items(uuid) TO anon, authenticated;

-- =========================================================================
-- 3) restaurants: keep public storefront read, hide billing/suspension cols
-- =========================================================================
REVOKE SELECT ON public.restaurants FROM anon;
GRANT SELECT (id, name, currency, timezone, tenant_id, toast_position, is_primary)
  ON public.restaurants TO anon;
