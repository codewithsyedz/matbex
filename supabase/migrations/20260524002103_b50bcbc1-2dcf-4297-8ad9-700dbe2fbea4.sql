CREATE OR REPLACE FUNCTION public.create_pairing_code(
  _restaurant_id uuid,
  _default_name text DEFAULT NULL::text,
  _default_branch_label text DEFAULT NULL::text,
  _ttl_minutes integer DEFAULT 15
)
RETURNS TABLE(id uuid, code text, expires_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Generate a unique 6-digit numeric code that isn't currently active.
  -- Alias the table to avoid ambiguity with the RETURNS TABLE output column "code".
  LOOP
    _code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM pos_terminal_pairing_codes p
      WHERE p.code = _code
        AND p.consumed_at IS NULL
        AND p.expires_at > now()
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
$function$;