CREATE OR REPLACE FUNCTION public.claim_device_seat(
  _tenant_id uuid,
  _restaurant_id uuid,
  _terminal_id text,
  _device_fingerprint text,
  _device_label text,
  _platform text,
  _user_agent text,
  _claimed_by_user_id uuid,
  _seat_cap integer
)
RETURNS TABLE (
  seat_id uuid,
  seat_terminal_id text,
  seat_event text,
  seat_event_detail text,
  active_count integer,
  no_seat boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.device_licenses%ROWTYPE;
  v_count integer;
  v_event text;
  v_detail text;
BEGIN
  -- Serialize all seat claims for a given branch so the
  -- count-then-insert sequence below cannot race.
  PERFORM pg_advisory_xact_lock(hashtextextended(_restaurant_id::text, 0));

  -- 1. Match by terminal_id (most common: same client returning)
  SELECT * INTO v_existing
  FROM public.device_licenses
  WHERE restaurant_id = _restaurant_id
    AND terminal_id = _terminal_id
    AND revoked_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    v_event := 'matched_terminal';
    v_detail := NULL;
  ELSIF _device_fingerprint IS NOT NULL THEN
    -- 2. Match by fingerprint (terminal id was wiped client-side)
    SELECT * INTO v_existing
    FROM public.device_licenses
    WHERE restaurant_id = _restaurant_id
      AND device_fingerprint = _device_fingerprint
      AND revoked_at IS NULL
    LIMIT 1;
    IF FOUND THEN
      v_event := 'rebound_by_fingerprint';
      v_detail := 'Matched fingerprint; rebound terminal id.';
    END IF;
  END IF;

  -- 3. Legacy reclaim: NULL-fingerprint row with same user agent
  IF NOT FOUND AND _user_agent IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.device_licenses
    WHERE restaurant_id = _restaurant_id
      AND revoked_at IS NULL
      AND device_fingerprint IS NULL
      AND user_agent = _user_agent
    ORDER BY last_seen_at DESC NULLS LAST
    LIMIT 1;
    IF FOUND THEN
      v_event := 'rebound_by_fingerprint';
      v_detail := 'Matched legacy NULL-fingerprint seat by user agent; adopted into current device.';
    END IF;
  END IF;

  IF FOUND THEN
    UPDATE public.device_licenses
    SET terminal_id = _terminal_id,
        device_fingerprint = COALESCE(_device_fingerprint, device_fingerprint),
        device_label = COALESCE(_device_label, device_label),
        platform = COALESCE(_platform, platform),
        user_agent = COALESCE(_user_agent, user_agent),
        last_seen_at = now(),
        last_validated_at = now()
    WHERE id = v_existing.id;

    SELECT count(*)::int INTO v_count
    FROM public.device_licenses
    WHERE restaurant_id = _restaurant_id AND revoked_at IS NULL;

    seat_id := v_existing.id;
    seat_terminal_id := _terminal_id;
    seat_event := v_event;
    seat_event_detail := v_detail;
    active_count := v_count;
    no_seat := false;
    RETURN NEXT;
    RETURN;
  END IF;

  -- 4. No existing seat → enforce cap, then insert
  SELECT count(*)::int INTO v_count
  FROM public.device_licenses
  WHERE restaurant_id = _restaurant_id AND revoked_at IS NULL;

  IF v_count >= _seat_cap THEN
    seat_id := NULL;
    seat_terminal_id := NULL;
    seat_event := 'no_seat';
    seat_event_detail := 'Branch device limit reached';
    active_count := v_count;
    no_seat := true;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.device_licenses (
    tenant_id, restaurant_id, terminal_id,
    device_label, user_agent, platform,
    device_fingerprint, claimed_by_user_id
  ) VALUES (
    _tenant_id, _restaurant_id, _terminal_id,
    _device_label, _user_agent, _platform,
    _device_fingerprint, _claimed_by_user_id
  )
  RETURNING id INTO v_existing.id;

  seat_id := v_existing.id;
  seat_terminal_id := _terminal_id;
  seat_event := 'claimed';
  seat_event_detail := CASE
    WHEN _device_fingerprint IS NOT NULL
      THEN 'New seat row inserted (no prior terminal id or fingerprint match).'
    ELSE 'New seat row inserted (no fingerprint sent by client).'
  END;
  active_count := v_count + 1;
  no_seat := false;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_device_seat(uuid, uuid, text, text, text, text, text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_device_seat(uuid, uuid, text, text, text, text, text, uuid, integer) TO service_role;