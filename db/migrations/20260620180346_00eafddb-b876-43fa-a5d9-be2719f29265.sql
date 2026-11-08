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
  v_tenant_id uuid;
BEGIN
  -- Resolve tenant_id from the restaurant; in_app_notifications.tenant_id FKs to tenants(id),
  -- but sales_transactions.restaurant_id is a restaurants(id). Fall back to restaurant_id when
  -- the row already happens to be a tenant id (legacy single-tenant rows).
  SELECT r.tenant_id INTO v_tenant_id
  FROM public.restaurants r
  WHERE r.id = NEW.restaurant_id;

  IF v_tenant_id IS NULL THEN
    -- No tenant resolvable -> skip notifications instead of failing the sale insert.
    RETURN NEW;
  END IF;

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
            AND np.tenant_id = v_tenant_id
          LIMIT 1),
        true
      ) = true
  LOOP
    BEGIN
      INSERT INTO public.in_app_notifications
        (user_id, tenant_id, title, message, action_type, entity_type, entity_id, metadata)
      VALUES (
        v_recipient.user_id,
        v_tenant_id,
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
    EXCEPTION WHEN foreign_key_violation OR others THEN
      -- Never let notification side-effects block the sale insert.
      NULL;
    END;
  END LOOP;

  RETURN NEW;
END;
$$;