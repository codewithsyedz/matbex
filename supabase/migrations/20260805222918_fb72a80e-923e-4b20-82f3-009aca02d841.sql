-- 1. Account metadata
ALTER TABLE public.chart_of_accounts
  ADD COLUMN IF NOT EXISTS requires_cost_center boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_fixed_asset_account boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vat_applicable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS help_text text;

-- 2. Seed missing fixed-asset accounts per tenant (existing codes untouched)
INSERT INTO public.chart_of_accounts (tenant_id, account_code, account_name, account_type, description, is_system_account, is_active)
SELECT t.tenant_id, v.code, v.name, 'asset'::account_type, v.descr, false, true
FROM (SELECT DISTINCT tenant_id FROM public.chart_of_accounts) t
CROSS JOIN (VALUES
  ('1505', 'HVAC / AC Equipment', 'AC units, ducting and HVAC installation'),
  ('1515', 'Security & Fire Equipment', 'CCTV, cameras, alarms and fire safety equipment'),
  ('1525', 'Signage', 'Exterior and interior branding signage'),
  ('1590', 'Other Fixed Assets', 'Capitalised assets that do not fit another class')
) AS v(code, name, descr)
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts c
  WHERE c.tenant_id = t.tenant_id AND c.account_code = v.code
);

-- 3. Flag metadata on existing accounts
UPDATE public.chart_of_accounts
SET is_fixed_asset_account = true,
    requires_cost_center = true
WHERE account_type = 'asset'
  AND account_code >= '1500' AND account_code < '1600';

UPDATE public.chart_of_accounts
SET vat_applicable = true
WHERE account_type IN ('expense', 'cogs')
   OR (account_type = 'asset' AND account_code >= '1500' AND account_code < '1600');

UPDATE public.chart_of_accounts
SET help_text = CASE
  WHEN account_code = '1540' THEN 'Restaurant fit-out and leasehold improvements: tiles, paint, gypsum, glass, electrical, counters. Depreciable.'
  WHEN account_code = '1505' THEN 'AC units, ducting and HVAC installation. Depreciable.'
  WHEN account_code = '1560' THEN 'Price paid to acquire a running business. Never mix with post-acquisition renovation.'
  WHEN account_code = '1570' THEN 'Residual acquisition value not attributable to identifiable assets.'
  WHEN account_code LIKE '2410%' OR account_code LIKE '2411%' OR account_code LIKE '2412%' THEN 'Partner current account: business costs the partner paid personally. Repayable, not equity.'
  WHEN account_code LIKE '242%' THEN 'Partner loan: money lent to the business and expected to be repaid. Liability, not equity.'
  WHEN account_code LIKE '34%' THEN 'Partner capital: equity contributed by a partner.'
  ELSE help_text
END
WHERE account_code IN ('1540','1505','1560','1570')
   OR account_code LIKE '241%' OR account_code LIKE '242%' OR account_code LIKE '34%';

-- 4. Acquisition purchase price allocation
CREATE TABLE IF NOT EXISTS public.project_acquisition_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  acquisition_id uuid NOT NULL REFERENCES public.project_acquisitions(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id),
  description text,
  amount numeric NOT NULL CHECK (amount > 0),
  create_fixed_asset boolean NOT NULL DEFAULT false,
  asset_class_id uuid,
  fixed_asset_id uuid,
  useful_life_years integer,
  residual_value numeric NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_acquisition_allocations TO authenticated;
GRANT ALL ON public.project_acquisition_allocations TO service_role;
ALTER TABLE public.project_acquisition_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members manage acquisition allocations"
ON public.project_acquisition_allocations FOR ALL TO authenticated
USING (tenant_id = public.get_user_tenant_id(auth.uid()))
WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_acq_alloc_acquisition ON public.project_acquisition_allocations(acquisition_id);

CREATE TRIGGER trg_acq_alloc_updated_at
BEFORE UPDATE ON public.project_acquisition_allocations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Hard block: allocations may never exceed the purchase price
CREATE OR REPLACE FUNCTION public.enforce_acquisition_allocation_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_price numeric;
  v_total numeric;
BEGIN
  SELECT amount INTO v_price FROM public.project_acquisitions WHERE id = NEW.acquisition_id;
  SELECT COALESCE(SUM(amount), 0) INTO v_total
  FROM public.project_acquisition_allocations
  WHERE acquisition_id = NEW.acquisition_id AND id <> NEW.id;
  v_total := v_total + NEW.amount;
  IF v_price IS NOT NULL AND v_total > v_price + 0.01 THEN
    RAISE EXCEPTION 'Purchase price allocation (%.2f) exceeds the acquisition price (%.2f)', v_total, v_price;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_acquisition_allocation_total
BEFORE INSERT OR UPDATE ON public.project_acquisition_allocations
FOR EACH ROW EXECUTE FUNCTION public.enforce_acquisition_allocation_total();

-- 6. Hard block: fixed-asset postings require a cost centre (branch or project)
CREATE OR REPLACE FUNCTION public.enforce_account_cost_center()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requires boolean;
  v_code text;
BEGIN
  SELECT requires_cost_center, account_code INTO v_requires, v_code
  FROM public.chart_of_accounts WHERE id = NEW.account_id;

  IF COALESCE(v_requires, false)
     AND NEW.branch_id IS NULL
     AND NEW.project_id IS NULL
     AND COALESCE(NEW.is_voided, false) = false THEN
    RAISE EXCEPTION 'Account % requires a cost centre: set a branch or project on this posting.', v_code;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_account_cost_center
BEFORE INSERT ON public.account_transactions
FOR EACH ROW EXECUTE FUNCTION public.enforce_account_cost_center();