
-- Allow public storefront to read minimal restaurant info and active menu items
CREATE POLICY "Public can view restaurants for storefront"
  ON public.restaurants FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public can view active menu items"
  ON public.menu_items FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

GRANT SELECT ON public.restaurants TO anon;
GRANT SELECT ON public.menu_items TO anon;
