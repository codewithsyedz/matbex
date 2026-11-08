
-- ============= pos_tables =============
CREATE TABLE public.pos_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  label text NOT NULL,
  code text NOT NULL,
  capacity int NOT NULL DEFAULT 4,
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uniq_pos_tables_code ON public.pos_tables(lower(code)) WHERE deleted_at IS NULL;
CREATE INDEX idx_pos_tables_restaurant ON public.pos_tables(restaurant_id) WHERE deleted_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_tables TO authenticated;
GRANT ALL ON public.pos_tables TO service_role;

ALTER TABLE public.pos_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view their tables"
ON public.pos_tables FOR SELECT TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Managers+ can insert tables"
ON public.pos_tables FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.restaurant_id = pos_tables.restaurant_id
      AND ur.role IN ('owner','manager')
  )
);

CREATE POLICY "Managers+ can update tables"
ON public.pos_tables FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.restaurant_id = pos_tables.restaurant_id
      AND ur.role IN ('owner','manager')
  )
);

CREATE POLICY "Managers+ can delete tables"
ON public.pos_tables FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.restaurant_id = pos_tables.restaurant_id
      AND ur.role IN ('owner','manager')
  )
);

CREATE TRIGGER trg_pos_tables_updated_at
  BEFORE UPDATE ON public.pos_tables
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============= pos_table_orders =============
CREATE TABLE public.pos_table_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES public.pos_tables(id) ON DELETE RESTRICT,
  access_token uuid NOT NULL DEFAULT gen_random_uuid(),
  guest_name text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  tax numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'submitted',
  notes text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  cancelled_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_table_orders_status_chk CHECK (status IN ('submitted','accepted','paid','cancelled'))
);

CREATE INDEX idx_pos_table_orders_restaurant ON public.pos_table_orders(restaurant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_pos_table_orders_table ON public.pos_table_orders(table_id) WHERE deleted_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_table_orders TO authenticated;
GRANT ALL ON public.pos_table_orders TO service_role;

ALTER TABLE public.pos_table_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view orders"
ON public.pos_table_orders FOR SELECT TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant staff can update orders"
ON public.pos_table_orders FOR UPDATE TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Managers+ can delete orders"
ON public.pos_table_orders FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.restaurant_id = pos_table_orders.restaurant_id
      AND ur.role IN ('owner','manager')
  )
);

CREATE TRIGGER trg_pos_table_orders_updated_at
  BEFORE UPDATE ON public.pos_table_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============= Public guest RPCs =============
CREATE OR REPLACE FUNCTION public.guest_lookup_table(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_table public.pos_tables%ROWTYPE;
  v_restaurant_name text;
  v_currency text;
  v_menu jsonb;
BEGIN
  SELECT * INTO v_table FROM public.pos_tables
    WHERE lower(code) = lower(p_code)
      AND is_active = true
      AND deleted_at IS NULL
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT name, currency INTO v_restaurant_name, v_currency
    FROM public.restaurants WHERE id = v_table.restaurant_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', m.id,
      'name', m.name,
      'description', m.description,
      'category', m.category,
      'selling_price', m.selling_price,
      'quarter_price', m.quarter_price,
      'half_price', m.half_price,
      'full_price', m.full_price,
      'image_url', m.image_url,
      'is_chefs_special', m.is_chefs_special,
      'allergens', m.allergens,
      'dietary_tags', m.dietary_tags
    ) ORDER BY m.category, m.name), '[]'::jsonb)
    INTO v_menu
    FROM public.menu_items m
    WHERE m.restaurant_id = v_table.restaurant_id
      AND m.is_active = true;

  RETURN jsonb_build_object(
    'found', true,
    'table', jsonb_build_object(
      'id', v_table.id,
      'label', v_table.label,
      'code', v_table.code,
      'capacity', v_table.capacity,
      'restaurant_id', v_table.restaurant_id,
      'branch_id', v_table.branch_id
    ),
    'restaurant', jsonb_build_object(
      'id', v_table.restaurant_id,
      'name', v_restaurant_name,
      'currency', COALESCE(v_currency, 'SAR')
    ),
    'menu', v_menu
  );
END;
$$;

REVOKE ALL ON FUNCTION public.guest_lookup_table(text) FROM public;
GRANT EXECUTE ON FUNCTION public.guest_lookup_table(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.guest_create_order(
  p_table_code text,
  p_guest_name text,
  p_items jsonb,
  p_subtotal numeric,
  p_tax numeric,
  p_total numeric,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table public.pos_tables%ROWTYPE;
  v_order_id uuid;
  v_token uuid;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;

  SELECT * INTO v_table FROM public.pos_tables
    WHERE lower(code) = lower(p_table_code)
      AND is_active = true
      AND deleted_at IS NULL
    LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Table not found';
  END IF;

  INSERT INTO public.pos_table_orders (
    tenant_id, restaurant_id, table_id, guest_name, items, subtotal, tax, total, notes, status
  ) VALUES (
    v_table.tenant_id, v_table.restaurant_id, v_table.id,
    NULLIF(trim(p_guest_name), ''),
    p_items, COALESCE(p_subtotal,0), COALESCE(p_tax,0), COALESCE(p_total,0),
    NULLIF(trim(p_notes), ''),
    'submitted'
  )
  RETURNING id, access_token INTO v_order_id, v_token;

  RETURN jsonb_build_object('id', v_order_id, 'access_token', v_token);
END;
$$;

REVOKE ALL ON FUNCTION public.guest_create_order(text, text, jsonb, numeric, numeric, numeric, text) FROM public;
GRANT EXECUTE ON FUNCTION public.guest_create_order(text, text, jsonb, numeric, numeric, numeric, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.guest_get_order(p_id uuid, p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', o.id,
    'status', o.status,
    'items', o.items,
    'subtotal', o.subtotal,
    'tax', o.tax,
    'total', o.total,
    'guest_name', o.guest_name,
    'submitted_at', o.submitted_at,
    'paid_at', o.paid_at,
    'table_label', t.label
  ) INTO v
  FROM public.pos_table_orders o
  JOIN public.pos_tables t ON t.id = o.table_id
  WHERE o.id = p_id AND o.access_token = p_token AND o.deleted_at IS NULL;

  RETURN COALESCE(v, jsonb_build_object('found', false));
END;
$$;

REVOKE ALL ON FUNCTION public.guest_get_order(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.guest_get_order(uuid, uuid) TO anon, authenticated;
