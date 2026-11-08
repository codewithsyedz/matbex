-- 1) Table
CREATE TABLE IF NOT EXISTS public.failed_sync_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  restaurant_id UUID,
  branch_id UUID,
  terminal_id UUID,
  event_type TEXT NOT NULL,
  event_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  error_message TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','retrying','resolved','discarded')),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_failed_sync_items_tenant_status ON public.failed_sync_items(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_failed_sync_items_branch ON public.failed_sync_items(branch_id) WHERE branch_id IS NOT NULL;

-- 2) Grants
GRANT SELECT, INSERT, UPDATE ON public.failed_sync_items TO authenticated;
GRANT ALL ON public.failed_sync_items TO service_role;

-- 3) RLS
ALTER TABLE public.failed_sync_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners and managers can view failed sync items"
ON public.failed_sync_items FOR SELECT TO authenticated
USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_tenant_role(auth.uid(), public.get_user_tenant_id(auth.uid()), 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), public.get_user_tenant_id(auth.uid()), 'manager'::app_role)
    OR public.has_tenant_role(auth.uid(), public.get_user_tenant_id(auth.uid()), 'superadmin'::app_role)
  )
 );

CREATE POLICY "Owners and managers can update failed sync items"
ON public.failed_sync_items FOR UPDATE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_tenant_role(auth.uid(), public.get_user_tenant_id(auth.uid()), 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), public.get_user_tenant_id(auth.uid()), 'manager'::app_role)
    OR public.has_tenant_role(auth.uid(), public.get_user_tenant_id(auth.uid()), 'superadmin'::app_role)
  )
 )
WITH CHECK (
  tenant_id = public.get_user_tenant_id(auth.uid())
);

-- 4) updated_at trigger
CREATE TRIGGER update_failed_sync_items_updated_at
BEFORE UPDATE ON public.failed_sync_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Notify owners on insert
CREATE OR REPLACE FUNCTION public.notify_owners_on_failed_sync_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_user_id UUID;
  title_text TEXT;
  msg_text TEXT;
BEGIN
  title_text := 'POS sync failure';
  msg_text := format('Failed sync: %s%s — %s',
    NEW.event_type,
    CASE WHEN NEW.branch_id IS NOT NULL THEN ' (branch)' ELSE '' END,
    left(coalesce(NEW.error_message,'unknown error'), 240)
  );

  -- Fan out in-app notifications to every owner in the tenant
  FOR owner_user_id IN
    SELECT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role = 'owner'
      AND p.tenant_id = NEW.tenant_id
  LOOP
    INSERT INTO public.in_app_notifications (
      user_id, tenant_id, title, message, action_type, entity_type, entity_id, metadata, is_read
    ) VALUES (
      owner_user_id,
      NEW.tenant_id,
      title_text,
      msg_text,
      'sync_failure',
      'failed_sync_item',
      NEW.id,
      jsonb_build_object(
        'event_type', NEW.event_type,
        'event_id', NEW.event_id,
        'branch_id', NEW.branch_id,
        'terminal_id', NEW.terminal_id,
        'error_code', NEW.error_code,
        'retry_count', NEW.retry_count
      ),
      false
    );
  END LOOP;

  -- Enqueue WhatsApp alerts for subscribed owners (edge worker delivers)
  INSERT INTO public.pending_digest_notifications (
    tenant_id, user_id, channel, subject, body, metadata, status, created_at
  )
  SELECT
    NEW.tenant_id,
    ows.user_id,
    'whatsapp',
    title_text,
    msg_text,
    jsonb_build_object(
      'phone_e164', ows.phone_e164,
      'failed_sync_item_id', NEW.id,
      'event_type', NEW.event_type,
      'branch_id', NEW.branch_id
    ),
    'pending',
    now()
  FROM public.owner_whatsapp_subscriptions ows
  JOIN public.restaurants r ON r.id = ows.restaurant_id
  WHERE r.tenant_id = NEW.tenant_id
    AND ows.enabled = true
  ON CONFLICT DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block DLQ inserts because of a notification hiccup
  RAISE WARNING 'notify_owners_on_failed_sync_item failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_owners_on_failed_sync_item ON public.failed_sync_items;
CREATE TRIGGER trg_notify_owners_on_failed_sync_item
AFTER INSERT ON public.failed_sync_items
FOR EACH ROW EXECUTE FUNCTION public.notify_owners_on_failed_sync_item();