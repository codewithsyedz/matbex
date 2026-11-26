-- move_stripe_customers_to_moyasar
--
-- Businesses paying through Stripe move to Moyasar billing: they keep the period they already
-- paid for (current_period_end, synced from Stripe), then renew through Moyasar from the Billing
-- page; the daily subscription-renewals job reminds them 7, 3 and 1 days before. Their Stripe
-- subscriptions must be set to cancel at the end of the period in the Stripe dashboard;
-- stripe-webhook now ignores Moyasar-billed accounts, so that cancellation does not cancel them.
--
-- An account with a Stripe customer but no known paid-until date stays on Stripe until an admin
-- sets current_period_end and billing_provider for it (otherwise it would count as expired).

UPDATE public.tenants
   SET billing_provider = 'moyasar', updated_at = now()
 WHERE billing_provider = 'stripe'
   AND stripe_customer_id IS NOT NULL
   AND current_period_end IS NOT NULL;
