-- moyasar_subscription_billing
--
-- Matbex's own subscription billing moves from Stripe to Matbex's Moyasar account. Moyasar's
-- payment pages charge once, so a business pays each period up front (a month, or a year at
-- 10 months' price) and the payment extends tenants.current_period_end. Add-ons are paid up
-- to the same date and renewed with the plan. Paid-plan registrations pay the same way.
--
-- subscription_payments holds every Moyasar payment for Matbex itself: what it was for, the
-- amount the server computed, and what it changes once paid. Browsers read their own
-- business's rows (owners); only the server writes them, and apply_subscription_payment is the
-- one place a confirmed payment changes the account, once (row lock + status check).

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS billing_provider text NOT NULL DEFAULT 'stripe'
    CHECK (billing_provider IN ('stripe', 'moyasar'));

CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.tenant_applications(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('plan', 'addon', 'registration')),
  -- plan: new | renew | upgrade | downgrade; addon: addon; registration: registration
  mode text NOT NULL,
  plan_id uuid REFERENCES public.plans(id),
  addon_id uuid REFERENCES public.addons(id),
  -- add-ons renewed together with the plan: [{ addon_id, amount }]
  addon_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  months int NOT NULL DEFAULT 0 CHECK (months >= 0 AND months <= 12),
  branches int NOT NULL DEFAULT 1 CHECK (branches >= 1),
  amount numeric(12,2) NOT NULL CHECK (amount >= 1),
  currency text NOT NULL DEFAULT 'SAR' CHECK (currency = 'SAR'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'canceled')),
  moyasar_invoice_id text UNIQUE,
  moyasar_payment_id text,
  pay_url text,
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (tenant_id IS NOT NULL OR application_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS subscription_payments_tenant_idx ON public.subscription_payments (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS subscription_payments_application_idx ON public.subscription_payments (application_id) WHERE application_id IS NOT NULL;

ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subscription_payments_owner_read" ON public.subscription_payments;
CREATE POLICY "subscription_payments_owner_read" ON public.subscription_payments
  FOR SELECT TO authenticated
  USING (tenant_id IS NOT NULL AND public.tenant_has_role(tenant_id, 'owner'));
GRANT SELECT ON public.subscription_payments TO authenticated;
GRANT ALL ON public.subscription_payments TO service_role;

-- Apply a payment Moyasar confirmed as paid (the caller verified it with Moyasar's API).
-- Idempotent: a second call for the same payment changes nothing and returns the stored row.
CREATE OR REPLACE FUNCTION public.apply_subscription_payment(p_payment_id uuid, p_moyasar_payment_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  p public.subscription_payments%ROWTYPE;
  v_end timestamptz;
  v_start timestamptz;
  v_new_end timestamptz;
  v_item jsonb;
BEGIN
  SELECT * INTO p FROM public.subscription_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription payment not found';
  END IF;
  IF p.status = 'paid' THEN
    RETURN jsonb_build_object('applied', false, 'already_paid', true, 'period_end', p.period_end);
  END IF;

  IF p.kind = 'registration' THEN
    -- The registration function provisions the account, then links tenant_id here.
    UPDATE public.subscription_payments
       SET status = 'paid', paid_at = now(), moyasar_payment_id = p_moyasar_payment_id, updated_at = now()
     WHERE id = p.id;
    RETURN jsonb_build_object('applied', true, 'kind', 'registration');
  END IF;

  SELECT current_period_end INTO v_end FROM public.tenants WHERE id = p.tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found';
  END IF;

  IF p.kind = 'plan' AND p.mode = 'upgrade' THEN
    -- Same paid-until date, higher plan from now.
    UPDATE public.tenants
       SET plan_id = p.plan_id, status = 'active', trial_ends_at = NULL, billing_provider = 'moyasar', updated_at = now()
     WHERE id = p.tenant_id;
    v_start := now();
    v_new_end := v_end;
  ELSIF p.kind = 'plan' THEN
    -- New, renewal or downgrade: the period starts when the paid one ends (or now).
    v_start := GREATEST(now(), COALESCE(v_end, now()));
    v_new_end := v_start + make_interval(months => p.months);
    UPDATE public.tenants
       SET plan_id = p.plan_id, status = 'active', trial_ends_at = NULL, billing_provider = 'moyasar',
           current_period_end = v_new_end, updated_at = now()
     WHERE id = p.tenant_id;
    -- Add-ons paid with the renewal run to the new date.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p.addon_items) LOOP
      UPDATE public.tenant_addons
         SET status = 'active', expires_at = v_new_end, provider = 'moyasar', updated_at = now()
       WHERE tenant_id = p.tenant_id AND addon_id = (v_item->>'addon_id')::uuid
         AND status IN ('active', 'expired', 'pending');
    END LOOP;
  ELSE
    -- Add-on bought mid-period: active until the plan's paid-until date.
    v_start := now();
    v_new_end := v_end;
    UPDATE public.tenant_addons
       SET status = 'active', activated_at = COALESCE(activated_at, now()), expires_at = v_end,
           provider = 'moyasar', source = 'purchase', updated_at = now()
     WHERE tenant_id = p.tenant_id AND addon_id = p.addon_id;
    IF NOT FOUND THEN
      INSERT INTO public.tenant_addons (tenant_id, addon_id, status, source, provider, activated_at, expires_at)
      VALUES (p.tenant_id, p.addon_id, 'active', 'purchase', 'moyasar', now(), v_end);
    END IF;
  END IF;

  UPDATE public.subscription_payments
     SET status = 'paid', paid_at = now(), moyasar_payment_id = p_moyasar_payment_id,
         period_start = v_start, period_end = v_new_end, updated_at = now()
   WHERE id = p.id;

  RETURN jsonb_build_object('applied', true, 'kind', p.kind, 'mode', p.mode, 'period_end', v_new_end);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_subscription_payment(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_subscription_payment(uuid, text) TO service_role;
