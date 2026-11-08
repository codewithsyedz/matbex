CREATE TABLE IF NOT EXISTS public.pos_terminals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  terminal_uid text NOT NULL,
  name text NOT NULL DEFAULT 'Unnamed terminal',
  branch_label text,
  registered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_seen_at timestamptz,
  user_agent text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, terminal_uid)
);
CREATE INDEX IF NOT EXISTS idx_pos_terminals_restaurant ON public.pos_terminals(restaurant_id);
ALTER TABLE public.pos_terminals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members view terminals"
ON public.pos_terminals FOR SELECT
USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "Tenant members register terminals"
ON public.pos_terminals FOR INSERT
WITH CHECK (public.can_access_restaurant(restaurant_id));

CREATE POLICY "Owners/managers update terminals"
ON public.pos_terminals FOR UPDATE
USING (
  public.can_access_restaurant(restaurant_id)
  AND (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
       OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role))
);

CREATE POLICY "Owners delete terminals"
ON public.pos_terminals FOR DELETE
USING (
  public.can_access_restaurant(restaurant_id)
  AND public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
);

CREATE TRIGGER trg_pos_terminals_updated
BEFORE UPDATE ON public.pos_terminals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.pos_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  terminal_uid text NOT NULL,
  idempotency_key text NOT NULL,
  entity_type text NOT NULL,
  request_id text,
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_pos_idem_restaurant ON public.pos_idempotency_keys(restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_idem_terminal ON public.pos_idempotency_keys(restaurant_id, terminal_uid);
ALTER TABLE public.pos_idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners/managers audit idempotency keys"
ON public.pos_idempotency_keys FOR SELECT
USING (
  public.can_access_restaurant(restaurant_id)
  AND (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
       OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role))
);