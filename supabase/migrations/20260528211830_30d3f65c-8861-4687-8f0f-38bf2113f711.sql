-- Auto-create KDS ticket from POS sales transactions
CREATE OR REPLACE FUNCTION public.fn_kds_create_ticket_from_pos_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket_id uuid;
  v_ticket_num text;
  v_label text;
BEGIN
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
$$;

-- Fire AFTER INSERT of sales_transactions, but defer to allow items to be inserted first.
-- Strategy: use a statement-level trigger on sales_items would be complex; instead, fire on
-- sales_transactions AFTER INSERT with a small deferred check via a constraint trigger.
-- Simpler: trigger AFTER INSERT on sales_transactions, deferred to end of transaction.
CREATE CONSTRAINT TRIGGER trg_kds_create_ticket_from_pos_sale
AFTER INSERT ON public.sales_transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.fn_kds_create_ticket_from_pos_sale();

-- Auto-mark KDS ticket as served when sale is fully paid (settlement_status -> 'paid')
CREATE OR REPLACE FUNCTION public.fn_kds_mark_served_on_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.settlement_status = 'paid' AND COALESCE(OLD.settlement_status::text,'') <> 'paid' THEN
    UPDATE public.pos_kds_tickets
       SET status = 'served', served_at = COALESCE(served_at, now())
     WHERE source = 'pos' AND source_order_id = NEW.id AND status <> 'served';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_kds_mark_served_on_payment
AFTER UPDATE OF settlement_status ON public.sales_transactions
FOR EACH ROW
EXECUTE FUNCTION public.fn_kds_mark_served_on_payment();