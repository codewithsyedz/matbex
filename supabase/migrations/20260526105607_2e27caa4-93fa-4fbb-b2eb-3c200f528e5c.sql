-- Stripe webhook support: add Stripe customer id + current period + expand tenant statuses

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS current_period_end timestamp with time zone;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_stripe_customer_id_uniq
  ON public.tenants (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- Backfill from license_status_cache where possible
UPDATE public.tenants t
   SET stripe_customer_id = lsc.stripe_customer_id
  FROM public.license_status_cache lsc
 WHERE lsc.tenant_id = t.id
   AND lsc.stripe_customer_id IS NOT NULL
   AND t.stripe_customer_id IS NULL;

-- Expand the status check to cover Stripe lifecycle states
ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_status_check;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'trial'::text, 'suspended'::text, 'archived'::text, 'past_due'::text, 'canceled'::text]));