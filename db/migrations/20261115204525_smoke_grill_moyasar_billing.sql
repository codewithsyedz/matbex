-- smoke_grill_moyasar_billing
--
-- Smoke Grill (Enterprise) moves from Stripe to Moyasar billing: paid until 5 Dec 2026 (end of
-- that day, Riyadh), confirmed by the account holder on 2026-11-15. Its Stripe subscription is
-- cancelled at period end in the Stripe dashboard; from then on it renews from the Billing page.
-- Only applies where that business exists and is still on Stripe billing.
UPDATE public.tenants
   SET billing_provider = 'moyasar',
       current_period_end = '2026-12-05 23:59:59+03',
       updated_at = now()
 WHERE id = 'fe1a4d9e-1595-43ba-a47a-37575a9a55b9'
   AND billing_provider = 'stripe';
