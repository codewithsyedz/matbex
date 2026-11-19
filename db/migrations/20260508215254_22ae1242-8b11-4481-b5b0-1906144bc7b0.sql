-- Drop old hash trigger and insert policy (replaced by append_zatca_audit + system-only writes)
DROP TRIGGER IF EXISTS trg_compute_zatca_audit_hash ON public.zatca_audit_trail;
DROP FUNCTION IF EXISTS public.compute_zatca_audit_hash() CASCADE;
DROP POLICY IF EXISTS zatca_audit_insert ON public.zatca_audit_trail;

-- Make restaurant_id optional and add sequence + lock prev_hash NOT NULL with default
ALTER TABLE public.zatca_audit_trail
  ALTER COLUMN restaurant_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS sequence_no bigint;

UPDATE public.zatca_audit_trail
  SET sequence_no = sub.rn
  FROM (
    SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn
    FROM public.zatca_audit_trail
  ) sub
  WHERE public.zatca_audit_trail.id = sub.id
    AND public.zatca_audit_trail.sequence_no IS NULL;

ALTER TABLE public.zatca_audit_trail
  ALTER COLUMN sequence_no SET NOT NULL;

UPDATE public.zatca_audit_trail SET prev_hash = repeat('0', 64) WHERE prev_hash IS NULL;
ALTER TABLE public.zatca_audit_trail
  ALTER COLUMN prev_hash SET NOT NULL;

-- Drop and re-add CHECK constraints to broaden enums
ALTER TABLE public.zatca_audit_trail
  DROP CONSTRAINT IF EXISTS zatca_audit_trail_entity_type_check,
  DROP CONSTRAINT IF EXISTS zatca_audit_trail_action_check;
ALTER TABLE public.zatca_audit_trail
  ADD CONSTRAINT zatca_audit_trail_entity_type_check
    CHECK (entity_type IN ('invoice','credit_note','device','settings'));
ALTER TABLE public.zatca_audit_trail
  ADD CONSTRAINT zatca_audit_trail_action_check
    CHECK (action IN (
      'SUBMITTED','CLEARED','REPORTED','CLEARED_SIM','REJECTED','SCHEMA_INVALID',
      'CREDIT_ISSUED','DEVICE_ONBOARDED','CSID_RENEWED'
    ));

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'zatca_audit_tenant_seq_uk'
  ) THEN
    ALTER TABLE public.zatca_audit_trail
      ADD CONSTRAINT zatca_audit_tenant_seq_uk UNIQUE (tenant_id, sequence_no);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_zatca_audit_tenant_seq_desc
  ON public.zatca_audit_trail (tenant_id, sequence_no DESC);

-- Replace SELECT policy with tenant-wide read (was role-restricted to owner/manager via restaurant_id)
DROP POLICY IF EXISTS zatca_audit_select ON public.zatca_audit_trail;
CREATE POLICY zatca_audit_select ON public.zatca_audit_trail
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- Per-tenant sequence
CREATE TABLE IF NOT EXISTS public.zatca_audit_seq (
  tenant_id uuid PRIMARY KEY,
  last_seq  bigint NOT NULL DEFAULT 0
);
ALTER TABLE public.zatca_audit_seq ENABLE ROW LEVEL SECURITY;

-- Seed sequence from existing rows
INSERT INTO public.zatca_audit_seq(tenant_id, last_seq)
SELECT tenant_id, max(sequence_no)
FROM public.zatca_audit_trail
GROUP BY tenant_id
ON CONFLICT (tenant_id) DO UPDATE SET last_seq = EXCLUDED.last_seq;

-- Canonical JSON
CREATE OR REPLACE FUNCTION public.zatca_canonical_json(p jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) = 'null' THEN 'null'
    WHEN jsonb_typeof(p) <> 'object' THEN p::text
    ELSE '{' || coalesce((
      SELECT string_agg(to_json(k)::text || ':' || (p -> k)::text, ',' ORDER BY k)
      FROM jsonb_object_keys(p) AS k
    ), '') || '}'
  END
$fn$;

