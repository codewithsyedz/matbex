-- Open checks / running tabs, phase 2b.1 of docs/plans/open-checks.md.
--
-- A check holds a table's (or a bar tab's) order while the guests eat: lines are added,
-- sent to the kitchen in rounds, and the check is paid at the end through the ordinary
-- sale endpoints, so receipts, ZATCA, stock, cash events and reports are unchanged.
--
-- * pos_checks        one open check per table at a time; closed by paying (status paid),
--                     voiding, or (later) merging into another check.
-- * pos_check_lines   priced when added (the guest ordered at that price); round_id null
--                     until sent to the kitchen.
-- * pos_check_rounds  one per "send to kitchen"; each makes one kitchen ticket
--                     (pos_kds_tickets.source = 'check', source_order_id = round id).
-- * sales_transactions.check_id  the sale(s) that paid the check. The kitchen already has
--                     the check's rounds, so such a sale makes no second ticket.
--
-- Written only by the API (/api/v1/pos/checks); browsers read them like sales.

CREATE TABLE public.pos_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id),
  table_id uuid REFERENCES public.pos_tables(id),
  -- CHK-YYYYMMDD-NNN per restaurant and business day.
  check_number text NOT NULL,
  -- A label for checks without a table (bar tab, "Ahmed").
  name text,
  status text NOT NULL DEFAULT 'open',
  guest_count integer,
  server_id uuid,
  customer_id uuid REFERENCES public.customers(id),
  opened_by uuid NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid,
  closed_at timestamptz,
  void_reason text,
  merged_into uuid REFERENCES public.pos_checks(id),
  -- Bumped by every change; writes that carry an older version get 409 check_changed.
  version integer NOT NULL DEFAULT 1,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_checks_status CHECK (status IN ('open', 'paid', 'void', 'merged')),
  CONSTRAINT pos_checks_guest_count CHECK (guest_count IS NULL OR guest_count > 0),
  CONSTRAINT pos_checks_number_key UNIQUE (restaurant_id, check_number)
);
COMMENT ON TABLE public.pos_checks IS
  'Open checks (running tabs): an order held while guests eat, paid at the end through POST /api/v1/pos/checks/:id/pay. Written by the API only.';

-- One open check per table.
CREATE UNIQUE INDEX pos_checks_open_table_key ON public.pos_checks (table_id)
  WHERE status = 'open' AND table_id IS NOT NULL;
CREATE INDEX pos_checks_restaurant_open_idx ON public.pos_checks (restaurant_id, status, opened_at DESC);

CREATE TABLE public.pos_check_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id uuid NOT NULL REFERENCES public.pos_checks(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  number integer NOT NULL,
  sent_by uuid NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  kds_ticket_id uuid REFERENCES public.pos_kds_tickets(id) ON DELETE SET NULL,
  CONSTRAINT pos_check_rounds_number_key UNIQUE (check_id, number)
);

CREATE TABLE public.pos_check_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id uuid NOT NULL REFERENCES public.pos_checks(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  menu_item_id uuid REFERENCES public.menu_items(id),
  combo_id uuid REFERENCES public.combo_packages(id),
  size text NOT NULL DEFAULT 'regular',
  quantity integer NOT NULL,
  -- Listed price per unit when the line was added; the check is charged at it.
  unit_price numeric(12,2) NOT NULL,
  note text,
  round_id uuid REFERENCES public.pos_check_rounds(id),
  status text NOT NULL DEFAULT 'active',
  void_reason text,
  voided_by uuid,
  voided_at timestamptz,
  added_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_check_lines_item CHECK ((menu_item_id IS NULL) <> (combo_id IS NULL)),
  CONSTRAINT pos_check_lines_size CHECK (size IN ('regular', 'quarter', 'half', 'full')),
  CONSTRAINT pos_check_lines_quantity CHECK (quantity > 0),
  CONSTRAINT pos_check_lines_price CHECK (unit_price >= 0),
  CONSTRAINT pos_check_lines_status CHECK (status IN ('active', 'voided'))
);
CREATE INDEX pos_check_lines_check_idx ON public.pos_check_lines (check_id, created_at);
CREATE INDEX pos_check_rounds_check_idx ON public.pos_check_rounds (check_id, number);

-- The sale(s) that paid a check.
ALTER TABLE public.sales_transactions ADD COLUMN IF NOT EXISTS check_id uuid REFERENCES public.pos_checks(id);
CREATE INDEX IF NOT EXISTS sales_transactions_check_id_idx ON public.sales_transactions (check_id) WHERE check_id IS NOT NULL;
COMMENT ON COLUMN public.sales_transactions.check_id IS
  'Open checks: the check this sale paid (POST /api/v1/pos/checks/:id/pay). Its kitchen tickets came from the check''s rounds.';

-- Check numbers, per restaurant and business day (like pos_receipt_counters).
CREATE TABLE IF NOT EXISTS platform.pos_check_counters (
  restaurant_id uuid NOT NULL,
  day date NOT NULL,
  last_value integer NOT NULL DEFAULT 0,
  PRIMARY KEY (restaurant_id, day)
);
ALTER TABLE platform.pos_check_counters ENABLE ROW LEVEL SECURITY;  -- owner only
REVOKE ALL ON platform.pos_check_counters FROM PUBLIC, anon, authenticated;

-- ---- access: read like sales, no browser writes --------------------------------------
ALTER TABLE public.pos_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_check_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_check_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view checks in their restaurant"
  ON public.pos_checks FOR SELECT TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));
CREATE POLICY "Branch pin restriction"
  ON public.pos_checks AS RESTRICTIVE FOR ALL TO authenticated
  USING (branch_id IS NULL OR public.user_can_access_branch(auth.uid(), restaurant_id, branch_id))
  WITH CHECK (branch_id IS NULL OR public.user_can_access_branch(auth.uid(), restaurant_id, branch_id));

CREATE POLICY "Users can view check lines in their restaurant"
  ON public.pos_check_lines FOR SELECT TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));
CREATE POLICY "Users can view check rounds in their restaurant"
  ON public.pos_check_rounds FOR SELECT TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

REVOKE ALL ON public.pos_checks, public.pos_check_lines, public.pos_check_rounds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pos_checks, public.pos_check_lines, public.pos_check_rounds TO authenticated;
GRANT ALL ON public.pos_checks, public.pos_check_lines, public.pos_check_rounds TO service_role;

-- updated_at
CREATE TRIGGER trg_pos_checks_updated_at BEFORE UPDATE ON public.pos_checks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_pos_check_lines_updated_at BEFORE UPDATE ON public.pos_check_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Live updates to every terminal (transactional outbox, like pos_tables).
CREATE TRIGGER zz_outbox_row_change AFTER INSERT OR UPDATE OR DELETE ON public.pos_checks
  FOR EACH ROW EXECUTE FUNCTION platform.trg_outbox_row_change('pos');

-- ---- kitchen: a sale that pays a check makes no second ticket ------------------------
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
  -- Open checks send their lines to the kitchen in rounds (pos_check_rounds).
  IF NEW.check_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

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
