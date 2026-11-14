
-- ============ STATIONS ============
CREATE TABLE public.pos_kds_stations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  station_type TEXT NOT NULL DEFAULT 'kitchen', -- kitchen, bar, expo, grill, etc.
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_kds_stations_restaurant ON public.pos_kds_stations(restaurant_id) WHERE active;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_kds_stations TO authenticated;
GRANT ALL ON public.pos_kds_stations TO service_role;

ALTER TABLE public.pos_kds_stations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kds_stations_select" ON public.pos_kds_stations FOR SELECT TO authenticated
  USING (public.can_access_restaurant(restaurant_id));
CREATE POLICY "kds_stations_modify" ON public.pos_kds_stations FOR ALL TO authenticated
  USING (public.can_access_restaurant(restaurant_id))
  WITH CHECK (public.can_access_restaurant(restaurant_id));

-- ============ TICKETS ============
CREATE TABLE public.pos_kds_tickets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  ticket_number TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'guest_qr', -- guest_qr, pos, online
  source_order_id UUID, -- reference to pos_table_orders.id (or future order tables)
  table_label TEXT, -- denormalized table name/number for fast display
  status TEXT NOT NULL DEFAULT 'new', -- new, in_progress, ready, served, cancelled
  priority INT NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  served_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_kds_tickets_restaurant_status ON public.pos_kds_tickets(restaurant_id, status, created_at);
CREATE INDEX idx_kds_tickets_source_order ON public.pos_kds_tickets(source_order_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_kds_tickets TO authenticated;
GRANT ALL ON public.pos_kds_tickets TO service_role;

ALTER TABLE public.pos_kds_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kds_tickets_select" ON public.pos_kds_tickets FOR SELECT TO authenticated
  USING (public.can_access_restaurant(restaurant_id));
CREATE POLICY "kds_tickets_modify" ON public.pos_kds_tickets FOR ALL TO authenticated
  USING (public.can_access_restaurant(restaurant_id))
  WITH CHECK (public.can_access_restaurant(restaurant_id));

-- ============ TICKET ITEMS ============
CREATE TABLE public.pos_kds_ticket_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID NOT NULL REFERENCES public.pos_kds_tickets(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  menu_item_id UUID,
  name_snapshot TEXT NOT NULL,
  size_label TEXT,
  quantity NUMERIC NOT NULL DEFAULT 1,
  modifiers JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  station_id UUID REFERENCES public.pos_kds_stations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, in_progress, ready, served, cancelled
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_kds_items_ticket ON public.pos_kds_ticket_items(ticket_id);
CREATE INDEX idx_kds_items_station_status ON public.pos_kds_ticket_items(station_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_kds_ticket_items TO authenticated;
GRANT ALL ON public.pos_kds_ticket_items TO service_role;

ALTER TABLE public.pos_kds_ticket_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kds_items_select" ON public.pos_kds_ticket_items FOR SELECT TO authenticated
  USING (public.can_access_restaurant(restaurant_id));
CREATE POLICY "kds_items_modify" ON public.pos_kds_ticket_items FOR ALL TO authenticated
  USING (public.can_access_restaurant(restaurant_id))
  WITH CHECK (public.can_access_restaurant(restaurant_id));

-- ============ updated_at triggers ============
CREATE TRIGGER trg_kds_stations_updated BEFORE UPDATE ON public.pos_kds_stations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_kds_tickets_updated BEFORE UPDATE ON public.pos_kds_tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_kds_items_updated BEFORE UPDATE ON public.pos_kds_ticket_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ AUTO-CREATE TICKET FROM GUEST QR ORDER ============
CREATE OR REPLACE FUNCTION public.fn_kds_create_ticket_from_guest_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_station_id UUID;
  v_table_label TEXT;
  v_ticket_id UUID;
  v_ticket_number TEXT;
  v_item JSONB;
BEGIN
  -- Resolve default station (first active station, or create one)
  SELECT id INTO v_station_id
  FROM public.pos_kds_stations
  WHERE restaurant_id = NEW.restaurant_id AND active
  ORDER BY sort_order, created_at
  LIMIT 1;

  IF v_station_id IS NULL THEN
    INSERT INTO public.pos_kds_stations(restaurant_id, name, station_type)
    VALUES (NEW.restaurant_id, 'Kitchen', 'kitchen')
    RETURNING id INTO v_station_id;
  END IF;

  -- Table label
  SELECT COALESCE(name, code) INTO v_table_label
  FROM public.pos_tables WHERE id = NEW.table_id;

  v_ticket_number := 'T-' || to_char(now() AT TIME ZONE 'UTC', 'HH24MI') || '-' || substr(NEW.id::text, 1, 4);

  INSERT INTO public.pos_kds_tickets(
    restaurant_id, ticket_number, source, source_order_id, table_label, notes, status
  ) VALUES (
    NEW.restaurant_id, v_ticket_number, 'guest_qr', NEW.id, v_table_label, NEW.notes, 'new'
  ) RETURNING id INTO v_ticket_id;

  -- Items: NEW.items is JSONB array of {menu_item_id, name, size_label, quantity, notes}
  IF jsonb_typeof(NEW.items) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      INSERT INTO public.pos_kds_ticket_items(
        ticket_id, restaurant_id, menu_item_id, name_snapshot, size_label, quantity, notes, station_id
      ) VALUES (
        v_ticket_id,
        NEW.restaurant_id,
        NULLIF(v_item->>'menu_item_id','')::uuid,
        COALESCE(v_item->>'name', 'Item'),
        v_item->>'size_label',
        COALESCE((v_item->>'quantity')::numeric, 1),
        v_item->>'notes',
        v_station_id
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_kds_from_guest_order
AFTER INSERT ON public.pos_table_orders
FOR EACH ROW EXECUTE FUNCTION public.fn_kds_create_ticket_from_guest_order();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.pos_kds_tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pos_kds_ticket_items;
