
-- =========================================================
-- PHASE 1: Foundation for Foodics-style perpetual COGS
-- =========================================================

-- 1) Standard ingredient categories with account mapping
-- Seed for every existing tenant and auto-seed for new tenants.

CREATE TABLE IF NOT EXISTS public.standard_ingredient_categories (
  key text PRIMARY KEY,
  display_name text NOT NULL,
  inventory_account_code text NOT NULL,
  inventory_account_name text NOT NULL,
  cogs_account_code text NOT NULL,
  cogs_account_name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);

INSERT INTO public.standard_ingredient_categories
  (key, display_name, inventory_account_code, inventory_account_name, cogs_account_code, cogs_account_name, sort_order)
VALUES
  ('meat',       'Meat',       '1210', 'Meat Inventory',       '5010', 'Meat Cost',       1),
  ('chicken',    'Chicken',    '1220', 'Chicken Inventory',    '5020', 'Chicken Cost',    2),
  ('vegetables', 'Vegetables', '1230', 'Vegetables Inventory', '5030', 'Vegetables Cost', 3),
  ('dairy',      'Dairy',      '1240', 'Dairy Inventory',      '5040', 'Dairy Cost',      4),
  ('packaging',  'Packaging',  '1250', 'Packaging Inventory',  '5050', 'Packaging Cost',  5),
  ('beverages',  'Beverages',  '1260', 'Beverage Inventory',   '5060', 'Beverage Cost',   6)
ON CONFLICT (key) DO UPDATE
SET display_name = EXCLUDED.display_name,
    inventory_account_code = EXCLUDED.inventory_account_code,
    inventory_account_name = EXCLUDED.inventory_account_name,
    cogs_account_code = EXCLUDED.cogs_account_code,
    cogs_account_name = EXCLUDED.cogs_account_name,
    sort_order = EXCLUDED.sort_order;

-- Function: ensure CoA accounts + inventory_categories exist for a tenant
CREATE OR REPLACE FUNCTION public.ensure_standard_ingredient_setup(_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  v_restaurant_id uuid;
BEGIN
  -- Restaurant for this tenant (single-location assumption)
  SELECT id INTO v_restaurant_id
  FROM public.restaurants
  WHERE tenant_id = _tenant_id
  ORDER BY created_at ASC
  LIMIT 1;

  FOR rec IN SELECT * FROM public.standard_ingredient_categories ORDER BY sort_order LOOP
    -- Inventory account (asset)
    INSERT INTO public.chart_of_accounts
      (tenant_id, account_code, account_name, account_type, is_system_account, is_active)
    VALUES
      (_tenant_id, rec.inventory_account_code, rec.inventory_account_name, 'asset', true, true)
    ON CONFLICT (tenant_id, account_code) DO NOTHING;

    -- COGS account
    INSERT INTO public.chart_of_accounts
      (tenant_id, account_code, account_name, account_type, is_system_account, is_active)
    VALUES
      (_tenant_id, rec.cogs_account_code, rec.cogs_account_name, 'cogs', true, true)
    ON CONFLICT (tenant_id, account_code) DO NOTHING;

    -- Inventory_categories row (per restaurant)
    IF v_restaurant_id IS NOT NULL THEN
      INSERT INTO public.inventory_categories
        (restaurant_id, name, inventory_account_code, cogs_account_code, cogs_frequency)
      VALUES
        (v_restaurant_id, rec.display_name, rec.inventory_account_code, rec.cogs_account_code, 'monthly')
      ON CONFLICT (restaurant_id, name) DO UPDATE
      SET inventory_account_code = EXCLUDED.inventory_account_code,
          cogs_account_code = EXCLUDED.cogs_account_code;
    END IF;
  END LOOP;
END;
$$;

-- Backfill existing tenants
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT id FROM public.tenants LOOP
    PERFORM public.ensure_standard_ingredient_setup(t.id);
  END LOOP;
END $$;

-- Auto-seed on new tenant creation
CREATE OR REPLACE FUNCTION public.trg_seed_standard_ingredient_setup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_standard_ingredient_setup(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_ingredient_setup ON public.tenants;
CREATE TRIGGER trg_seed_ingredient_setup
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.trg_seed_standard_ingredient_setup();

-- 2) Unit-of-measure on recipe ingredients
ALTER TABLE public.recipe_ingredients
  ADD COLUMN IF NOT EXISTS unit text;

-- Backfill from inventory item's unit
UPDATE public.recipe_ingredients ri
SET unit = ii.unit
FROM public.inventory_items ii
WHERE ri.inventory_item_id = ii.id
  AND ri.unit IS NULL;

-- 3) Recipes-needing-attention view
CREATE OR REPLACE VIEW public.menu_items_recipe_status AS
SELECT
  mi.id              AS menu_item_id,
  mi.restaurant_id,
  mi.name            AS menu_item_name,
  mi.is_active,
  COUNT(ri.id)       AS ingredient_count,
  COALESCE(SUM(ri.quantity_required * ii.unit_cost), 0)::numeric(12,4) AS theoretical_food_cost,
  CASE
    WHEN COUNT(ri.id) = 0 THEN 'missing'
    WHEN COUNT(ri.id) FILTER (WHERE ii.category_id IS NULL) > 0 THEN 'uncategorized'
    ELSE 'complete'
  END AS status
