-- 1. Extend the payment_gateway enum with checkout_com
ALTER TYPE public.payment_gateway ADD VALUE IF NOT EXISTS 'checkout_com';

-- 2. Track which billing provider a tenant addon was purchased through
ALTER TABLE public.tenant_addons
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe';

-- Optional sanity check constraint (drop+add to be idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_addons_provider_check'
  ) THEN
    ALTER TABLE public.tenant_addons
      ADD CONSTRAINT tenant_addons_provider_check
      CHECK (provider IN ('stripe','checkout_com','manual'));
  END IF;
END $$;

-- Index for filtering active addons by provider
CREATE INDEX IF NOT EXISTS idx_tenant_addons_provider
  ON public.tenant_addons(tenant_id, provider, status);