CREATE OR REPLACE FUNCTION public.append_zatca_audit(
  _tenant_id uuid, _entity_type text, _entity_id uuid,
  _action text, _actor uuid, _payload jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_prev_hash text;
  v_seq       bigint;
  v_hash      text;
  v_id        uuid;
BEGIN
  INSERT INTO public.zatca_audit_seq(tenant_id, last_seq)
  VALUES (_tenant_id, 1)
  ON CONFLICT (tenant_id) DO UPDATE
    SET last_seq = public.zatca_audit_seq.last_seq + 1
  RETURNING last_seq INTO v_seq;

  SELECT t.payload_hash INTO v_prev_hash
  FROM public.zatca_audit_trail t
  WHERE t.tenant_id = _tenant_id AND t.sequence_no = v_seq - 1;
  IF v_prev_hash IS NULL THEN v_prev_hash := repeat('0', 64); END IF;

  v_hash := encode(digest(v_prev_hash || public.zatca_canonical_json(_payload), 'sha256'), 'hex');

  INSERT INTO public.zatca_audit_trail(
    tenant_id, entity_type, entity_id, action, actor_user_id,
    payload, payload_hash, prev_hash, sequence_no
  ) VALUES (
    _tenant_id, _entity_type, _entity_id, _action, _actor,
    _payload, v_hash, v_prev_hash, v_seq
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.append_zatca_audit(uuid,text,uuid,text,uuid,jsonb) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.verify_zatca_audit_chain(_tenant_id uuid)
RETURNS TABLE(broken_row uuid, broken_seq bigint, total_rows bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r          record;
  v_prev     text := repeat('0', 64);
  v_expected text;
  v_total    bigint := 0;
BEGIN
  IF public.get_user_tenant_id(auth.uid()) <> _tenant_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

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

GRANT EXECUTE ON FUNCTION public.verify_zatca_audit_chain(uuid) TO authenticated;

-- Triggers
CREATE OR REPLACE FUNCTION public.trg_zatca_audit_sales()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_tenant uuid;
BEGIN
  IF NEW.zatca_clearance_status IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.zatca_clearance_status IS NOT DISTINCT FROM OLD.zatca_clearance_status THEN
    RETURN NEW;
  END IF;
  IF NEW.zatca_clearance_status NOT IN ('CLEARED','REPORTED','CLEARED_SIM','REJECTED','SCHEMA_INVALID','SUBMITTED') THEN
    RETURN NEW;
  END IF;

  SELECT r.tenant_id INTO v_tenant FROM public.restaurants r WHERE r.id = NEW.restaurant_id;
  IF v_tenant IS NULL THEN RETURN NEW; END IF;

  PERFORM public.append_zatca_audit(
    v_tenant, 'invoice', NEW.id, NEW.zatca_clearance_status, auth.uid(),
    jsonb_build_object(
      'uuid', NEW.zatca_uuid,
      'icv', NEW.zatca_icv,
      'pih', NEW.zatca_pih,
      'invoice_hash', NEW.zatca_invoice_hash,
      'status', NEW.zatca_clearance_status,
      'cleared_at', NEW.zatca_cleared_at,
      'device_id', NEW.zatca_device_id,
      'total', NEW.zatca_invoice_total,
      'vat', NEW.zatca_vat_total
    )
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_audit_sales_clearance ON public.sales_transactions;
CREATE TRIGGER trg_audit_sales_clearance
AFTER INSERT OR UPDATE OF zatca_clearance_status ON public.sales_transactions
FOR EACH ROW EXECUTE FUNCTION public.trg_zatca_audit_sales();

CREATE OR REPLACE FUNCTION public.trg_zatca_audit_credit_notes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_action text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'CREDIT_ISSUED';
  ELSIF NEW.clearance_status IS NOT DISTINCT FROM OLD.clearance_status THEN
    RETURN NEW;
  ELSE
    v_action := NEW.clearance_status;
    IF v_action NOT IN ('CLEARED','REPORTED','CLEARED_SIM','REJECTED','SCHEMA_INVALID') THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM public.append_zatca_audit(
    NEW.tenant_id, 'credit_note', NEW.id, v_action, auth.uid(),
    jsonb_build_object(
      'uuid', NEW.uuid,
      'icv', NEW.icv,
      'pih', NEW.pih,
      'credit_note_number', NEW.credit_note_number,
      'original_uuid', NEW.original_uuid,
      'reason_code', NEW.reason_code,
      'total_refunded', NEW.total_refunded,
      'vat_refunded', NEW.vat_refunded,
      'status', NEW.clearance_status
    )
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_audit_credit_notes ON public.zatca_credit_notes;
CREATE TRIGGER trg_audit_credit_notes
AFTER INSERT OR UPDATE OF clearance_status ON public.zatca_credit_notes
FOR EACH ROW EXECUTE FUNCTION public.trg_zatca_audit_credit_notes();

CREATE OR REPLACE FUNCTION public.trg_zatca_audit_devices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_action text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.registration_status = 'REGISTERED' THEN v_action := 'DEVICE_ONBOARDED';
    ELSE RETURN NEW; END IF;
  ELSE
    IF NEW.registration_status = 'REGISTERED' AND OLD.registration_status IS DISTINCT FROM 'REGISTERED' THEN
      v_action := 'DEVICE_ONBOARDED';
    ELSIF NEW.production_csid IS DISTINCT FROM OLD.production_csid AND NEW.production_csid IS NOT NULL THEN
      v_action := 'CSID_RENEWED';
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  PERFORM public.append_zatca_audit(
    NEW.tenant_id, 'device', NEW.id, v_action, auth.uid(),
    jsonb_build_object(
      'name', NEW.name,
      'serial_number', NEW.serial_number,
      'registration_status', NEW.registration_status,
      'csid_expires_at', NEW.csid_expires_at,
      'icv_counter', NEW.icv_counter
    )
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_audit_devices ON public.zatca_devices;
CREATE TRIGGER trg_audit_devices
AFTER INSERT OR UPDATE OF registration_status, production_csid ON public.zatca_devices
FOR EACH ROW EXECUTE FUNCTION public.trg_zatca_audit_devices();
