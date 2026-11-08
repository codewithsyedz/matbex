ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS notify_expense_recorded boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.notify_managers_on_expense()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_recipient RECORD;
  v_tenant_id uuid;
  v_branch_name text;
  v_branch_code text;
  v_branch_label text;
  v_category text;
  v_supplier text;
  v_actor text;
  v_currency text := '﷼';
  v_title text;
  v_message text;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

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

  SELECT ec.name INTO v_category
  FROM public.expense_categories ec
  WHERE ec.id = NEW.category_id;

  SELECT s.name INTO v_supplier
  FROM public.suppliers s
  WHERE s.id = NEW.supplier_id;

  SELECT p.full_name INTO v_actor
  FROM public.profiles p
  WHERE p.id = NEW.created_by;

  v_title := 'New expense recorded • ' || v_branch_label;
  v_message := format(
    '%s %s%s%s%s',
    v_currency,
    to_char(COALESCE(NEW.amount, 0), 'FM999,999,990.00'),
    CASE WHEN v_category IS NOT NULL THEN ' • ' || v_category ELSE '' END,
    CASE WHEN v_supplier IS NOT NULL THEN ' • ' || v_supplier ELSE '' END,
    CASE WHEN COALESCE(NEW.status, 'unpaid') = 'paid' THEN ' • paid' ELSE ' • unpaid' END
  );

  FOR v_recipient IN
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.restaurant_id = NEW.restaurant_id
      AND ur.role IN ('owner','manager')
      AND ur.user_id IS DISTINCT FROM NEW.created_by
      AND COALESCE(
        (SELECT np.notify_expense_recorded AND np.in_app_enabled
           FROM public.notification_preferences np
          WHERE np.user_id = ur.user_id
            AND np.tenant_id = v_tenant_id
          LIMIT 1),
        true
      ) = true
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
        'expense_recorded',
        'expense',
        NEW.id,
        jsonb_build_object(
          'amount', COALESCE(NEW.amount, 0),
          'expense_date', NEW.expense_date,
          'category', v_category,
          'supplier', v_supplier,
          'payment_status', COALESCE(NEW.status, 'unpaid'),
          'approval_status', NEW.approval_status,
          'description', NEW.description,
          'recorded_by', v_actor,
          'branch_id', NEW.branch_id,
          'branch_name', v_branch_name,
          'branch_code', v_branch_code
        )
      );
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_managers_on_expense ON public.expenses;
CREATE TRIGGER trg_notify_managers_on_expense
AFTER INSERT ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.notify_managers_on_expense();