FROM public.menu_items mi
LEFT JOIN public.recipe_ingredients ri ON ri.menu_item_id = mi.id
LEFT JOIN public.inventory_items ii    ON ii.id = ri.inventory_item_id
GROUP BY mi.id, mi.restaurant_id, mi.name, mi.is_active;

-- 4) Weighted-average cost engine on purchases
CREATE OR REPLACE FUNCTION public.update_inventory_wac_on_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_stock numeric(12,2);
  v_current_cost  numeric(12,4);
  v_new_qty       numeric(12,2);
  v_new_unit_cost numeric(12,4);
  v_new_wac       numeric(12,4);
  v_total_qty     numeric(12,2);
BEGIN
  IF NEW.inventory_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT current_stock, unit_cost
  INTO v_current_stock, v_current_cost
  FROM public.inventory_items
  WHERE id = NEW.inventory_item_id
  FOR UPDATE;

  -- purchases.quantity = qty in stock units; unit_cost may be stored in different fields by version.
  v_new_qty := COALESCE(NEW.quantity, 0);
  v_new_unit_cost := COALESCE(NEW.unit_cost, 0);

  v_total_qty := COALESCE(v_current_stock, 0) + v_new_qty;

  IF v_total_qty <= 0 THEN
    -- nothing meaningful to recompute; keep prior cost
    RETURN NEW;
  END IF;

  -- If existing stock <= 0, just adopt new cost (avoid negative-weight artefacts)
  IF COALESCE(v_current_stock, 0) <= 0 THEN
    v_new_wac := v_new_unit_cost;
  ELSE
    v_new_wac := (
      (COALESCE(v_current_stock, 0) * COALESCE(v_current_cost, 0))
      + (v_new_qty * v_new_unit_cost)
    ) / v_total_qty;
  END IF;

  UPDATE public.inventory_items
  SET unit_cost = v_new_wac,
      updated_at = now()
  WHERE id = NEW.inventory_item_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_inventory_wac_on_purchase ON public.purchases;
CREATE TRIGGER trg_update_inventory_wac_on_purchase
AFTER INSERT ON public.purchases
FOR EACH ROW
EXECUTE FUNCTION public.update_inventory_wac_on_purchase();

-- 5) Staging table for provisional per-sale COGS (Phase 2 will populate)
CREATE TABLE IF NOT EXISTS public.provisional_cogs_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  sale_item_id uuid NOT NULL REFERENCES public.sales_items(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  inventory_category_id uuid REFERENCES public.inventory_categories(id) ON DELETE SET NULL,
  qty_consumed numeric(12,4) NOT NULL,
  unit_cost_at_sale numeric(12,4) NOT NULL,
  cogs_amount numeric(12,4) NOT NULL,
  inventory_account_code text NOT NULL,
  cogs_account_code text NOT NULL,
  stock_movement_id uuid REFERENCES public.stock_movements(id) ON DELETE SET NULL,
  ledger_transaction_debit_id uuid REFERENCES public.account_transactions(id) ON DELETE SET NULL,
  ledger_transaction_credit_id uuid REFERENCES public.account_transactions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','posted','reversed','voided','negative_stock_flag')),
  is_negative_stock boolean NOT NULL DEFAULT false,
  posted_at timestamptz,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Idempotency: one row per (sale_item, ingredient line)
  UNIQUE (sale_item_id, inventory_item_id)
);

CREATE INDEX IF NOT EXISTS idx_provisional_cogs_tenant_status
  ON public.provisional_cogs_postings (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_provisional_cogs_restaurant_created
  ON public.provisional_cogs_postings (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provisional_cogs_negative
  ON public.provisional_cogs_postings (tenant_id) WHERE is_negative_stock = true;

ALTER TABLE public.provisional_cogs_postings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read provisional cogs"
ON public.provisional_cogs_postings
FOR SELECT TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "System inserts provisional cogs"
ON public.provisional_cogs_postings
FOR INSERT TO authenticated
WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Managers update provisional cogs"
ON public.provisional_cogs_postings
FOR UPDATE TO authenticated
USING (tenant_has_role(tenant_id, 'manager'));
