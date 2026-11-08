CREATE OR REPLACE FUNCTION public.enforce_project_ownership_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric(9,3);
BEGIN
  IF NEW.project_id IS NULL OR NEW.is_active IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(ownership_pct), 0) INTO v_total
  FROM public.project_partners
  WHERE project_id = NEW.project_id
    AND is_active = true
    AND id <> NEW.id;

  v_total := v_total + COALESCE(NEW.ownership_pct, 0);

  IF v_total > 100.001 THEN
    RAISE EXCEPTION 'Ownership total for this project would be %%%, which exceeds 100%%. Reduce another partner''s share first.', to_char(v_total, 'FM999990.00')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_project_ownership_total ON public.project_partners;
CREATE TRIGGER trg_enforce_project_ownership_total
BEFORE INSERT OR UPDATE OF ownership_pct, is_active, project_id ON public.project_partners
FOR EACH ROW EXECUTE FUNCTION public.enforce_project_ownership_total();