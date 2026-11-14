ALTER TABLE public.plans
ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;