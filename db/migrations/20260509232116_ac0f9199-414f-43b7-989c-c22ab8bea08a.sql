
-- 1. Extend pos_terminals
ALTER TABLE public.pos_terminals
  ADD COLUMN IF NOT EXISTS key_hash text,
  ADD COLUMN IF NOT EXISTS key_prefix text,
  ADD COLUMN IF NOT EXISTS paired_at timestamptz,
  ADD COLUMN IF NOT EXISTS app_version text,
  ADD COLUMN IF NOT EXISTS platform text;

CREATE UNIQUE INDEX IF NOT EXISTS pos_terminals_key_hash_uniq
  ON public.pos_terminals(key_hash) WHERE key_hash IS NOT NULL;

-- 2. Pairing codes
CREATE TABLE IF NOT EXISTS public.pos_terminal_pairing_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  code text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_terminal_id uuid REFERENCES public.pos_terminals(id) ON DELETE SET NULL,
  default_name text,
  default_branch_label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_terminal_pairing_codes_code_unconsumed
  ON public.pos_terminal_pairing_codes(code) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pairing_codes_restaurant
  ON public.pos_terminal_pairing_codes(restaurant_id, created_at DESC);

ALTER TABLE public.pos_terminal_pairing_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners/managers view pairing codes"
  ON public.pos_terminal_pairing_codes FOR SELECT
  USING (
    can_access_restaurant(restaurant_id)
    AND (has_role(auth.uid(), restaurant_id, 'owner'::app_role)
         OR has_role(auth.uid(), restaurant_id, 'manager'::app_role))
  );

CREATE POLICY "Owners/managers create pairing codes"
  ON public.pos_terminal_pairing_codes FOR INSERT
  WITH CHECK (
    can_access_restaurant(restaurant_id)
    AND (has_role(auth.uid(), restaurant_id, 'owner'::app_role)
         OR has_role(auth.uid(), restaurant_id, 'manager'::app_role))
  );

CREATE POLICY "Owners/managers update pairing codes"
  ON public.pos_terminal_pairing_codes FOR UPDATE
  USING (
    can_access_restaurant(restaurant_id)
    AND (has_role(auth.uid(), restaurant_id, 'owner'::app_role)
         OR has_role(auth.uid(), restaurant_id, 'manager'::app_role))
  );

-- 3. Audit log
CREATE TABLE IF NOT EXISTS public.pos_terminal_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal_id uuid REFERENCES public.pos_terminals(id) ON DELETE SET NULL,
  restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE CASCADE,
  cashier_id uuid,
  endpoint text NOT NULL,
  method text NOT NULL,
  status_code int,
  idempotency_key text,
  request_id text,
  latency_ms int,
  response_snapshot jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_terminal_audit_idem_uniq
  ON public.pos_terminal_audit(terminal_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_terminal_audit_restaurant
  ON public.pos_terminal_audit(restaurant_id, created_at DESC);

ALTER TABLE public.pos_terminal_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners/managers view terminal audit"
  ON public.pos_terminal_audit FOR SELECT
  USING (
    restaurant_id IS NOT NULL
    AND can_access_restaurant(restaurant_id)
    AND (has_role(auth.uid(), restaurant_id, 'owner'::app_role)
         OR has_role(auth.uid(), restaurant_id, 'manager'::app_role))
  );
-- writes happen via service role from the edge function; no INSERT policy needed.

-- 4. Helper: verify_terminal_key
CREATE OR REPLACE FUNCTION public.verify_terminal_key(_key text)
RETURNS TABLE(terminal_id uuid, restaurant_id uuid, active boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _hash text;
BEGIN
  IF _key IS NULL OR length(_key) < 16 THEN RETURN; END IF;
  _hash := encode(digest(_key, 'sha256'), 'hex');
  RETURN QUERY
    SELECT t.id, t.restaurant_id, t.active
    FROM public.pos_terminals t
    WHERE t.key_hash = _hash
    LIMIT 1;
END;
$$;

-- 5. Helper: create_pairing_code (owner/manager only)
CREATE OR REPLACE FUNCTION public.create_pairing_code(
  _restaurant_id uuid,
  _default_name text DEFAULT NULL,
  _default_branch_label text DEFAULT NULL,
  _ttl_minutes int DEFAULT 15
)
RETURNS TABLE(id uuid, code text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _code text;
  _new_id uuid;
  _expires timestamptz;
BEGIN
  IF NOT (
    can_access_restaurant(_restaurant_id)
    AND (has_role(auth.uid(), _restaurant_id, 'owner'::app_role)
         OR has_role(auth.uid(), _restaurant_id, 'manager'::app_role))
  ) THEN
    RAISE EXCEPTION 'Not authorized to create pairing codes for this restaurant';
  END IF;

  -- Generate a unique 6-digit numeric code that isn't currently active
  LOOP
    _code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM pos_terminal_pairing_codes
      WHERE code = _code AND consumed_at IS NULL AND expires_at > now()
    );
  END LOOP;

  _expires := now() + make_interval(mins => GREATEST(1, LEAST(_ttl_minutes, 60)));

  INSERT INTO pos_terminal_pairing_codes(
    restaurant_id, code, created_by, expires_at, default_name, default_branch_label
  )
  VALUES (_restaurant_id, _code, auth.uid(), _expires, _default_name, _default_branch_label)
  RETURNING pos_terminal_pairing_codes.id INTO _new_id;

  RETURN QUERY SELECT _new_id, _code, _expires;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_pairing_code(uuid, text, text, int) TO authenticated;

-- pgcrypto for digest()
CREATE EXTENSION IF NOT EXISTS pgcrypto;
