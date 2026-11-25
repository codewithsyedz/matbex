-- The guest's QR page shows whether staff accepted the order (docs/plans/open-checks.md, 2b.3).
-- guest_get_order was revoked from anon on 2026-11-09 because nothing used it. It is public
-- again, but returns only what the guest who placed the order already knows, plus its status
-- and the reason staff gave when they rejected it. The caller needs the order id and its
-- random access_token, which only guest_create_order returns.

CREATE OR REPLACE FUNCTION public.guest_get_order(p_id uuid, p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF p_id IS NULL OR p_token IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT jsonb_build_object(
    'found', true,
    'id', o.id,
    'status', o.status,
    'items', o.items,
    'total', o.total,
    'submitted_at', o.submitted_at,
    'accepted_at', o.accepted_at,
    'cancelled_at', o.cancelled_at,
    'reject_reason', o.reject_reason,
    'table_label', t.label
  ) INTO v
  FROM public.pos_table_orders o
  JOIN public.pos_tables t ON t.id = o.table_id
  WHERE o.id = p_id AND o.access_token = p_token AND o.deleted_at IS NULL;

  RETURN COALESCE(v, jsonb_build_object('found', false));
END;
$$;

REVOKE ALL ON FUNCTION public.guest_get_order(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_get_order(uuid, uuid) TO anon, authenticated, service_role;
