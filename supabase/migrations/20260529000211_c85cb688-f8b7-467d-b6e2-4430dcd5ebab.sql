-- Kitchen printer routing: per-item route flag
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS print_route text NOT NULL DEFAULT 'kitchen';

ALTER TABLE public.menu_items
  DROP CONSTRAINT IF EXISTS menu_items_print_route_check;

ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_print_route_check
  CHECK (print_route IN ('kitchen','bar','none'));

-- Default drinks → bar on first migration (one-time best-effort heuristic)
UPDATE public.menu_items
   SET print_route = 'bar'
 WHERE print_route = 'kitchen'
   AND lower(coalesce(category,'')) IN ('drink','drinks','beverage','beverages','bar','juice','juices','coffee','tea');

-- Customer-Facing Display sessions
CREATE TABLE IF NOT EXISTS public.cfd_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  pair_code text NOT NULL,
  label text,
  -- current sale state shown to the customer
  state text NOT NULL DEFAULT 'idle',  -- idle | cart | payment | thankyou
  cart jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  message text,
  order_ref text,
  last_paired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, pair_code)
);

CREATE INDEX IF NOT EXISTS idx_cfd_sessions_restaurant ON public.cfd_sessions(restaurant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cfd_sessions TO authenticated;
GRANT ALL ON public.cfd_sessions TO service_role;
-- Public anon read by pair_code only (so an unauthenticated paired tablet can subscribe)
GRANT SELECT ON public.cfd_sessions TO anon;

ALTER TABLE public.cfd_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cfd_sessions_tenant_all"
  ON public.cfd_sessions
  FOR ALL
  TO authenticated
  USING (can_access_restaurant(restaurant_id))
  WITH CHECK (can_access_restaurant(restaurant_id));

-- Anyone (including a paired tablet without login) can read a session
-- when they already know the pair_code. They never list rows because the
-- frontend always filters by .eq('pair_code', code).
CREATE POLICY "cfd_sessions_public_read_by_code"
  ON public.cfd_sessions
  FOR SELECT
  TO anon
  USING (true);

CREATE TRIGGER trg_cfd_sessions_updated
  BEFORE UPDATE ON public.cfd_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.cfd_sessions;
ALTER TABLE public.cfd_sessions REPLICA IDENTITY FULL;