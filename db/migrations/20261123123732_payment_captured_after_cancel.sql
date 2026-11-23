-- payment_captured_after_cancel
--
-- A POS card payment can be cancelled by the cashier (payments-cancel) or expired by the
-- reconciler while the customer still has the Moyasar page open. If the gateway later reports
-- it paid (webhook, reconciler or confirm), the money arrived but no sale was recorded.
-- applyVerifiedStatus still stores the capture (and its payment_transactions charge); this
-- trigger makes sure the owner hears about it instead of it passing silently:
--   * metadata.captured_after_close = true (+ previous status and time) on the intent;
--   * an in-app notification to the restaurant's owners and managers;
--   * a 'payments.intent.captured_after_cancel' event on the restaurant's 'sales' topic.
-- All in the same transaction as the status change (transactional outbox).

CREATE OR REPLACE FUNCTION public.trg_payment_intent_captured_after_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, platform
AS $$
DECLARE
  v_restaurant_id uuid;
  v_branch_name text;
  v_recipient record;
  v_message text;
BEGIN
  IF NOT (OLD.status IN ('canceled', 'expired', 'failed') AND NEW.status = 'captured') THEN
    RETURN NEW;
  END IF;

  NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
    'captured_after_close', true,
    'closed_status', OLD.status::text,
    'captured_after_close_at', now()
  );

  IF NEW.branch_id IS NOT NULL THEN
    SELECT b.restaurant_id, b.name INTO v_restaurant_id, v_branch_name
    FROM public.branches b WHERE b.id = NEW.branch_id;
  END IF;
  IF v_restaurant_id IS NULL THEN
    SELECT r.id INTO v_restaurant_id
    FROM public.restaurants r WHERE r.tenant_id = NEW.tenant_id
    ORDER BY r.created_at LIMIT 1;
  END IF;

  v_message := format(
    '%s %s card payment was paid after it was %s on the POS%s. No sale was recorded for it: ring up the sale or refund the customer.',
    NEW.currency, to_char(NEW.amount, 'FM999,999,990.00'),
    CASE OLD.status WHEN 'canceled' THEN 'cancelled' ELSE OLD.status::text END,
    CASE WHEN v_branch_name IS NOT NULL THEN ' (' || v_branch_name || ')' ELSE '' END
  );

  FOR v_recipient IN
    SELECT ur.user_id FROM public.user_roles ur
     WHERE v_restaurant_id IS NOT NULL AND ur.restaurant_id = v_restaurant_id
       AND ur.role::text IN ('owner', 'manager')
    UNION
    SELECT utr.user_id FROM public.user_tenant_roles utr
     WHERE utr.tenant_id = NEW.tenant_id AND utr.role::text IN ('owner', 'manager')
  LOOP
    BEGIN
      INSERT INTO public.in_app_notifications
        (user_id, tenant_id, title, message, action_type, entity_type, entity_id, metadata)
      VALUES (
        v_recipient.user_id, NEW.tenant_id,
        'Card payment received after cancel',
        v_message,
        'payment_captured_after_cancel',
        'payment_intent',
        NEW.id,
        jsonb_build_object('amount', NEW.amount, 'currency', NEW.currency, 'closed_status', OLD.status::text,
                           'branch_id', NEW.branch_id, 'gateway', NEW.gateway::text,
                           'gateway_reference', NEW.gateway_reference)
      );
    EXCEPTION WHEN others THEN
      NULL; -- a notification problem must never block storing the capture
    END;
  END LOOP;

  IF v_restaurant_id IS NOT NULL THEN
    PERFORM platform.emit_event('sales', 'payments.intent.captured_after_cancel', v_restaurant_id, NEW.id,
      jsonb_build_object('id', NEW.id, 'branch_id', NEW.branch_id, 'amount', NEW.amount,
                         'closed_status', OLD.status::text));
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_payment_intent_captured_after_close() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payment_intent_captured_after_close ON public.payment_intents;
CREATE TRIGGER payment_intent_captured_after_close
  BEFORE UPDATE OF status ON public.payment_intents
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.trg_payment_intent_captured_after_close();
