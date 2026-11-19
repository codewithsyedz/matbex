ALTER TABLE public.failed_sync_items
  ADD COLUMN IF NOT EXISTS operator_approved BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retry_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retry_requested_by UUID,
  ADD COLUMN IF NOT EXISTS last_retry_error TEXT;

CREATE OR REPLACE FUNCTION public.approve_failed_sync_item(_id UUID)
RETURNS public.failed_sync_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.failed_sync_items;
  _tenant UUID;
BEGIN
  SELECT tenant_id INTO _tenant FROM public.failed_sync_items WHERE id = _id;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'failed_sync_item not found';
  END IF;
  IF NOT (
    public.has_tenant_role(auth.uid(), _tenant, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), _tenant, 'manager'::app_role)
    OR public.has_tenant_role(auth.uid(), _tenant, 'superadmin'::app_role)
  ) THEN
    RAISE EXCEPTION 'not authorized to approve DLQ items';
  END IF;

  UPDATE public.failed_sync_items
     SET operator_approved = true,
         approved_by = auth.uid(),
         approved_at = now()
   WHERE id = _id
  RETURNING * INTO row;

  RETURN row;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_failed_sync_item(_id UUID)
RETURNS public.failed_sync_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.failed_sync_items;
  _tenant UUID;
  _approved BOOLEAN;
  _status TEXT;
BEGIN
  SELECT tenant_id, operator_approved, status
    INTO _tenant, _approved, _status
    FROM public.failed_sync_items WHERE id = _id;

  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'failed_sync_item not found';
  END IF;
  IF NOT (
    public.has_tenant_role(auth.uid(), _tenant, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), _tenant, 'manager'::app_role)
    OR public.has_tenant_role(auth.uid(), _tenant, 'superadmin'::app_role)
  ) THEN
    RAISE EXCEPTION 'not authorized to retry DLQ items';
  END IF;
  IF _status = 'resolved' THEN
    RAISE EXCEPTION 'item already resolved';
  END IF;
  IF NOT _approved THEN
    RAISE EXCEPTION 'operator approval required before retry';
  END IF;

  UPDATE public.failed_sync_items
     SET status = 'retrying',
         retry_count = retry_count + 1,
         retry_requested_at = now(),
         retry_requested_by = auth.uid()
   WHERE id = _id
  RETURNING * INTO row;

  RETURN row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_failed_sync_item(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retry_failed_sync_item(UUID) TO authenticated;