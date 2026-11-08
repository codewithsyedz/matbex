-- 1. New sales_transactions fields for B2B standard invoices
ALTER TABLE public.sales_transactions
  ADD COLUMN IF NOT EXISTS zatca_invoice_subtype text NOT NULL DEFAULT 'SIMPLIFIED',
  ADD COLUMN IF NOT EXISTS zatca_buyer_name text,
  ADD COLUMN IF NOT EXISTS zatca_buyer_vat_number text,
  ADD COLUMN IF NOT EXISTS zatca_buyer_address text;

ALTER TABLE public.sales_transactions
  DROP CONSTRAINT IF EXISTS sales_transactions_zatca_invoice_subtype_check;
ALTER TABLE public.sales_transactions
  ADD CONSTRAINT sales_transactions_zatca_invoice_subtype_check
  CHECK (zatca_invoice_subtype IN ('SIMPLIFIED', 'STANDARD'));

-- Validation trigger: STANDARD requires buyer name + 15-digit VAT
CREATE OR REPLACE FUNCTION public.validate_zatca_standard_invoice()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.zatca_invoice_subtype = 'STANDARD' THEN
    IF NEW.zatca_buyer_name IS NULL OR length(trim(NEW.zatca_buyer_name)) = 0 THEN
      RAISE EXCEPTION 'Standard ZATCA invoice requires buyer name';
    END IF;
    IF NEW.zatca_buyer_vat_number IS NULL OR NEW.zatca_buyer_vat_number !~ '^\d{15}$' THEN
      RAISE EXCEPTION 'Standard ZATCA invoice requires 15-digit buyer VAT number';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_zatca_standard_invoice ON public.sales_transactions;
CREATE TRIGGER trg_validate_zatca_standard_invoice
BEFORE INSERT OR UPDATE OF zatca_invoice_subtype, zatca_buyer_name, zatca_buyer_vat_number
ON public.sales_transactions
FOR EACH ROW EXECUTE FUNCTION public.validate_zatca_standard_invoice();

-- 2. menu_items VAT category matrix
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS vat_category text NOT NULL DEFAULT 'S',
  ADD COLUMN IF NOT EXISTS vat_exemption_reason_code text;

ALTER TABLE public.menu_items
  DROP CONSTRAINT IF EXISTS menu_items_vat_category_check;
ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_vat_category_check
  CHECK (vat_category IN ('S','Z','E','O'));

-- 3. Tamper-evident audit trail
CREATE TABLE IF NOT EXISTS public.zatca_audit_trail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  actor_user_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash text NOT NULL,
  prev_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zatca_audit_tenant ON public.zatca_audit_trail(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_zatca_audit_entity ON public.zatca_audit_trail(entity_type, entity_id, created_at DESC);

ALTER TABLE public.zatca_audit_trail ENABLE ROW LEVEL SECURITY;

-- Read: managers and owners of the tenant
DROP POLICY IF EXISTS zatca_audit_select ON public.zatca_audit_trail;
CREATE POLICY zatca_audit_select ON public.zatca_audit_trail
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  );

-- Insert: any tenant member (so triggers + edge fns can append)
DROP POLICY IF EXISTS zatca_audit_insert ON public.zatca_audit_trail;
CREATE POLICY zatca_audit_insert ON public.zatca_audit_trail
  FOR INSERT TO authenticated
  WITH CHECK (user_belongs_to_restaurant(auth.uid(), restaurant_id));

-- No UPDATE / DELETE policies - table is append-only by design.

-- Hash computation + chain trigger
CREATE OR REPLACE FUNCTION public.compute_zatca_audit_hash()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  prev text;
  canonical text;
BEGIN
  SELECT payload_hash INTO prev
  FROM public.zatca_audit_trail
  WHERE tenant_id = NEW.tenant_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  NEW.prev_hash := prev;
  canonical := coalesce(prev, '') || '|' || NEW.entity_type || '|' || NEW.entity_id::text
            || '|' || NEW.action || '|' || coalesce(NEW.payload::text, '{}');
  NEW.payload_hash := encode(digest(canonical, 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TRIGGER IF EXISTS trg_compute_zatca_audit_hash ON public.zatca_audit_trail;
CREATE TRIGGER trg_compute_zatca_audit_hash
BEFORE INSERT ON public.zatca_audit_trail
FOR EACH ROW EXECUTE FUNCTION public.compute_zatca_audit_hash();

-- Auto-append audit rows when sales clearance status changes
CREATE OR REPLACE FUNCTION public.audit_sales_clearance_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND coalesce(NEW.zatca_clearance_status, '') = coalesce(OLD.zatca_clearance_status, '') THEN
    RETURN NEW;
  END IF;

  IF NEW.zatca_clearance_status IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.restaurants WHERE id = NEW.restaurant_id;
  IF v_tenant IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.zatca_audit_trail (
    tenant_id, restaurant_id, entity_type, entity_id, action, actor_user_id, payload
  ) VALUES (
    v_tenant,
    NEW.restaurant_id,
    'sales_transaction',
    NEW.id,
    'clearance:' || NEW.zatca_clearance_status,
    auth.uid(),
    jsonb_build_object(
      'uuid', NEW.zatca_uuid,
      'icv', NEW.zatca_icv,
      'invoice_hash', NEW.zatca_invoice_hash,
      'subtype', NEW.zatca_invoice_subtype,
      'cleared_at', NEW.zatca_cleared_at
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_sales_clearance ON public.sales_transactions;
CREATE TRIGGER trg_audit_sales_clearance
AFTER INSERT OR UPDATE OF zatca_clearance_status ON public.sales_transactions
FOR EACH ROW EXECUTE FUNCTION public.audit_sales_clearance_change();