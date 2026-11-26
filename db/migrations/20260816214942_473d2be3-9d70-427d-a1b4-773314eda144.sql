-- 1. Atomic replace routine (adds auto-create-purchase support + row lock)
CREATE OR REPLACE FUNCTION public.replace_invoice_items(
  p_invoice_id uuid,
  p_items jsonb,
  p_auto_create_purchase boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_restaurant_id uuid;
  v_total numeric := 0;
  v_count integer := 0;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id
  FROM public.purchase_invoices WHERE id = p_invoice_id FOR UPDATE;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id;
  END IF;

  IF NOT public.user_belongs_to_restaurant(auth.uid(), v_restaurant_id) THEN
    RAISE EXCEPTION 'Not authorized to edit this invoice';
  END IF;

  -- Mark this transaction as an authorised line rewrite so the guard trigger
  -- lets the delete + insert pair through.
  PERFORM set_config('app.invoice_items_rewrite', 'on', true);

  DELETE FROM public.invoice_items WHERE invoice_id = p_invoice_id;

  INSERT INTO public.invoice_items (
    invoice_id, inventory_item_id, description, quantity, unit_price, total_price, auto_create_purchase
  )
  SELECT
    p_invoice_id,
    NULLIF(i->>'inventory_item_id','')::uuid,
    COALESCE(i->>'description',''),
    COALESCE((i->>'quantity')::numeric, 0),
    COALESCE((i->>'unit_price')::numeric, 0),
    ROUND(COALESCE((i->>'quantity')::numeric,0) * COALESCE((i->>'unit_price')::numeric,0), 2),
    COALESCE((i->>'auto_create_purchase')::boolean, p_auto_create_purchase)
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) i;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  SELECT COALESCE(SUM(total_price), 0) INTO v_total
  FROM public.invoice_items WHERE invoice_id = p_invoice_id;

  UPDATE public.purchase_invoices
  SET subtotal = v_total - COALESCE(tax_amount, 0),
      total_amount = v_total,
      updated_at = now()
  WHERE id = p_invoice_id;

  PERFORM set_config('app.invoice_items_rewrite', 'off', true);

  RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.replace_invoice_items(uuid, jsonb, boolean) TO authenticated;

-- 2. Guard: only the routine (or a cascading invoice delete) may touch lines
CREATE OR REPLACE FUNCTION public.guard_invoice_items_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('app.invoice_items_rewrite', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Allow backend/service contexts (edge functions, admin jobs, migrations).
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Allow cascades from deleting the parent invoice.
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM public.purchase_invoices WHERE id = OLD.invoice_id) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Invoice lines can only be changed through replace_invoice_items(), which rewrites all lines atomically and recomputes the invoice total'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_invoice_items_writes ON public.invoice_items;
CREATE TRIGGER trg_guard_invoice_items_writes
BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_items_writes();

-- 3. Remove direct write access from the Data API (reads stay intact)
DROP POLICY IF EXISTS "Users can create invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Managers+ can delete invoice items" ON public.invoice_items;
REVOKE INSERT, UPDATE, DELETE ON public.invoice_items FROM authenticated;
GRANT SELECT ON public.invoice_items TO authenticated;
GRANT ALL ON public.invoice_items TO service_role;