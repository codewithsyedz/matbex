-- SuperAdmin billing console for Matbex's own subscriptions.
--
-- * subscription_payments.method: how a payment arrived. Moyasar payments are confirmed with
--   Moyasar; bank transfers and other offline payments are recorded by a SuperAdmin (with the
--   transfer reference) and applied through the same apply_subscription_payment, so they get a
--   tax invoice number and move the paid-until date exactly like an online payment.
-- * subscription_refunds: each refund (full or partial) with its own credit note number
--   (MBX-CN-000001); refunded_amount on the payment is the running total.
-- Only the server (service_role) writes these; owners read their own rows.

ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'moyasar'
    CHECK (method IN ('moyasar', 'bank_transfer', 'cash', 'other')),
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS refunded_amount numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.subscription_payments DROP CONSTRAINT IF EXISTS subscription_payments_refund_check;
ALTER TABLE public.subscription_payments ADD CONSTRAINT subscription_payments_refund_check
  CHECK (refunded_amount >= 0 AND refunded_amount <= amount);

CREATE SEQUENCE IF NOT EXISTS public.subscription_credit_note_seq;

CREATE TABLE IF NOT EXISTS public.subscription_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.subscription_payments(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- amount refunded including VAT, and the VAT part of it
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  vat_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  reason text NOT NULL,
  method text NOT NULL CHECK (method IN ('moyasar', 'offline')),
  moyasar_reference text,
  credit_note_number text NOT NULL UNIQUE
    DEFAULT ('MBX-CN-' || lpad(nextval('public.subscription_credit_note_seq')::text, 6, '0')),
  ended_period boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_refunds_payment_idx ON public.subscription_refunds (payment_id);
CREATE INDEX IF NOT EXISTS subscription_refunds_tenant_idx ON public.subscription_refunds (tenant_id, created_at DESC);

ALTER TABLE public.subscription_refunds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subscription_refunds_owner_read" ON public.subscription_refunds;
CREATE POLICY "subscription_refunds_owner_read" ON public.subscription_refunds
  FOR SELECT TO authenticated
  USING (tenant_id IS NOT NULL AND public.tenant_has_role(tenant_id, 'owner'));
GRANT SELECT ON public.subscription_refunds TO authenticated;
GRANT ALL ON public.subscription_refunds TO service_role;

-- Record a refund against a paid payment, once its money has gone back (the caller refunded it
-- at Moyasar, or confirmed an offline refund). Locks the payment so two refunds can never
-- exceed what was paid. Optionally ends the paid period now (full refund of a plan payment).
CREATE OR REPLACE FUNCTION public.record_subscription_refund(
  p_payment_id uuid, p_amount numeric, p_reason text, p_method text,
  p_moyasar_reference text, p_end_period boolean, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  p public.subscription_payments%ROWTYPE;
  v_vat numeric(12,2);
  r public.subscription_refunds%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.subscription_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND OR p.status <> 'paid' THEN
    RAISE EXCEPTION 'Only a paid payment can be refunded';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR round(p_amount, 2) > p.amount - p.refunded_amount THEN
    RAISE EXCEPTION 'The refund is more than what is left to refund (% SAR)', p.amount - p.refunded_amount;
  END IF;
  -- VAT in proportion to the payment's own VAT.
  v_vat := CASE WHEN p.amount > 0 THEN round(COALESCE(p.vat_amount, 0) * p_amount / p.amount, 2) ELSE 0 END;

  INSERT INTO public.subscription_refunds (payment_id, tenant_id, amount, vat_amount, reason, method, moyasar_reference, ended_period, created_by)
  VALUES (p.id, p.tenant_id, round(p_amount, 2), v_vat, p_reason, p_method, p_moyasar_reference, COALESCE(p_end_period, false), p_actor)
  RETURNING * INTO r;

  UPDATE public.subscription_payments
     SET refunded_amount = refunded_amount + round(p_amount, 2), updated_at = now()
   WHERE id = p.id;

  IF COALESCE(p_end_period, false) AND p.tenant_id IS NOT NULL THEN
    UPDATE public.tenants
       SET current_period_end = LEAST(COALESCE(current_period_end, now()), now()), updated_at = now()
     WHERE id = p.tenant_id;
  END IF;

  RETURN jsonb_build_object('refund_id', r.id, 'credit_note_number', r.credit_note_number, 'vat_amount', r.vat_amount);
END;
$function$;
REVOKE ALL ON FUNCTION public.record_subscription_refund(uuid, numeric, text, text, text, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_subscription_refund(uuid, numeric, text, text, text, boolean, uuid) TO service_role;
