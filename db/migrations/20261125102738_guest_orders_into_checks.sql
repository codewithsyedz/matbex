-- Open checks, phase 2b.3 of docs/plans/open-checks.md: guest QR orders and reservations.
--
-- * A guest's QR order (guest_create_order) now waits for staff: no kitchen ticket at submit.
--   Staff accept it from Open checks (POST /api/v1/pos/checks/guest-orders/:id/accept): its
--   items go onto the table's open check (opened if needed) at the server's prices and are
--   sent to the kitchen; or they reject it. The order then points at its check.
-- * guest_create_order prices the items from the menu (the guest's browser no longer sets
--   subtotal/total) and caps an order at 50 lines of at most 20 each.
-- * A guest order can no longer be marked "paid" without a sale: the table's check is paid.
-- * A reservation can be seated: it opens a check on a table (POST /api/v1/pos/checks with
--   reservationId) and records the table and check.

-- ---- guest orders ----------------------------------------------------------------------
ALTER TABLE public.pos_table_orders
  ADD COLUMN IF NOT EXISTS check_id uuid REFERENCES public.pos_checks(id),
  ADD COLUMN IF NOT EXISTS accepted_by uuid,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reject_reason text;

-- The kitchen gets a guest order only once staff accept it (as a round of the check).
DROP TRIGGER IF EXISTS trg_kds_from_guest_order ON public.pos_table_orders;

-- "Paid" without a sale is gone: pay the table's check.
CREATE OR REPLACE FUNCTION public.pos_table_orders_no_paid_without_sale()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Guest orders are paid through the table''s check (Record sale → Open checks), so the sale is recorded.';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_pos_table_orders_no_paid ON public.pos_table_orders;
CREATE TRIGGER trg_pos_table_orders_no_paid BEFORE UPDATE ON public.pos_table_orders
  FOR EACH ROW EXECUTE FUNCTION public.pos_table_orders_no_paid_without_sale();

-- Live updates to the POS (new guest orders, accepted, rejected).
DROP TRIGGER IF EXISTS zz_outbox_row_change ON public.pos_table_orders;
CREATE TRIGGER zz_outbox_row_change AFTER INSERT OR UPDATE OR DELETE ON public.pos_table_orders
  FOR EACH ROW EXECUTE FUNCTION platform.trg_outbox_row_change('pos');

-- Prices from the menu, not from the guest's browser (p_subtotal / p_tax / p_total are
-- ignored; kept in the signature for pages already loaded). Public (anon) on purpose: the
-- guest is not signed in; the table code is the key, as before.
CREATE OR REPLACE FUNCTION public.guest_create_order(p_table_code text, p_guest_name text, p_items jsonb, p_subtotal numeric, p_tax numeric, p_total numeric, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_table public.pos_tables%ROWTYPE;
  v_order_id uuid;
  v_token uuid;
  v_items jsonb;
  v_total numeric;
  v_count integer;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;
  IF jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'An order can have at most 50 lines';
  END IF;

  SELECT * INTO v_table FROM public.pos_tables
    WHERE lower(code) = lower(p_table_code)
      AND is_active = true
      AND deleted_at IS NULL
    LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Table not found';
  END IF;

  -- Each line: an active menu item of this restaurant, 1..20 units, priced from the menu.
  WITH req AS (
    SELECT (x->>'menu_item_id')::uuid AS menu_item_id,
           CASE WHEN x->>'size' IN ('quarter', 'half', 'full') THEN x->>'size' ELSE 'regular' END AS size,
           (x->>'qty')::int AS qty
    FROM jsonb_array_elements(p_items) x
  ),
  priced AS (
    SELECT r.menu_item_id, m.name, r.size, r.qty,
           ROUND(COALESCE(NULLIF(CASE r.size
                     WHEN 'quarter' THEN m.quarter_price
                     WHEN 'half' THEN m.half_price
                     WHEN 'full' THEN m.full_price
                   END, 0), m.selling_price, 0), 2) AS price
    FROM req r
    JOIN public.menu_items m ON m.id = r.menu_item_id
      AND m.restaurant_id = v_table.restaurant_id AND m.is_active = true
    WHERE r.qty BETWEEN 1 AND 20
  )
  SELECT count(*),
         COALESCE(jsonb_agg(jsonb_build_object('menu_item_id', menu_item_id, 'name', name, 'size', size, 'qty', qty, 'price', price)), '[]'::jsonb),
         COALESCE(sum(price * qty), 0)
    INTO v_count, v_items, v_total
    FROM priced;
  IF v_count <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'Some items are not available or have a quantity outside 1-20';
  END IF;

  INSERT INTO public.pos_table_orders (
    tenant_id, restaurant_id, table_id, guest_name, items, subtotal, tax, total, notes, status
  ) VALUES (
    v_table.tenant_id, v_table.restaurant_id, v_table.id,
    NULLIF(left(trim(p_guest_name), 80), ''),
    v_items, v_total, 0, v_total,
    NULLIF(left(trim(p_notes), 300), ''),
    'submitted'
  )
  RETURNING id, access_token INTO v_order_id, v_token;

  RETURN jsonb_build_object('id', v_order_id, 'access_token', v_token);
END;
$function$;

-- ---- reservations ----------------------------------------------------------------------
ALTER TABLE public.table_reservations
  ADD COLUMN IF NOT EXISTS table_id uuid REFERENCES public.pos_tables(id),
  ADD COLUMN IF NOT EXISTS check_id uuid REFERENCES public.pos_checks(id),
  ADD COLUMN IF NOT EXISTS seated_at timestamptz;
