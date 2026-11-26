-- moyasar_paid_accounts_active
--
-- The Stripe subscriptions of accounts moved to Moyasar billing were cancelled outright
-- (2026-11-15), and the still-running hosted system's stripe-webhook marks such accounts
-- 'canceled' / 'past_due'. For Moyasar-billed accounts the paid-until date decides: still paid
-- means active. Runs again harmlessly on the production copy at cutover.
UPDATE public.tenants
   SET status = 'active', updated_at = now()
 WHERE billing_provider = 'moyasar'
   AND status IN ('canceled', 'past_due')
   AND current_period_end > now();
