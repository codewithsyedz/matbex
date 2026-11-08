CREATE OR REPLACE FUNCTION public.auto_create_supplier_ap_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.ap_account_id IS NULL AND COALESCE(NEW.is_active, true) THEN
    PERFORM public.resolve_supplier_ap_account(NEW.restaurant_id, NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_supplier_ap_account ON public.suppliers;
CREATE TRIGGER trg_auto_create_supplier_ap_account
AFTER INSERT OR UPDATE OF is_active ON public.suppliers
FOR EACH ROW
EXECUTE FUNCTION public.auto_create_supplier_ap_account();