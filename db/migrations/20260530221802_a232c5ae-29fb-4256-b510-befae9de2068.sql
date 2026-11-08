
-- 1) Extend online_orders
ALTER TABLE public.online_orders
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS external_order_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS external_payload JSONB NULL,
  ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(12,2) NULL,
  ADD COLUMN IF NOT EXISTS table_id UUID NULL;

ALTER TABLE public.online_orders
  DROP CONSTRAINT IF EXISTS online_orders_channel_check;
ALTER TABLE public.online_orders
  ADD CONSTRAINT online_orders_channel_check
  CHECK (channel IN ('direct','hungerstation','jahez','mrsool','talabat','qr','waiter'));

CREATE UNIQUE INDEX IF NOT EXISTS uniq_online_orders_channel_external
  ON public.online_orders (restaurant_id, channel, external_order_id)
  WHERE external_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_online_orders_channel ON public.online_orders(channel);
CREATE INDEX IF NOT EXISTS idx_online_orders_table_id ON public.online_orders(table_id) WHERE table_id IS NOT NULL;

-- 2) Aggregator credentials
CREATE TABLE IF NOT EXISTS public.aggregator_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL,
  aggregator TEXT NOT NULL CHECK (aggregator IN ('hungerstation','jahez','mrsool','talabat')),
  store_id TEXT NOT NULL,
  api_key TEXT NULL,
  webhook_secret TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  auto_accept BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, aggregator),
  UNIQUE (aggregator, store_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.aggregator_credentials TO authenticated;
GRANT ALL ON public.aggregator_credentials TO service_role;

ALTER TABLE public.aggregator_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage aggregator creds"
ON public.aggregator_credentials
FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), restaurant_id, 'owner'::app_role)
  OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), restaurant_id, 'owner'::app_role)
  OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
);

CREATE TRIGGER trg_aggregator_credentials_updated_at
BEFORE UPDATE ON public.aggregator_credentials
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Aggregator webhook logs
CREATE TABLE IF NOT EXISTS public.aggregator_webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NULL,
  aggregator TEXT NOT NULL,
  store_id TEXT NULL,
  status TEXT NOT NULL,
  http_status INT NULL,
  external_order_id TEXT NULL,
  error_message TEXT NULL,
  payload_digest TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.aggregator_webhook_logs TO authenticated;
GRANT ALL ON public.aggregator_webhook_logs TO service_role;

ALTER TABLE public.aggregator_webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners view aggregator logs"
ON public.aggregator_webhook_logs
FOR SELECT
TO authenticated
USING (
  restaurant_id IS NOT NULL AND (
    has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  )
);

CREATE INDEX IF NOT EXISTS idx_aggregator_logs_restaurant_created
  ON public.aggregator_webhook_logs(restaurant_id, created_at DESC);

-- 4) Table QR codes
CREATE TABLE IF NOT EXISTS public.table_qr_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL,
  table_id UUID NOT NULL,
  token TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.table_qr_codes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.table_qr_codes TO authenticated;
GRANT ALL ON public.table_qr_codes TO service_role;

ALTER TABLE public.table_qr_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can resolve active token"
ON public.table_qr_codes
FOR SELECT
TO anon, authenticated
USING (active = true);

CREATE POLICY "Owners/managers manage qr"
ON public.table_qr_codes
FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), restaurant_id, 'owner'::app_role)
  OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), restaurant_id, 'owner'::app_role)
  OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
);

CREATE INDEX IF NOT EXISTS idx_table_qr_codes_restaurant ON public.table_qr_codes(restaurant_id);

-- 5) Waiter role
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'app_role' AND e.enumlabel = 'waiter'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'waiter';
  END IF;
END$$;
