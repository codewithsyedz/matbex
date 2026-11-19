
-- ============= delivery_platform_locations: maps provider IDs → restaurant =============
CREATE TABLE public.delivery_platform_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_location_id text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_platform_locations_provider_chk
    CHECK (provider IN ('deliverect','otter','jahez','hungerstation','keeta','toyou','mrsool','careem','talabat')),
  CONSTRAINT delivery_platform_locations_unique
    UNIQUE (provider, external_location_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_platform_locations TO authenticated;
GRANT ALL ON public.delivery_platform_locations TO service_role;

ALTER TABLE public.delivery_platform_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members view their location mappings"
ON public.delivery_platform_locations FOR SELECT TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Owners/managers manage location mappings"
ON public.delivery_platform_locations FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.restaurant_id = delivery_platform_locations.restaurant_id
      AND ur.role IN ('owner','manager')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.restaurant_id = delivery_platform_locations.restaurant_id
      AND ur.role IN ('owner','manager')
  )
);

CREATE TRIGGER trg_delivery_platform_locations_updated_at
  BEFORE UPDATE ON public.delivery_platform_locations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============= delivery_orders =============
CREATE TABLE public.delivery_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  channel text,
  external_order_id text NOT NULL,
  external_location_id text,
  display_id text,
  status text NOT NULL DEFAULT 'received',
  customer_name text,
  customer_phone text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  tax numeric(12,2) NOT NULL DEFAULT 0,
  delivery_fee numeric(12,2) NOT NULL DEFAULT 0,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'SAR',
  order_type text,
  scheduled_at timestamptz,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature_valid boolean,
  received_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  cancelled_at timestamptz,
  cancelled_reason text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_orders_provider_chk
    CHECK (provider IN ('deliverect','otter','jahez','hungerstation','keeta','toyou','mrsool','careem','talabat')),
  CONSTRAINT delivery_orders_status_chk
    CHECK (status IN ('received','accepted','preparing','ready','dispatched','delivered','cancelled','failed')),
  CONSTRAINT delivery_orders_unique UNIQUE (provider, external_order_id)
);

CREATE INDEX idx_delivery_orders_restaurant ON public.delivery_orders(restaurant_id, status, received_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_delivery_orders_tenant ON public.delivery_orders(tenant_id, received_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_delivery_orders_provider ON public.delivery_orders(provider, received_at DESC) WHERE deleted_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_orders TO authenticated;
GRANT ALL ON public.delivery_orders TO service_role;

ALTER TABLE public.delivery_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members view delivery orders"
ON public.delivery_orders FOR SELECT TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant staff update delivery orders"
ON public.delivery_orders FOR UPDATE TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Owners/managers delete delivery orders"
ON public.delivery_orders FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.restaurant_id = delivery_orders.restaurant_id
      AND ur.role IN ('owner','manager')
  )
);

CREATE TRIGGER trg_delivery_orders_updated_at
  BEFORE UPDATE ON public.delivery_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
