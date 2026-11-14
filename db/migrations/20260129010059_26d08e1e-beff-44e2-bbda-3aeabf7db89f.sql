-- Create a function to auto-create purchases from invoice items when an invoice is created
CREATE OR REPLACE FUNCTION public.auto_create_purchases_from_invoice()
RETURNS TRIGGER AS $$
DECLARE
  v_invoice RECORD;
  v_item RECORD;
  v_purchase_id UUID;
BEGIN
  -- Get the invoice details
  SELECT pi.*, r.id as restaurant_id
  INTO v_invoice
  FROM public.purchase_invoices pi
  JOIN public.restaurants r ON r.id = pi.restaurant_id
  WHERE pi.id = NEW.invoice_id;

  -- Only create purchase if item is linked to inventory
  IF NEW.inventory_item_id IS NOT NULL THEN
    -- Insert purchase record
    INSERT INTO public.purchases (
      restaurant_id,
      supplier_id,
      inventory_item_id,
      quantity_received,
      unit_cost,
      total_cost,
      invoice_number,
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
      'Auto-created from invoice ' || v_invoice.invoice_number,
      v_invoice.created_by,
      COALESCE(v_invoice.invoice_date::timestamptz, now())
    )
    RETURNING id INTO v_purchase_id;

    -- Update inventory stock
    UPDATE public.inventory_items
    SET 
      current_stock = current_stock + NEW.quantity,
      unit_cost = NEW.unit_price
    WHERE id = NEW.inventory_item_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger on invoice_items insert
DROP TRIGGER IF EXISTS trg_auto_create_purchases ON public.invoice_items;
CREATE TRIGGER trg_auto_create_purchases
  AFTER INSERT ON public.invoice_items
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_purchases_from_invoice();

-- Add invoice_item_id column to purchases to track the source
ALTER TABLE public.purchases 
ADD COLUMN IF NOT EXISTS invoice_item_id UUID REFERENCES public.invoice_items(id) ON DELETE SET NULL;

-- Update the function to also link back to the invoice item
CREATE OR REPLACE FUNCTION public.auto_create_purchases_from_invoice()
RETURNS TRIGGER AS $$
DECLARE
  v_invoice RECORD;
  v_purchase_id UUID;
BEGIN
  -- Get the invoice details
  SELECT pi.*, r.id as restaurant_id
  INTO v_invoice
  FROM public.purchase_invoices pi
  JOIN public.restaurants r ON r.id = pi.restaurant_id
  WHERE pi.id = NEW.invoice_id;

  -- Only create purchase if item is linked to inventory
  IF NEW.inventory_item_id IS NOT NULL THEN
    -- Insert purchase record
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

    -- Update inventory stock
    UPDATE public.inventory_items
    SET 
      current_stock = current_stock + NEW.quantity,
      unit_cost = NEW.unit_price
    WHERE id = NEW.inventory_item_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;