-- Back-office sales on the API (server/src/modules/pos/sales-admin.*).
--
-- 1. Voids. Sales are never deleted (trg_prevent_sales_hard_delete) and the settlement status
--    has no "void" value, so a void is a negative mirror sale (the same convention as offline
--    refunds) that points at the original; reports that sum totals net out on their own. The
--    original keeps its row and gets who/when/why.
ALTER TABLE public.sales_transactions
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS voids_transaction_id uuid REFERENCES public.sales_transactions(id);

-- One void per sale.
CREATE UNIQUE INDEX IF NOT EXISTS sales_transactions_voids_uidx
  ON public.sales_transactions (voids_transaction_id) WHERE voids_transaction_id IS NOT NULL;

-- 2. Kitchen tickets only for sales with lines. End-of-day totals, manual amount-only sales,
--    backfill adjustments and voids have no lines and used to put empty "Order EOD-..."
--    tickets on the KDS. The trigger is deferred, so the lines of a real sale exist by then.
CREATE OR REPLACE FUNCTION public.fn_kds_create_ticket_from_pos_sale()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket_id uuid;
  v_ticket_num text;
  v_label text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sales_items WHERE transaction_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Generate short ticket number from receipt or id
  v_ticket_num := COALESCE(NEW.receipt_number, 'POS-' || substr(NEW.id::text, 1, 8));
  v_label := 'Order ' || v_ticket_num;

  INSERT INTO public.pos_kds_tickets (
    restaurant_id, ticket_number, source, source_order_id, table_label, status, priority
  ) VALUES (
    NEW.restaurant_id, v_ticket_num, 'pos', NEW.id, v_label, 'new', 0
  )
  RETURNING id INTO v_ticket_id;

  -- Copy sale items into ticket items (snapshot from menu_items)
  INSERT INTO public.pos_kds_ticket_items (
    ticket_id, restaurant_id, menu_item_id, name_snapshot, quantity, sort_order
  )
  SELECT
    v_ticket_id,
    NEW.restaurant_id,
    si.menu_item_id,
    COALESCE(mi.name, 'Item'),
    si.quantity,
    row_number() OVER (ORDER BY si.created_at) - 1
  FROM public.sales_items si
  LEFT JOIN public.menu_items mi ON mi.id = si.menu_item_id
  WHERE si.transaction_id = NEW.id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block a sale because KDS failed
  RAISE WARNING 'KDS ticket creation failed for sale %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;
