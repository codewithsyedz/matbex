
-- Bump a menu-price version counter whenever prices change.
CREATE OR REPLACE FUNCTION public.bump_menu_price_version(_restaurant_id uuid, _entity_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.pos_entity_versions (restaurant_id, entity_type, entity_id, version, updated_at)
  VALUES (_restaurant_id, 'menu_prices', _entity_id, 1, now())
  ON CONFLICT (restaurant_id, entity_type, entity_id)
  DO UPDATE SET version = public.pos_entity_versions.version + 1, updated_at = now();
$$;

CREATE OR REPLACE FUNCTION public.trg_bump_branch_price_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  rid uuid;
BEGIN
  r := COALESCE(NEW, OLD);
  SELECT b.restaurant_id INTO rid FROM public.branches b WHERE b.id = r.branch_id;
  IF rid IS NOT NULL THEN
    PERFORM public.bump_menu_price_version(rid, r.branch_id::text);
    PERFORM public.bump_menu_price_version(rid, 'tenant');
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_branch_price_version ON public.menu_item_branch_prices;
CREATE TRIGGER trg_bump_branch_price_version
AFTER INSERT OR UPDATE OR DELETE ON public.menu_item_branch_prices
FOR EACH ROW EXECUTE FUNCTION public.trg_bump_branch_price_version();

CREATE OR REPLACE FUNCTION public.trg_bump_menu_item_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  r := COALESCE(NEW, OLD);
  IF TG_OP = 'UPDATE'
     AND NEW.selling_price IS NOT DISTINCT FROM OLD.selling_price
     AND NEW.quarter_price IS NOT DISTINCT FROM OLD.quarter_price
     AND NEW.half_price    IS NOT DISTINCT FROM OLD.half_price
     AND NEW.full_price    IS NOT DISTINCT FROM OLD.full_price
     AND NEW.is_active     IS NOT DISTINCT FROM OLD.is_active THEN
    RETURN NEW;
  END IF;

  PERFORM public.bump_menu_price_version(r.restaurant_id, 'tenant');
  PERFORM public.bump_menu_price_version(r.restaurant_id, b.id::text)
    FROM public.branches b
   WHERE b.restaurant_id = r.restaurant_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_menu_item_version ON public.menu_items;
CREATE TRIGGER trg_bump_menu_item_version
AFTER INSERT OR UPDATE OR DELETE ON public.menu_items
FOR EACH ROW EXECUTE FUNCTION public.trg_bump_menu_item_version();

ALTER TABLE public.pos_entity_versions REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pos_entity_versions;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

GRANT SELECT ON public.pos_entity_versions TO authenticated;
GRANT ALL ON public.pos_entity_versions TO service_role;
