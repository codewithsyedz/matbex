CREATE TABLE public.promotion_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  badge_label text NOT NULL DEFAULT 'Founding 100',
  headline text NOT NULL,
  subheadline text,
  max_slots integer NOT NULL DEFAULT 100 CHECK (max_slots > 0),
  claimed_slots integer NOT NULL DEFAULT 0 CHECK (claimed_slots >= 0),
  discount_percent numeric(5,2) NOT NULL DEFAULT 50 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  target_plan_id uuid REFERENCES public.plans(id) ON DELETE SET NULL,
  locked_price_forever boolean NOT NULL DEFAULT true,
  perks jsonb NOT NULL DEFAULT '[]'::jsonb,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.promotion_campaigns TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.promotion_campaigns TO authenticated;
GRANT ALL ON public.promotion_campaigns TO service_role;

ALTER TABLE public.promotion_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active campaigns"
ON public.promotion_campaigns FOR SELECT
USING (is_active = true AND (ends_at IS NULL OR ends_at > now()));

CREATE POLICY "SuperAdmins view all campaigns"
ON public.promotion_campaigns FOR SELECT
TO authenticated
USING (public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmins manage campaigns"
ON public.promotion_campaigns FOR ALL
TO authenticated
USING (public.is_superadmin(auth.uid()))
WITH CHECK (public.is_superadmin(auth.uid()));

CREATE TABLE public.promotion_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.promotion_campaigns(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  slot_number integer NOT NULL,
  discount_applied numeric(5,2) NOT NULL,
  locked_price numeric(10,2),
  original_price numeric(10,2),
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, tenant_id),
  UNIQUE(campaign_id, slot_number)
);

GRANT SELECT, INSERT ON public.promotion_redemptions TO authenticated;
GRANT ALL ON public.promotion_redemptions TO service_role;

ALTER TABLE public.promotion_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SuperAdmins view all redemptions"
ON public.promotion_redemptions FOR SELECT
TO authenticated
USING (public.is_superadmin(auth.uid()));

CREATE POLICY "Tenants view their own redemption"
ON public.promotion_redemptions FOR SELECT
TO authenticated
USING (tenant_id IN (
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
));

CREATE OR REPLACE FUNCTION public.claim_promotion_slot(
  _campaign_id uuid,
  _tenant_id uuid,
  _original_price numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign promotion_campaigns%ROWTYPE;
  v_slot integer;
  v_locked_price numeric;
  v_redemption_id uuid;
BEGIN
  SELECT * INTO v_campaign FROM promotion_campaigns
  WHERE id = _campaign_id AND is_active = true
    AND (ends_at IS NULL OR ends_at > now())
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'campaign_not_active');
  END IF;

  IF v_campaign.claimed_slots >= v_campaign.max_slots THEN
    RETURN jsonb_build_object('success', false, 'reason', 'slots_exhausted');
  END IF;

  IF EXISTS (SELECT 1 FROM promotion_redemptions WHERE campaign_id = _campaign_id AND tenant_id = _tenant_id) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_redeemed');
  END IF;

  v_slot := v_campaign.claimed_slots + 1;
  v_locked_price := CASE
    WHEN _original_price IS NOT NULL THEN ROUND(_original_price * (1 - v_campaign.discount_percent/100), 2)
    ELSE NULL
  END;

  INSERT INTO promotion_redemptions (
    campaign_id, tenant_id, slot_number, discount_applied, locked_price, original_price
  ) VALUES (
    _campaign_id, _tenant_id, v_slot, v_campaign.discount_percent, v_locked_price, _original_price
  ) RETURNING id INTO v_redemption_id;

  UPDATE promotion_campaigns
  SET claimed_slots = v_slot, updated_at = now()
  WHERE id = _campaign_id;

  RETURN jsonb_build_object(
    'success', true,
    'redemption_id', v_redemption_id,
    'slot_number', v_slot,
    'discount_percent', v_campaign.discount_percent,
    'locked_price', v_locked_price,
    'locked_forever', v_campaign.locked_price_forever
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_promotion_slot(uuid, uuid, numeric) TO authenticated, service_role;

CREATE TRIGGER trg_promotion_campaigns_updated_at
BEFORE UPDATE ON public.promotion_campaigns
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.promotion_campaigns (
  name, badge_label, headline, subheadline,
  max_slots, discount_percent, locked_price_forever,
  perks, is_active
) VALUES (
  'Founding 100 — Launch Cohort',
  'Founding 100',
  'Lock in 99 ﷼/month forever',
  'The first 100 restaurants get 50% off Growth Bundle for life — plus free data migration, founder WhatsApp line, and your logo on our Trusted by wall.',
  100, 50, true,
  '["50% off Growth Bundle — locked forever","Free data migration & onboarding","Direct WhatsApp line to founders","Logo on Trusted by wall","+1 free month per referral (stackable)"]'::jsonb,
  true
);