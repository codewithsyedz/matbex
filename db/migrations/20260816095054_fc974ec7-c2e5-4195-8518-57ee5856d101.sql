CREATE OR REPLACE FUNCTION public.backfill_supplier_ap_accounts(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_created int := 0;
  v_acct uuid;
BEGIN
  IF NOT public.can_access_restaurant(p_tenant_id) THEN
    RAISE EXCEPTION 'Not authorised for this restaurant';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'owner'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'accountant'::app_role)
    OR public.has_role(auth.uid(), 'superadmin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Only owners, managers or accountants can create supplier AP heads';
  END IF;

  FOR r IN
    SELECT id FROM public.suppliers
    WHERE restaurant_id = p_tenant_id
      AND is_active = true
      AND ap_account_id IS NULL
  LOOP
    v_acct := public.resolve_supplier_ap_account(p_tenant_id, r.id);
    IF v_acct IS NOT NULL THEN
      v_created := v_created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('created', v_created);
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_supplier_ap_accounts(uuid) TO authenticated;