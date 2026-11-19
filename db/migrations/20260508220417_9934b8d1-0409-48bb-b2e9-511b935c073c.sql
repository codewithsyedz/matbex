CREATE OR REPLACE FUNCTION public.inspect_zatca_audit_break(_tenant_id uuid)
RETURNS TABLE(
  broken_row uuid,
  broken_seq bigint,
  entity_type text,
  entity_id uuid,
  action text,
  created_at timestamptz,
  stored_hash text,
  expected_hash text,
  stored_prev_hash text,
  expected_prev_hash text,
  payload jsonb,
  prev_payload jsonb,
  reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r record;
  v_prev_hash text := repeat('0', 64);
  v_prev_payload jsonb := NULL;
  v_expected text;
BEGIN
  IF public.get_user_tenant_id(auth.uid()) <> _tenant_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR r IN
    SELECT t.id, t.sequence_no, t.entity_type, t.entity_id, t.action, t.created_at,
           t.payload, t.payload_hash, t.prev_hash
    FROM public.zatca_audit_trail t
    WHERE t.tenant_id = _tenant_id
    ORDER BY t.sequence_no ASC
  LOOP
    IF r.prev_hash <> v_prev_hash THEN
      broken_row := r.id; broken_seq := r.sequence_no;
      entity_type := r.entity_type; entity_id := r.entity_id; action := r.action;
      created_at := r.created_at;
      stored_hash := r.payload_hash;
      expected_hash := encode(digest(v_prev_hash || public.zatca_canonical_json(r.payload), 'sha256'), 'hex');
      stored_prev_hash := r.prev_hash;
      expected_prev_hash := v_prev_hash;
      payload := r.payload;
      prev_payload := v_prev_payload;
      reason := 'prev_hash mismatch - chain broken before this row';
      RETURN NEXT; RETURN;
    END IF;

    v_expected := encode(digest(v_prev_hash || public.zatca_canonical_json(r.payload), 'sha256'), 'hex');
    IF v_expected <> r.payload_hash THEN
      broken_row := r.id; broken_seq := r.sequence_no;
      entity_type := r.entity_type; entity_id := r.entity_id; action := r.action;
      created_at := r.created_at;
      stored_hash := r.payload_hash;
      expected_hash := v_expected;
      stored_prev_hash := r.prev_hash;
      expected_prev_hash := v_prev_hash;
      payload := r.payload;
      prev_payload := v_prev_payload;
      reason := 'payload_hash mismatch - payload modified after sealing';
      RETURN NEXT; RETURN;
    END IF;

    v_prev_hash := r.payload_hash;
    v_prev_payload := r.payload;
  END LOOP;

  RETURN;
END;
$fn$;

REVOKE ALL ON FUNCTION public.inspect_zatca_audit_break(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.inspect_zatca_audit_break(uuid) TO authenticated;