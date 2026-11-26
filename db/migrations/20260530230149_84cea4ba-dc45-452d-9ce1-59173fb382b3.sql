
CREATE TABLE public.loyalty_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL UNIQUE REFERENCES public.restaurants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  earn_rate_points_per_currency numeric NOT NULL DEFAULT 1,
  redemption_points_per_unit numeric NOT NULL DEFAULT 100,
  redemption_value_per_unit numeric NOT NULL DEFAULT 5,
  min_redeem_points numeric NOT NULL DEFAULT 100,
  max_redeem_pct numeric NOT NULL DEFAULT 50,
  tier_silver_threshold numeric NOT NULL DEFAULT 1000,
  tier_gold_threshold  numeric NOT NULL DEFAULT 5000,
  tier_silver_multiplier numeric NOT NULL DEFAULT 1.25,
  tier_gold_multiplier   numeric NOT NULL DEFAULT 1.5,
  expiry_months integer NOT NULL DEFAULT 12,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.loyalty_settings TO authenticated;
GRANT ALL ON public.loyalty_settings TO service_role;

ALTER TABLE public.loyalty_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant can view loyalty settings" ON public.loyalty_settings
  FOR SELECT TO authenticated USING (can_access_restaurant(restaurant_id));
CREATE POLICY "owners/managers manage loyalty settings" ON public.loyalty_settings
  FOR ALL TO authenticated
  USING (
    can_access_restaurant(restaurant_id)
    AND (has_tenant_role(auth.uid(), restaurant_id, 'owner'::app_role)
         OR has_tenant_role(auth.uid(), restaurant_id, 'manager'::app_role))
  )
  WITH CHECK (
    can_access_restaurant(restaurant_id)
    AND (has_tenant_role(auth.uid(), restaurant_id, 'owner'::app_role)
         OR has_tenant_role(auth.uid(), restaurant_id, 'manager'::app_role))
  );

CREATE TRIGGER trg_loyalty_settings_updated_at BEFORE UPDATE ON public.loyalty_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DO $$ BEGIN
  CREATE TYPE public.loyalty_tier AS ENUM ('bronze','silver','gold');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS points_balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_points numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tier public.loyalty_tier NOT NULL DEFAULT 'bronze',
  ADD COLUMN IF NOT EXISTS last_engagement_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT true;

CREATE TABLE public.loyalty_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('earn','redeem','adjust','expire')),
  points numeric NOT NULL,
  currency_value numeric NOT NULL DEFAULT 0,
  sales_transaction_id uuid REFERENCES public.sales_transactions(id) ON DELETE SET NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_loyalty_tx_customer ON public.loyalty_transactions(customer_id, created_at DESC);
CREATE INDEX idx_loyalty_tx_restaurant ON public.loyalty_transactions(restaurant_id, created_at DESC);

GRANT SELECT, INSERT ON public.loyalty_transactions TO authenticated;
GRANT ALL ON public.loyalty_transactions TO service_role;

ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant view loyalty tx" ON public.loyalty_transactions
  FOR SELECT TO authenticated USING (can_access_restaurant(restaurant_id));
CREATE POLICY "tenant insert loyalty tx" ON public.loyalty_transactions
  FOR INSERT TO authenticated WITH CHECK (can_access_restaurant(restaurant_id));

CREATE OR REPLACE FUNCTION public.apply_loyalty_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.loyalty_settings%ROWTYPE;
  new_lifetime numeric;
  new_tier public.loyalty_tier;
BEGIN
  SELECT * INTO s FROM public.loyalty_settings WHERE restaurant_id = NEW.restaurant_id;

  UPDATE public.customers
    SET points_balance = points_balance + NEW.points,
        lifetime_points = lifetime_points + GREATEST(NEW.points, 0),
        last_engagement_at = now()
    WHERE id = NEW.customer_id
    RETURNING lifetime_points INTO new_lifetime;

  IF s.id IS NOT NULL THEN
    IF new_lifetime >= s.tier_gold_threshold THEN new_tier := 'gold';
    ELSIF new_lifetime >= s.tier_silver_threshold THEN new_tier := 'silver';
    ELSE new_tier := 'bronze';
    END IF;
    UPDATE public.customers SET tier = new_tier WHERE id = NEW.customer_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_apply_loyalty_tx
  AFTER INSERT ON public.loyalty_transactions
  FOR EACH ROW EXECUTE FUNCTION public.apply_loyalty_transaction();

CREATE TABLE public.reengagement_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('whatsapp','email','sms')),
  template text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')),
  error text,
  sent_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reengage_customer ON public.reengagement_messages(customer_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.reengagement_messages TO authenticated;
GRANT ALL ON public.reengagement_messages TO service_role;

ALTER TABLE public.reengagement_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant view reengage" ON public.reengagement_messages
  FOR SELECT TO authenticated USING (can_access_restaurant(restaurant_id));
CREATE POLICY "tenant insert reengage" ON public.reengagement_messages
  FOR INSERT TO authenticated WITH CHECK (can_access_restaurant(restaurant_id));
CREATE POLICY "tenant update reengage" ON public.reengagement_messages
  FOR UPDATE TO authenticated USING (can_access_restaurant(restaurant_id));
