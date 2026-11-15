-- tenant_addons_provider_moyasar
--
-- Add-ons are now paid through Moyasar (apply_subscription_payment sets provider = 'moyasar').
ALTER TABLE public.tenant_addons DROP CONSTRAINT IF EXISTS tenant_addons_provider_check;
ALTER TABLE public.tenant_addons ADD CONSTRAINT tenant_addons_provider_check
  CHECK (provider = ANY (ARRAY['stripe'::text, 'checkout_com'::text, 'manual'::text, 'moyasar'::text]));
