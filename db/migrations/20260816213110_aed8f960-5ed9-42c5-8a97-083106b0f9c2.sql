CREATE OR REPLACE FUNCTION public.replace_invoice_items(
  p_invoice_id uuid,
  p_items jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
  v_total numeric := 0;
  v_count integer := 0;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id
  FROM public.purchase_invoices WHERE id = p_invoice_id;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id;
  END IF;

  IF NOT public.user_belongs_to_restaurant(auth.uid(), v_restaurant_id) THEN
    RAISE EXCEPTION 'Not authorized to edit this invoice';
  END IF;

  -- Always clear existing lines first (definer rights avoid silent RLS no-ops
  -- that previously left stale rows behind and doubled the invoice total).
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
    false
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) i;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  SELECT COALESCE(SUM(total_price), 0) INTO v_total
  FROM public.invoice_items WHERE invoice_id = p_invoice_id;

  UPDATE public.purchase_invoices
  SET subtotal = v_total, total_amount = v_total, updated_at = now()
  WHERE id = p_invoice_id;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_invoice_items(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.replace_invoice_items(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_invoice_items(uuid, jsonb) TO service_role;