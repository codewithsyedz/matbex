
CREATE TABLE public.device_seat_reclaim_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  device_license_id uuid NOT NULL REFERENCES public.device_licenses(id) ON DELETE CASCADE,
  reclaim_type text NOT NULL CHECK (reclaim_type IN ('rebound_by_fingerprint', 'rebound_by_user_agent')),
  previous_terminal_id text,
  new_terminal_id text NOT NULL,
  device_fingerprint text,
  user_agent text,
  platform text,
  claimed_by_user_id uuid,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_device_seat_reclaim_audit_restaurant
  ON public.device_seat_reclaim_audit (restaurant_id, created_at DESC);
CREATE INDEX idx_device_seat_reclaim_audit_tenant
  ON public.device_seat_reclaim_audit (tenant_id, created_at DESC);
CREATE INDEX idx_device_seat_reclaim_audit_license
  ON public.device_seat_reclaim_audit (device_license_id, created_at DESC);

ALTER TABLE public.device_seat_reclaim_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant owners and managers can view reclaim audit"
ON public.device_seat_reclaim_audit
FOR SELECT
TO authenticated
USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
  AND (
    public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role)
    OR public.is_superadmin(auth.uid())
  )
);

CREATE POLICY "SuperAdmins view all reclaim audit"
ON public.device_seat_reclaim_audit
FOR SELECT
TO authenticated
USING (public.is_superadmin(auth.uid()));

REVOKE ALL ON public.device_seat_reclaim_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.device_seat_reclaim_audit TO authenticated;
GRANT ALL ON public.device_seat_reclaim_audit TO service_role;

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
  v_reclaim_type text;
  v_prev_terminal_id text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_restaurant_id::text, 0));

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
    SELECT * INTO v_existing
    FROM public.device_licenses
    WHERE restaurant_id = _restaurant_id
      AND device_fingerprint = _device_fingerprint
      AND revoked_at IS NULL
    LIMIT 1;
    IF FOUND THEN
      v_event := 'rebound_by_fingerprint';
      v_detail := 'Matched fingerprint; rebound terminal id.';
      v_reclaim_type := 'rebound_by_fingerprint';
    END IF;
  END IF;

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
      v_reclaim_type := 'rebound_by_user_agent';
    END IF;
  END IF;

  IF FOUND THEN
    v_prev_terminal_id := v_existing.terminal_id;

    UPDATE public.device_licenses
    SET terminal_id = _terminal_id,
        device_fingerprint = COALESCE(_device_fingerprint, device_fingerprint),
        device_label = COALESCE(_device_label, device_label),
        platform = COALESCE(_platform, platform),
        user_agent = COALESCE(_user_agent, user_agent),
        last_seen_at = now(),
        last_validated_at = now()
    WHERE id = v_existing.id;

    IF v_reclaim_type IS NOT NULL THEN
      INSERT INTO public.device_seat_reclaim_audit (
        tenant_id, restaurant_id, device_license_id,
        reclaim_type, previous_terminal_id, new_terminal_id,
        device_fingerprint, user_agent, platform,
        claimed_by_user_id, detail
      ) VALUES (
        _tenant_id, _restaurant_id, v_existing.id,
        v_reclaim_type, v_prev_terminal_id, _terminal_id,
        _device_fingerprint, _user_agent, _platform,
        _claimed_by_user_id, v_detail
      );
    END IF;

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
