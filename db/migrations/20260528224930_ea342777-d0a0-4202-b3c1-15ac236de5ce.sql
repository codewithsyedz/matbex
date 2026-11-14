
-- ============================================================
-- ONLINE ORDERING SETTINGS
-- ============================================================
CREATE TABLE public.online_ordering_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL UNIQUE REFERENCES public.restaurants(id) ON DELETE CASCADE,
  accepting_orders boolean NOT NULL DEFAULT true,
  accept_delivery boolean NOT NULL DEFAULT true,
  accept_pickup boolean NOT NULL DEFAULT true,
  min_order_amount numeric(12,2) NOT NULL DEFAULT 0,
  delivery_fee_flat numeric(12,2) NOT NULL DEFAULT 0,
  delivery_radius_km numeric(6,2) NOT NULL DEFAULT 10,
  prep_time_minutes integer NOT NULL DEFAULT 30,
  online_payment_enabled boolean NOT NULL DEFAULT false,
  storefront_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.online_ordering_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.online_ordering_settings TO authenticated;
GRANT ALL ON public.online_ordering_settings TO service_role;

ALTER TABLE public.online_ordering_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view storefront settings"
  ON public.online_ordering_settings FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Managers can manage storefront settings"
  ON public.online_ordering_settings FOR ALL
  TO authenticated
  USING (
    has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  );

-- ============================================================
-- ONLINE ORDERS
-- ============================================================
CREATE TABLE public.online_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_number integer NOT NULL,
  order_type text NOT NULL CHECK (order_type IN ('delivery','pickup')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','preparing','ready','out_for_delivery','completed','cancelled')),

  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  customer_email text,
  delivery_address jsonb,
  delivery_notes text,

  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  delivery_fee numeric(12,2) NOT NULL DEFAULT 0,
  tax numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','card','online')),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','refunded')),

  requested_for timestamptz,
  confirmed_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,

  sales_transaction_id uuid REFERENCES public.sales_transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, order_number)
);

CREATE INDEX idx_online_orders_rest_status ON public.online_orders (restaurant_id, status, created_at DESC);
CREATE INDEX idx_online_orders_created ON public.online_orders (created_at DESC);

GRANT SELECT, INSERT ON public.online_orders TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.online_orders TO authenticated;
GRANT ALL ON public.online_orders TO service_role;

ALTER TABLE public.online_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can create online orders"
  ON public.online_orders FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can read own order by id"
  ON public.online_orders FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Staff can view restaurant orders"
  ON public.online_orders FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
    OR has_role(auth.uid(), restaurant_id, 'cashier'::app_role)
    OR has_role(auth.uid(), restaurant_id, 'accountant'::app_role)
  );

CREATE POLICY "Staff can update restaurant orders"
  ON public.online_orders FOR UPDATE
  TO authenticated
  USING (
    has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
    OR has_role(auth.uid(), restaurant_id, 'cashier'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
    OR has_role(auth.uid(), restaurant_id, 'cashier'::app_role)
  );

-- ============================================================
-- ONLINE ORDER ITEMS
-- ============================================================
CREATE TABLE public.online_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.online_orders(id) ON DELETE CASCADE,
  menu_item_id uuid REFERENCES public.menu_items(id) ON DELETE SET NULL,
  name_snapshot text NOT NULL,
  variant text,
  qty integer NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  line_total numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_online_order_items_order ON public.online_order_items (order_id);

GRANT SELECT, INSERT ON public.online_order_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.online_order_items TO authenticated;
GRANT ALL ON public.online_order_items TO service_role;

ALTER TABLE public.online_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert order items"
  ON public.online_order_items FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can read order items"
  ON public.online_order_items FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Staff can manage order items"
  ON public.online_order_items FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.online_orders o
      WHERE o.id = order_id
        AND (
          has_role(auth.uid(), o.restaurant_id, 'owner'::app_role)
          OR has_role(auth.uid(), o.restaurant_id, 'manager'::app_role)
          OR has_role(auth.uid(), o.restaurant_id, 'cashier'::app_role)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.online_orders o
      WHERE o.id = order_id
        AND (
          has_role(auth.uid(), o.restaurant_id, 'owner'::app_role)
          OR has_role(auth.uid(), o.restaurant_id, 'manager'::app_role)
          OR has_role(auth.uid(), o.restaurant_id, 'cashier'::app_role)
        )
    )
  );

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Assign sequential order number per restaurant
CREATE OR REPLACE FUNCTION public.assign_online_order_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num integer;
BEGIN
  IF NEW.order_number IS NULL OR NEW.order_number = 0 THEN
    SELECT COALESCE(MAX(order_number), 0) + 1
    INTO next_num
    FROM public.online_orders
    WHERE restaurant_id = NEW.restaurant_id;
    NEW.order_number := next_num;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_online_orders_assign_number
  BEFORE INSERT ON public.online_orders
  FOR EACH ROW EXECUTE FUNCTION public.assign_online_order_number();

-- Auto-stamp status timestamps
CREATE OR REPLACE FUNCTION public.stamp_online_order_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'confirmed' AND NEW.confirmed_at IS NULL THEN
      NEW.confirmed_at := now();
    ELSIF NEW.status = 'ready' AND NEW.ready_at IS NULL THEN
      NEW.ready_at := now();
    ELSIF NEW.status = 'completed' AND NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    ELSIF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN
      NEW.cancelled_at := now();
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_online_orders_stamp_status
  BEFORE UPDATE ON public.online_orders
  FOR EACH ROW EXECUTE FUNCTION public.stamp_online_order_status();

CREATE TRIGGER trg_online_ordering_settings_updated_at
  BEFORE UPDATE ON public.online_ordering_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.online_orders;
