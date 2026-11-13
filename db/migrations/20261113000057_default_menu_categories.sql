-- default_menu_categories
--
-- A new restaurant had no menu categories: the item form's category list was empty, items went
-- to the hidden default key 'main', and screens showed the raw key ("main"). On the production
-- copy five restaurants had none, some with items under keys such as 'karahi'. Found in the
-- staging QA walk-through.
--
-- Every new restaurant gets the standard five (the same names and colours existing businesses
-- use); restaurants with no categories get them now, plus one for each key their items already
-- use (named from the key, e.g. beef_motton -> "Beef motton"; the owner can rename it).

CREATE OR REPLACE FUNCTION public.seed_default_menu_categories(p_restaurant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM restaurants WHERE id = p_restaurant_id;
  IF v_tenant IS NULL OR EXISTS (SELECT 1 FROM menu_categories WHERE restaurant_id = p_restaurant_id) THEN
    RETURN;
  END IF;
  INSERT INTO menu_categories (tenant_id, restaurant_id, key, name_en, name_ar, color, display_order)
  VALUES (v_tenant, p_restaurant_id, 'main', 'Main', 'رئيسي', 'blue', 1),
         (v_tenant, p_restaurant_id, 'appetizer', 'Appetizer', 'مقبلات', 'amber', 2),
         (v_tenant, p_restaurant_id, 'dessert', 'Dessert', 'حلويات', 'pink', 3),
         (v_tenant, p_restaurant_id, 'beverage', 'Beverage', 'مشروبات', 'cyan', 4),
         (v_tenant, p_restaurant_id, 'side', 'Side', 'أطباق جانبية', 'green', 5);
  -- Keys the restaurant's items already use.
  INSERT INTO menu_categories (tenant_id, restaurant_id, key, name_en, display_order)
  SELECT v_tenant, p_restaurant_id, k.category,
         upper(left(replace(k.category, '_', ' '), 1)) || substr(replace(k.category, '_', ' '), 2),
         5 + row_number() OVER (ORDER BY k.category)
  FROM (SELECT DISTINCT category FROM menu_items
        WHERE restaurant_id = p_restaurant_id AND coalesce(category, '') <> ''
          AND category NOT IN ('main', 'appetizer', 'dessert', 'beverage', 'side')) k;
END;
$function$;
REVOKE ALL ON FUNCTION public.seed_default_menu_categories(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_seed_default_menu_categories()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.seed_default_menu_categories(NEW.id);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.trg_seed_default_menu_categories() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS restaurants_seed_menu_categories ON public.restaurants;
CREATE TRIGGER restaurants_seed_menu_categories
  AFTER INSERT ON public.restaurants
  FOR EACH ROW EXECUTE FUNCTION public.trg_seed_default_menu_categories();

SELECT public.seed_default_menu_categories(r.id)
FROM restaurants r
WHERE NOT EXISTS (SELECT 1 FROM menu_categories c WHERE c.restaurant_id = r.id);
