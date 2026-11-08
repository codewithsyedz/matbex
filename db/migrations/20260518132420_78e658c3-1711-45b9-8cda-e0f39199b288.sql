
CREATE OR REPLACE FUNCTION public.get_primary_branch_id(_restaurant_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.branches
  WHERE restaurant_id = _restaurant_id
    AND is_primary = true
    AND deleted_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.auto_stamp_branch_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.restaurant_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.branch_id IS NULL THEN
    NEW.branch_id := public.get_primary_branch_id(NEW.restaurant_id);
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = NEW.branch_id
        AND b.restaurant_id = NEW.restaurant_id
        AND b.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Branch % does not belong to restaurant %',
        NEW.branch_id, NEW.restaurant_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'sales_transactions','sales_items','shifts','cash_events','drawers',
    'shift_templates','expenses','inventory_items','purchases',
    'purchase_invoices','staff_advances','pos_terminals'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS branch_id uuid', tbl);

    EXECUTE format($f$
      UPDATE public.%I t
      SET branch_id = b.id
      FROM public.branches b
      WHERE b.restaurant_id = t.restaurant_id
        AND b.is_primary = true
        AND b.deleted_at IS NULL
        AND t.branch_id IS NULL
    $f$, tbl);

    BEGIN
      EXECUTE format(
        'ALTER TABLE public.%I
           ADD CONSTRAINT %I_branch_id_fkey
           FOREIGN KEY (branch_id) REFERENCES public.branches(id)',
        tbl, tbl
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END;

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%I_restaurant_branch
         ON public.%I (restaurant_id, branch_id)',
      tbl, tbl
    );

    EXECUTE format('DROP TRIGGER IF EXISTS trg_auto_stamp_branch_id ON public.%I', tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_auto_stamp_branch_id
         BEFORE INSERT ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.auto_stamp_branch_id()',
      tbl
    );
  END LOOP;
END $$;

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS assigned_branch_id uuid REFERENCES public.branches(id);

CREATE INDEX IF NOT EXISTS idx_staff_assigned_branch
  ON public.staff(assigned_branch_id) WHERE assigned_branch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.user_pinned_branch_id(_user_id uuid, _restaurant_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.assigned_branch_id
  FROM public.staff s
  WHERE s.user_id = _user_id
    AND s.restaurant_id = _restaurant_id
    AND s.is_active = true
    AND s.assigned_branch_id IS NOT NULL
  LIMIT 1;
$$;
