-- Devices
CREATE TABLE IF NOT EXISTS public.zatca_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  name text NOT NULL,
  serial_number text NOT NULL,
  model text,
  otp text,
  registration_status text NOT NULL DEFAULT 'PENDING'
    CHECK (registration_status IN ('PENDING','REGISTERED','REVOKED')),
  csr text,
  compliance_csid text,
  production_csid text,
  csid_expires_at timestamptz,
  icv_counter bigint NOT NULL DEFAULT 0,
  last_pih text,
  registered_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, serial_number)
);

CREATE INDEX IF NOT EXISTS idx_zatca_devices_tenant ON public.zatca_devices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_zatca_devices_restaurant ON public.zatca_devices(restaurant_id);

ALTER TABLE public.zatca_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zatca_devices_select" ON public.zatca_devices
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "zatca_devices_insert" ON public.zatca_devices
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "zatca_devices_update" ON public.zatca_devices
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "zatca_devices_delete" ON public.zatca_devices
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE TRIGGER trg_zatca_devices_updated
  BEFORE UPDATE ON public.zatca_devices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Phase 2 columns on sales_transactions
ALTER TABLE public.sales_transactions
  ADD COLUMN IF NOT EXISTS zatca_device_id uuid REFERENCES public.zatca_devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS zatca_icv bigint,
  ADD COLUMN IF NOT EXISTS zatca_pih text,
  ADD COLUMN IF NOT EXISTS zatca_invoice_hash text,
  ADD COLUMN IF NOT EXISTS zatca_uuid uuid,
  ADD COLUMN IF NOT EXISTS zatca_xml_url text,
  ADD COLUMN IF NOT EXISTS zatca_clearance_status text
    CHECK (zatca_clearance_status IS NULL OR zatca_clearance_status IN ('PENDING','CLEARED','REPORTED','REJECTED','NOT_APPLICABLE')),
  ADD COLUMN IF NOT EXISTS zatca_clearance_response jsonb,
  ADD COLUMN IF NOT EXISTS zatca_cleared_at timestamptz,
  ADD COLUMN IF NOT EXISTS legal_retention_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_sales_zatca_device ON public.sales_transactions(zatca_device_id);
CREATE INDEX IF NOT EXISTS idx_sales_legal_retention ON public.sales_transactions(restaurant_id, legal_retention_until);
CREATE INDEX IF NOT EXISTS idx_sales_zatca_clearance ON public.sales_transactions(restaurant_id, zatca_clearance_status)
  WHERE zatca_clearance_status IS NOT NULL;

-- Auto-set legal retention (6 years for ZATCA)
CREATE OR REPLACE FUNCTION public.set_legal_retention_until()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.legal_retention_until IS NULL THEN
    NEW.legal_retention_until := COALESCE(NEW.created_at, now()) + interval '6 years';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_legal_retention ON public.sales_transactions;
CREATE TRIGGER trg_set_legal_retention
  BEFORE INSERT ON public.sales_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_legal_retention_until();

-- Backfill retention for existing rows
UPDATE public.sales_transactions
SET legal_retention_until = created_at + interval '6 years'
WHERE legal_retention_until IS NULL;