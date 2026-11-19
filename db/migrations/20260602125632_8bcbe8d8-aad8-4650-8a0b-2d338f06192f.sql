-- Allow invoice_items rows to opt out of the auto-purchase trigger.
-- Used when a multi-line expense mirrors itself into a purchase_invoices header:
-- the expense already creates stock_movements + purchases via the expense trigger,
-- so the mirrored invoice_items are display-only and must NOT double-post purchases.

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS auto_create_purchase boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.auto_create_purchases_from_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice RECORD;
  v_purchase_id UUID;
BEGIN
  -- Skip when the row is explicitly marked as display-only (mirrored from expense)
  IF NEW.auto_create_purchase IS FALSE THEN
    RETURN NEW;
  END IF;

  SELECT pi.*, r.id as restaurant_id
  INTO v_invoice
  FROM public.purchase_invoices pi
  JOIN public.restaurants r ON r.id = pi.restaurant_id
  WHERE pi.id = NEW.invoice_id;

  IF NEW.inventory_item_id IS NOT NULL THEN
    INSERT INTO public.purchases (
      restaurant_id,
      supplier_id,
      inventory_item_id,
      quantity_received,
      unit_cost,
      total_cost,
      invoice_number,
      invoice_item_id,
      notes,
      received_by,
      received_at
    ) VALUES (
      v_invoice.restaurant_id,
      v_invoice.supplier_id,
      NEW.inventory_item_id,
      NEW.quantity,
      NEW.unit_price,
      NEW.total_price,
      v_invoice.invoice_number,
      NEW.id,
      'Auto-created from invoice ' || v_invoice.invoice_number,
      v_invoice.created_by,
      COALESCE(v_invoice.invoice_date::timestamptz, now())
    )
    RETURNING id INTO v_purchase_id;

    UPDATE public.inventory_items
    SET
      current_stock = current_stock + NEW.quantity,
      unit_cost = NEW.unit_price
    WHERE id = NEW.inventory_item_id;
  END IF;

  RETURN NEW;
END;
$function$;