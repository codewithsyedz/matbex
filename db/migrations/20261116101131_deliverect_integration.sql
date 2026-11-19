-- deliverect_integration
--
-- Two-way Deliverect (Jahez, HungerStation, Keeta, ... through one hub):
--   * delivery_platform_locations remembers the Matbex branch and the Deliverect account behind a
--     linked location (set by Deliverect's register call, server function deliverect).
--   * Orders from Deliverect land in online_orders with channel 'deliverect' (the delivery app's
--     own name stays in external_payload) via ingest_deliverect_order, once per Deliverect order.
--   * Status changes staff make on those orders are queued in delivery_status_outbox and sent to
--     Deliverect by the deliverect-status-sync job (retried until accepted).
-- Also: channels and payment method the delivery bridge needs ('keeta', 'deliverect', ...,
-- 'aggregator'), and restaurant riders are assigned automatically only to Matbex's own orders:
-- delivery-app orders are delivered by the app's couriers.

ALTER TABLE public.delivery_platform_locations
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_account_id text,
  ADD COLUMN IF NOT EXISTS location_name text,
  ADD COLUMN IF NOT EXISTS registered_at timestamptz;

ALTER TABLE public.online_orders DROP CONSTRAINT IF EXISTS online_orders_channel_check;
ALTER TABLE public.online_orders ADD CONSTRAINT online_orders_channel_check CHECK (channel = ANY (ARRAY[
  'direct', 'hungerstation', 'jahez', 'mrsool', 'talabat', 'qr', 'waiter',
  'keeta', 'toyou', 'careem', 'deliverect'
]));
ALTER TABLE public.online_orders DROP CONSTRAINT IF EXISTS online_orders_payment_method_check;
ALTER TABLE public.online_orders ADD CONSTRAINT online_orders_payment_method_check
  CHECK (payment_method = ANY (ARRAY['cash', 'card', 'online', 'aggregator']));

CREATE OR REPLACE FUNCTION public.trg_auto_dispatch_on_paid()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.order_type = 'delivery'
     AND NEW.payment_status = 'paid'
     AND COALESCE(NEW.channel, 'direct') = 'direct'
     AND (TG_OP = 'INSERT' OR OLD.payment_status IS DISTINCT FROM NEW.payment_status)
  THEN
    PERFORM public.auto_assign_rider(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

-- Status updates waiting to be sent to the delivery hub.
CREATE TABLE IF NOT EXISTS public.delivery_status_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  online_order_id uuid NOT NULL REFERENCES public.online_orders(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_order_id text NOT NULL,
  status_code int NOT NULL,
  reason text,
  receipt_id text,
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_status_outbox_due ON public.delivery_status_outbox (next_attempt_at) WHERE sent_at IS NULL;
ALTER TABLE public.delivery_status_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "delivery_status_outbox_restaurant_read" ON public.delivery_status_outbox;
CREATE POLICY "delivery_status_outbox_restaurant_read" ON public.delivery_status_outbox
  FOR SELECT TO authenticated USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));
GRANT SELECT ON public.delivery_status_outbox TO authenticated;
GRANT ALL ON public.delivery_status_outbox TO service_role;

-- Matbex order status -> Deliverect POS status (20 accepted, 50 preparing, 70 pickup ready,
-- 90 finalized, 110 canceled).
CREATE OR REPLACE FUNCTION public.trg_queue_deliverect_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code int;
BEGIN
  IF NEW.channel <> 'deliverect' OR NEW.external_order_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  v_code := CASE NEW.status
    WHEN 'confirmed' THEN 20
    WHEN 'preparing' THEN 50
    WHEN 'ready' THEN 70
    WHEN 'out_for_delivery' THEN 90
    WHEN 'completed' THEN 90
    WHEN 'cancelled' THEN 110
    ELSE NULL END;
  -- A cancellation that came from Deliverect itself is not echoed back.
  IF v_code IS NULL OR (v_code = 110 AND NEW.cancel_reason = 'Cancelled by the delivery app') THEN
    RETURN NEW;
  END IF;
  -- 90 once only (out_for_delivery then completed).
  IF v_code = 90 AND EXISTS (SELECT 1 FROM public.delivery_status_outbox WHERE online_order_id = NEW.id AND status_code = 90) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.delivery_status_outbox (restaurant_id, online_order_id, provider, external_order_id, status_code, reason, receipt_id)
  VALUES (NEW.restaurant_id, NEW.id, 'deliverect', NEW.external_order_id, v_code,
          CASE WHEN v_code = 110 THEN COALESCE(NEW.cancel_reason, 'Cancelled by the restaurant') END,
          'MBX-' || NEW.order_number);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.trg_queue_deliverect_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_queue_deliverect_status ON public.online_orders;
CREATE TRIGGER trg_queue_deliverect_status
  AFTER UPDATE OF status ON public.online_orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_queue_deliverect_status();

-- One Deliverect order into the restaurant's online orders (server only). Idempotent per
-- Deliverect order id; status 100/110 cancels the existing order. Amounts arrive in halalas.
CREATE OR REPLACE FUNCTION public.ingest_deliverect_order(p_restaurant_id uuid, p_order jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ext text := p_order->>'_id';
  v_status int := COALESCE((p_order->>'status')::int, 10);
  v_existing public.online_orders%ROWTYPE;
  v_id uuid;
  v_digits int := COALESCE((p_order->>'decimalDigits')::int, 2);
  v_div numeric := power(10, COALESCE((p_order->>'decimalDigits')::int, 2));
  v_item jsonb;
  v_sub jsonb;
  v_plu text;
  v_menu uuid;
  v_variant text;
  v_qty int;
  v_price numeric;
  v_total numeric;
  v_tax numeric;
  v_delivery numeric;
  v_type text;
BEGIN
  IF v_ext IS NULL OR v_ext = '' THEN
    RAISE EXCEPTION 'Deliverect order without _id';
  END IF;

  SELECT * INTO v_existing FROM public.online_orders
   WHERE restaurant_id = p_restaurant_id AND channel = 'deliverect' AND external_order_id = v_ext
   FOR UPDATE;

  IF FOUND THEN
    IF v_status IN (100, 110) AND v_existing.status NOT IN ('cancelled', 'completed') THEN
      UPDATE public.online_orders
         SET status = 'cancelled', cancel_reason = 'Cancelled by the delivery app', cancelled_at = now()
       WHERE id = v_existing.id;
      RETURN jsonb_build_object('id', v_existing.id, 'action', 'cancelled');
    END IF;
    RETURN jsonb_build_object('id', v_existing.id, 'action', 'duplicate');
  END IF;
  IF v_status IN (100, 110) THEN
    RETURN jsonb_build_object('action', 'ignored_cancel_of_unknown_order');
  END IF;

  v_total := COALESCE((p_order->'payment'->>'amount')::numeric, 0) / v_div;
  v_delivery := COALESCE((p_order->>'deliveryCost')::numeric, 0) / v_div;
  SELECT COALESCE(SUM((t->>'total')::numeric), 0) / v_div INTO v_tax FROM jsonb_array_elements(COALESCE(p_order->'taxes', '[]'::jsonb)) t;
  v_type := CASE (p_order->>'orderType')::int WHEN 2 THEN 'delivery' ELSE 'pickup' END;

  INSERT INTO public.online_orders (
    restaurant_id, channel, external_order_id, external_payload, order_type, status,
    customer_name, customer_phone, customer_email, delivery_notes,
    subtotal, delivery_fee, tax, total, payment_method, payment_status, requested_for
  ) VALUES (
    p_restaurant_id, 'deliverect', v_ext, p_order, v_type, 'pending',
    COALESCE(NULLIF(p_order->'customer'->>'name', ''), 'Delivery customer'),
    COALESCE(p_order->'customer'->>'phoneNumber', ''),
    NULLIF(p_order->'customer'->>'email', ''),
    NULLIF(concat_ws(' · ',
      NULLIF(p_order->>'channelOrderDisplayId', ''),
      NULLIF(p_order->>'note', ''),
      NULLIF(p_order->'customer'->>'note', '')), ''),
    GREATEST(v_total - v_tax - v_delivery, 0), v_delivery, v_tax, v_total,
    'aggregator',
    CASE WHEN COALESCE((p_order->>'orderIsAlreadyPaid')::boolean, true) THEN 'paid' ELSE 'pending' END,
    COALESCE(NULLIF(p_order->>'pickupTime', ''), NULLIF(p_order->>'deliveryTime', ''))::timestamptz
  ) RETURNING id INTO v_id;

  -- Lines: plu "<menu_item_id>" or "<menu_item_id>:<size>" (as sent by Send menu); anything else
  -- keeps its name and price without a menu link. Modifiers are kept in the line notes.
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_order->'items', '[]'::jsonb)) LOOP
    v_plu := v_item->>'plu';
    v_menu := NULL;
    v_variant := NULL;
    IF v_plu ~* '^[0-9a-f-]{36}(:[a-z]+)?$' THEN
      SELECT id INTO v_menu FROM public.menu_items
       WHERE id = split_part(v_plu, ':', 1)::uuid AND restaurant_id = p_restaurant_id;
      v_variant := NULLIF(split_part(v_plu, ':', 2), '');
    END IF;
    v_qty := GREATEST(COALESCE(round((v_item->>'quantity')::numeric), 1), 1)::int;
    v_price := COALESCE((v_item->>'price')::numeric, 0) / v_div;
    -- Modifier prices are per parent unit; add them to the unit price.
    FOR v_sub IN SELECT * FROM jsonb_array_elements(COALESCE(v_item->'subItems', '[]'::jsonb)) LOOP
      v_price := v_price + COALESCE((v_sub->>'price')::numeric, 0) / v_div * GREATEST(COALESCE((v_sub->>'quantity')::numeric, 1), 1);
    END LOOP;
    INSERT INTO public.online_order_items (order_id, menu_item_id, name_snapshot, variant, qty, unit_price, line_total, notes)
    VALUES (
      v_id, v_menu, COALESCE(NULLIF(v_item->>'name', ''), 'Item'), v_variant, v_qty, round(v_price, 2), round(v_price * v_qty, 2),
      NULLIF(concat_ws(', ',
        (SELECT string_agg(COALESCE(s->>'name', ''), ', ') FROM jsonb_array_elements(COALESCE(v_item->'subItems', '[]'::jsonb)) s),
        NULLIF(v_item->>'remark', '')), '')
    );
  END LOOP;

  RETURN jsonb_build_object('id', v_id, 'action', 'created');
END;
$function$;
REVOKE ALL ON FUNCTION public.ingest_deliverect_order(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_deliverect_order(uuid, jsonb) TO service_role;
