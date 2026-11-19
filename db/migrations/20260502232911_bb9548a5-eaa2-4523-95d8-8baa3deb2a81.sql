
ALTER TABLE public.standard_ingredient_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read standard ingredient categories"
ON public.standard_ingredient_categories
FOR SELECT TO authenticated
USING (true);
