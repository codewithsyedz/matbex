
-- Global customer accounts (phone + OTP)
CREATE TABLE public.customer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  name text,
  email text,
  last_seen_at timestamptz,
  blocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_profiles_phone ON public.customer_profiles(phone);

GRANT ALL ON public.customer_profiles TO service_role;
ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies: all access is through edge functions using service role.

CREATE TABLE public.customer_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_otps_phone_created ON public.customer_otps(phone, created_at DESC);

GRANT ALL ON public.customer_otps TO service_role;
ALTER TABLE public.customer_otps ENABLE ROW LEVEL SECURITY;

-- Link online_orders to a global customer (nullable for guest orders + backfill safety)
ALTER TABLE public.online_orders
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customer_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_online_orders_customer ON public.online_orders(customer_id, created_at DESC);

-- updated_at trigger reuse
CREATE TRIGGER trg_customer_profiles_updated_at
  BEFORE UPDATE ON public.customer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
