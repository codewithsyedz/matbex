-- Per-user toggle for sale notifications (default on)
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS notify_sale_recorded boolean NOT NULL DEFAULT true;

-- Function: notify owners/managers when a sale is recorded
CREATE OR REPLACE FUNCTION public.notify_managers_on_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient RECORD;
  v_title text;
  v_message text;
  v_currency text := '﷼';
BEGIN
  v_title := 'New sale recorded';
  v_message := format(
    '%s %s sale via %s%s',
    v_currency,
    to_char(NEW.total, 'FM999,999,990.00'),
    NEW.payment_method,
    CASE WHEN NEW.receipt_number IS NOT NULL
         THEN ' • #' || NEW.receipt_number
         ELSE '' END
  );

  FOR v_recipient IN
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.restaurant_id = NEW.restaurant_id
      AND ur.role IN ('owner','manager')
      AND COALESCE(
        (SELECT np.notify_sale_recorded AND np.in_app_enabled
           FROM public.notification_preferences np
          WHERE np.user_id = ur.user_id
            AND np.tenant_id = NEW.restaurant_id
          LIMIT 1),
        true
      ) = true
  LOOP
    INSERT INTO public.in_app_notifications
      (user_id, tenant_id, title, message, action_type, entity_type, entity_id, metadata)
    VALUES (
      v_recipient.user_id,
      NEW.restaurant_id,
      v_title,
      v_message,
      'sale_recorded',
      'sales_transaction',
      NEW.id,
      jsonb_build_object(
        'total', NEW.total,
        'subtotal', NEW.subtotal,
        'tax', NEW.tax,
        'payment_method', NEW.payment_method,
        'receipt_number', NEW.receipt_number,
        'shift_id', NEW.shift_id,
        'is_delivery', NEW.is_delivery
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_managers_on_sale ON public.sales_transactions;
CREATE TRIGGER trg_notify_managers_on_sale
AFTER INSERT ON public.sales_transactions
FOR EACH ROW
EXECUTE FUNCTION public.notify_managers_on_sale();