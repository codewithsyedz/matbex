CREATE OR REPLACE FUNCTION public.resolve_menu_item_price(
  _restaurant_id uuid,
  _menu_item_id uuid,
  _variant text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  mi public.menu_items%ROWTYPE;
  v text := lower(coalesce(_variant, ''));
  p numeric;
BEGIN
  SELECT * INTO mi FROM public.menu_items
  WHERE id = _menu_item_id AND restaurant_id = _restaurant_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v = 'quarter' THEN
    p := mi.quarter_price;
  ELSIF v = 'half' THEN
    p := mi.half_price;
  ELSIF v = 'full' THEN
    p := mi.full_price;
  END IF;

  p := COALESCE(p, mi.selling_price, mi.full_price, mi.half_price, mi.quarter_price);
  IF p IS NULL OR p < 0 THEN
    RETURN NULL;
  END IF;
  RETURN round(p::numeric, 2);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_menu_item_price(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_menu_item_price(uuid, uuid, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.public_create_online_order(p_payload jsonb, p_items jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_restaurant_id uuid;
  v_order_id uuid;
  v_item jsonb;
  v_order_type text;
  v_menu_item_id uuid;
  v_variant text;
  v_qty int;
  v_unit_price numeric;
  v_line_total numeric;
  v_items_total numeric := 0;
  v_delivery_fee numeric := 0;
  v_tax_rate numeric;
  v_gross numeric;
  v_subtotal numeric;
  v_tax numeric;
BEGIN
  v_restaurant_id := (p_payload->>'restaurant_id')::uuid;
  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'restaurant_id is required';
  END IF;

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
  IF jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'Too many items';
  END IF;

  v_order_type := COALESCE(p_payload->>'order_type', 'pickup');

  -- Delivery fee is taken from server-side settings, never from the caller.
  IF v_order_type = 'delivery' THEN
    SELECT COALESCE(delivery_fee_flat, 0) INTO v_delivery_fee
    FROM public.online_ordering_settings
    WHERE restaurant_id = v_restaurant_id
    LIMIT 1;
    v_delivery_fee := COALESCE(v_delivery_fee, 0);
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
    v_order_type,
    'pending',
    COALESCE(NULLIF(p_payload->>'customer_name',''), 'Guest'),
    COALESCE(NULLIF(p_payload->>'customer_phone',''), ''),
    NULLIF(p_payload->>'customer_email',''),
    CASE WHEN p_payload ? 'delivery_address' THEN p_payload->'delivery_address' END,
    NULLIF(p_payload->>'delivery_notes',''),
    0, v_delivery_fee, 0, 0,
    COALESCE(p_payload->>'payment_method', 'cash'),
    'pending',
    NULLIF(p_payload->>'external_order_id','')
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_menu_item_id := NULLIF(v_item->>'menu_item_id','')::uuid;
    v_variant := NULLIF(v_item->>'variant','');
    v_qty := GREATEST(COALESCE((v_item->>'qty')::int, 1), 1);
    IF v_qty > 99 THEN
      RAISE EXCEPTION 'Invalid quantity';
    END IF;

    IF v_menu_item_id IS NULL THEN
      RAISE EXCEPTION 'Each item must reference a valid menu item';
    END IF;

    -- Authoritative price: ignores any caller-supplied unit_price/line_total.
    v_unit_price := public.resolve_menu_item_price(v_restaurant_id, v_menu_item_id, v_variant);
    IF v_unit_price IS NULL THEN
      RAISE EXCEPTION 'Menu item is unavailable for this restaurant';
    END IF;

    v_line_total := round(v_unit_price * v_qty, 2);
    v_items_total := v_items_total + v_line_total;

    INSERT INTO public.online_order_items (
      order_id, menu_item_id, name_snapshot, variant, qty, unit_price, line_total, notes
    )
    SELECT v_order_id, v_menu_item_id, mi.name, v_variant, v_qty, v_unit_price, v_line_total,
           NULLIF(v_item->>'notes','')
    FROM public.menu_items mi
    WHERE mi.id = v_menu_item_id;
  END LOOP;

  -- Menu prices are VAT-inclusive: gross is the payable total.
  SELECT COALESCE(b.vat_rate, 0.15) INTO v_tax_rate
  FROM public.branches b
  WHERE b.restaurant_id = v_restaurant_id
    AND b.deleted_at IS NULL
  ORDER BY b.is_primary DESC NULLS LAST, b.created_at ASC
  LIMIT 1;
  v_tax_rate := COALESCE(v_tax_rate, 0.15);
  IF v_tax_rate > 1 THEN
    v_tax_rate := v_tax_rate / 100.0;
  END IF;

  v_gross := round(v_items_total + v_delivery_fee, 2);
  v_subtotal := round(v_gross / (1 + v_tax_rate), 2);
  v_tax := round(v_gross - v_subtotal, 2);

  UPDATE public.online_orders
  SET subtotal = v_subtotal,
      tax = v_tax,
      total = v_gross
  WHERE id = v_order_id;

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.public_create_online_order(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_create_online_order(jsonb, jsonb) TO anon, authenticated, service_role;