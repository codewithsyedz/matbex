-- moyasar_payments
--
-- Online card payments (Moyasar) can now settle POS sales, so a payment record must be
-- something staff cannot fake:
--   * payment_intents are written only by the server functions (payments-create-intent,
--     payments-confirm, payments-webhook, payments-refund), which check the caller and verify
--     the status with the gateway. Browsers keep read access to their own tenant's rows.
--     Before, any staff member could insert an intent already marked 'captured', and managers
--     could update its status.
--   * gateway charges and refunds in payment_transactions likewise come only from the server;
--     staff can still record cash and external-terminal payments (payments-record-external).
--   * a captured intent settles at most one sale (sales_transaction_id, unique), and records
--     at most one successful charge (partial unique index), however often the gateway's
--     notification and the POS poll both report it.

ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS sales_transaction_id uuid UNIQUE
    REFERENCES public.sales_transactions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_one_charge_per_intent
  ON public.payment_transactions (intent_id)
  WHERE kind = 'charge' AND status = 'success' AND intent_id IS NOT NULL;

DROP POLICY IF EXISTS "pi_insert_same_tenant" ON public.payment_intents;
DROP POLICY IF EXISTS "pi_update_owner_manager" ON public.payment_intents;

DROP POLICY IF EXISTS "ptx_insert_same_tenant" ON public.payment_transactions;
CREATE POLICY "ptx_insert_same_tenant" ON public.payment_transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND kind IN ('cash', 'external_card_recorded')
    AND intent_id IS NULL
  );
