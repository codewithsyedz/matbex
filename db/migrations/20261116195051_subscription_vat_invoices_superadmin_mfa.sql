-- subscription_vat_invoices_superadmin_mfa
--
-- 1. Matbex's own subscription payments carry Saudi VAT: plan and add-on prices are published
--    excluding VAT, so a payment is subtotal + 15% VAT (amount = what Moyasar charges). Each paid
--    payment gets the next tax invoice number (MBX-000001...), shown to the owner in Billing.
-- 2. Superadmin rights need a second factor: is_superadmin(auth.uid()) is true only for a session
--    that passed two-factor (JWT aal2). It covers every RLS policy and function that checks it;
--    server functions check the token's aal themselves (requireSuperAdmin). A check made for another
--    user id (service-side lookups) is unchanged.

ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS subtotal numeric(12,2),
  ADD COLUMN IF NOT EXISTS vat_rate numeric(5,4) NOT NULL DEFAULT 0.15,
  ADD COLUMN IF NOT EXISTS vat_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS invoice_number text UNIQUE,
  ADD COLUMN IF NOT EXISTS invoiced_at timestamptz;

-- Payments made before VAT was added: amount was the price without VAT.
UPDATE public.subscription_payments
   SET subtotal = amount, vat_amount = 0, vat_rate = 0
 WHERE subtotal IS NULL;

CREATE SEQUENCE IF NOT EXISTS public.subscription_invoice_seq;

CREATE OR REPLACE FUNCTION public.trg_subscription_payment_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'paid' AND NEW.invoice_number IS NULL THEN
    NEW.invoice_number := 'MBX-' || lpad(nextval('public.subscription_invoice_seq')::text, 6, '0');
    NEW.invoiced_at := COALESCE(NEW.paid_at, now());
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.trg_subscription_payment_invoice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_subscription_payment_invoice ON public.subscription_payments;
CREATE TRIGGER trg_subscription_payment_invoice
  BEFORE INSERT OR UPDATE OF status ON public.subscription_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_subscription_payment_invoice();

-- Payments already paid get their numbers, oldest first.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.subscription_payments WHERE status = 'paid' AND invoice_number IS NULL ORDER BY paid_at NULLS LAST, created_at LOOP
    UPDATE public.subscription_payments
       SET invoice_number = 'MBX-' || lpad(nextval('public.subscription_invoice_seq')::text, 6, '0'),
           invoiced_at = COALESCE(paid_at, now())
     WHERE id = r.id;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.is_superadmin(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.superadmin_users WHERE user_id = _user_id)
     AND (
       _user_id IS DISTINCT FROM auth.uid()
       OR COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
     );
$function$;

-- Lets the admin screen tell "superadmin, second factor still needed" from "not a superadmin".
CREATE OR REPLACE FUNCTION public.superadmin_mfa_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'is_superadmin_account', EXISTS (SELECT 1 FROM public.superadmin_users WHERE user_id = auth.uid()),
    'aal', COALESCE(auth.jwt() ->> 'aal', 'aal1')
  );
$function$;
REVOKE ALL ON FUNCTION public.superadmin_mfa_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_mfa_status() TO authenticated;
