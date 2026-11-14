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
  v_branch_name text;
  v_branch_code text;
  v_branch_label text;
BEGIN
  SELECT r.tenant_id INTO v_tenant_id
  FROM public.restaurants r
  WHERE r.id = NEW.restaurant_id;

  IF v_tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.branch_id IS NOT NULL THEN
    SELECT b.name, b.code INTO v_branch_name, v_branch_code
    FROM public.branches b
    WHERE b.id = NEW.branch_id;
  END IF;

  v_branch_label := COALESCE(v_branch_name, 'Unassigned branch');

  v_title := 'New sale recorded • ' || v_branch_label;
  v_message := format(
    '%s %s sale via %s%s • %s',
    v_currency,
    to_char(NEW.total, 'FM999,999,990.00'),
    NEW.payment_method,
    CASE WHEN NEW.receipt_number IS NOT NULL
         THEN ' • #' || NEW.receipt_number
         ELSE '' END,
    v_branch_label || CASE WHEN v_branch_code IS NOT NULL THEN ' (' || v_branch_code || ')' ELSE '' END
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
      -- Branch scoping: staff pinned to a branch only get their branch's sales.
      AND (
        NEW.branch_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.staff s
          WHERE s.user_id = ur.user_id
            AND s.restaurant_id = NEW.restaurant_id
            AND s.is_active = true
            AND s.assigned_branch_id IS NOT NULL
            AND s.assigned_branch_id <> NEW.branch_id
        )
      )
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
          'is_delivery', NEW.is_delivery,
          'branch_id', NEW.branch_id,
          'branch_name', v_branch_name,
          'branch_code', v_branch_code
        )
      );
    EXCEPTION WHEN foreign_key_violation OR others THEN
      NULL;
    END;
  END LOOP;

  RETURN NEW;
END;
$$;