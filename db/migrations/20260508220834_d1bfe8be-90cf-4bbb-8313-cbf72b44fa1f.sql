CREATE OR REPLACE FUNCTION public.verify_zatca_audit_chain_admin(_tenant_id uuid)
RETURNS TABLE(broken_row uuid, broken_seq bigint, total_rows bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r record;
  v_prev text := repeat('0', 64);
  v_expected text;
  v_total bigint := 0;
BEGIN
  FOR r IN
    SELECT t.id, t.sequence_no, t.payload, t.payload_hash, t.prev_hash
    FROM public.zatca_audit_trail t
    WHERE t.tenant_id = _tenant_id
    ORDER BY t.sequence_no ASC
  LOOP
    v_total := v_total + 1;
    IF r.prev_hash <> v_prev THEN
      broken_row := r.id; broken_seq := r.sequence_no; total_rows := v_total;
      RETURN NEXT; RETURN;
    END IF;
    v_expected := encode(digest(v_prev || public.zatca_canonical_json(r.payload), 'sha256'), 'hex');
    IF v_expected <> r.payload_hash THEN
      broken_row := r.id; broken_seq := r.sequence_no; total_rows := v_total;
      RETURN NEXT; RETURN;
    END IF;
    v_prev := r.payload_hash;
  END LOOP;
  broken_row := NULL; broken_seq := NULL; total_rows := v_total;
  RETURN NEXT;
END;
$fn$;

REVOKE ALL ON FUNCTION public.verify_zatca_audit_chain_admin(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_zatca_audit_chain_admin(uuid) TO service_role;