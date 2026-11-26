-- Delivery fee tiers were applied only in the browser (storefront and settings preview);
-- the order function charged the flat fee, so with tiers set the customer saw one fee and
-- the order recorded another. compute_delivery_fee mirrors src/lib/deliveryFee.ts
-- computeDeliveryFee exactly (src/lib/__tests__/deliveryFee.test.ts lists the shared cases):
--   no tiers -> flat fee; tiers sorted by min_subtotal; first with min <= subtotal < max
--   (max null = no upper bound) wins; above every tier -> the last tier's fee.
CREATE OR REPLACE FUNCTION public.compute_delivery_fee(p_subtotal numeric, p_tiers jsonb, p_flat numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  t jsonb;
  v_last jsonb;
  v_min numeric;
  v_max numeric;
BEGIN
  IF p_tiers IS NULL OR jsonb_typeof(p_tiers) <> 'array' OR jsonb_array_length(p_tiers) = 0 THEN
    RETURN COALESCE(p_flat, 0);
  END IF;
  FOR t IN
    SELECT e FROM jsonb_array_elements(p_tiers) e
    ORDER BY COALESCE((e->>'min_subtotal')::numeric, 0)
  LOOP
    v_min := COALESCE((t->>'min_subtotal')::numeric, 0);
    v_max := NULLIF(t->>'max_subtotal', '')::numeric;  -- JSON null -> SQL null = no upper bound
    IF p_subtotal >= v_min AND (v_max IS NULL OR p_subtotal < v_max) THEN
      RETURN COALESCE((t->>'fee')::numeric, 0);
    END IF;
    v_last := t;
  END LOOP;
  RETURN COALESCE((v_last->>'fee')::numeric, 0);
END;
$$;
REVOKE ALL ON FUNCTION public.compute_delivery_fee(numeric, jsonb, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_delivery_fee(numeric, jsonb, numeric) TO authenticated, service_role;

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
  v_rider_pct numeric := 0;
  v_fee_flat numeric := 0;
  v_fee_tiers jsonb;
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

  -- Delivery fee comes from server-side settings, never from the caller. It depends on
  -- the items total (tiers), so it is worked out after the items are priced below.
  IF v_order_type = 'delivery' THEN
    SELECT COALESCE(delivery_fee_flat, 0), delivery_fee_tiers, COALESCE(rider_commission_pct, 0)
      INTO v_fee_flat, v_fee_tiers, v_rider_pct
    FROM public.online_ordering_settings
    WHERE restaurant_id = v_restaurant_id
    LIMIT 1;
    v_fee_flat := COALESCE(v_fee_flat, 0);
    v_rider_pct := COALESCE(v_rider_pct, 0);
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
    0, 0, 0, 0,
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

  IF v_order_type = 'delivery' THEN
    v_delivery_fee := public.compute_delivery_fee(v_items_total, v_fee_tiers, v_fee_flat);
  END IF;

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
  SET delivery_fee = v_delivery_fee,
      subtotal = v_subtotal,
      tax = v_tax,
      total = v_gross,
      rider_commission = CASE WHEN v_rider_pct > 0 AND v_delivery_fee > 0
                              THEN round(v_delivery_fee * v_rider_pct / 100, 2) ELSE 0 END
  WHERE id = v_order_id;

  RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.public_create_online_order(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_create_online_order(jsonb, jsonb) TO anon, authenticated, service_role;
