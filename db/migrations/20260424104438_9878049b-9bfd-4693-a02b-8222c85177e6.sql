CREATE TABLE IF NOT EXISTS public.expense_category_mapping_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.expense_categories(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  old_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  new_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ecmh_category ON public.expense_category_mapping_history(category_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ecmh_restaurant ON public.expense_category_mapping_history(restaurant_id, changed_at DESC);

ALTER TABLE public.expense_category_mapping_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners and managers can view mapping history"
  ON public.expense_category_mapping_history;
CREATE POLICY "Owners and managers can view mapping history"
  ON public.expense_category_mapping_history
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.restaurant_id = expense_category_mapping_history.restaurant_id
        AND ur.role IN ('owner', 'manager')
    )
  );

CREATE OR REPLACE FUNCTION public.log_expense_category_mapping_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    INSERT INTO public.expense_category_mapping_history (
      category_id, restaurant_id, old_account_id, new_account_id, changed_by
    ) VALUES (
      NEW.id, NEW.restaurant_id, OLD.account_id, NEW.account_id, auth.uid()
    );
  ELSIF TG_OP = 'INSERT' AND NEW.account_id IS NOT NULL THEN
    INSERT INTO public.expense_category_mapping_history (
      category_id, restaurant_id, old_account_id, new_account_id, changed_by
    ) VALUES (
      NEW.id, NEW.restaurant_id, NULL, NEW.account_id, auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_expense_category_mapping_change
  ON public.expense_categories;
CREATE TRIGGER trg_log_expense_category_mapping_change
  AFTER INSERT OR UPDATE OF account_id
  ON public.expense_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.log_expense_category_mapping_change();