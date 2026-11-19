-- 1. Helper: can a user access data for a given branch?
CREATE OR REPLACE FUNCTION public.user_can_access_branch(
  _user_id uuid,
  _restaurant_id uuid,
  _branch_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pinned uuid;
  _has_staff_row boolean;
BEGIN
  IF _user_id IS NULL OR _restaurant_id IS NULL THEN
    RETURN true; -- service role / system contexts
  END IF;

  -- Owners and managers always have full access
  IF public.has_role(_user_id, _restaurant_id, 'owner'::app_role)
     OR public.has_role(_user_id, _restaurant_id, 'manager'::app_role) THEN
    RETURN true;
  END IF;

  -- Look up an active staff row for this user/restaurant
  SELECT s.assigned_branch_id,
         true
    INTO _pinned, _has_staff_row
  FROM public.staff s
  WHERE s.user_id = _user_id
    AND s.restaurant_id = _restaurant_id
    AND s.is_active = true
  ORDER BY (s.assigned_branch_id IS NOT NULL) DESC
  LIMIT 1;

  -- Unpinned (no staff row, or staff row with NULL branch) = back-compat, allow
  IF _pinned IS NULL THEN
    RETURN true;
  END IF;

  RETURN _branch_id IS NULL OR _branch_id = _pinned;
END;
$$;

-- 2. Update auto_stamp_branch_id trigger to prefer the user's pinned branch
CREATE OR REPLACE FUNCTION public.auto_stamp_branch_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _pinned uuid;
BEGIN
  IF NEW.restaurant_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.branch_id IS NULL THEN
    -- Prefer the calling user's pinned branch when available
    _pinned := public.user_pinned_branch_id(auth.uid(), NEW.restaurant_id);
    IF _pinned IS NOT NULL THEN
      NEW.branch_id := _pinned;
    ELSE
      NEW.branch_id := public.get_primary_branch_id(NEW.restaurant_id);
    END IF;
  ELSE
    -- Validate branch belongs to the restaurant
    IF NOT EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = NEW.branch_id
        AND b.restaurant_id = NEW.restaurant_id
        AND b.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Branch % does not belong to restaurant %',
        NEW.branch_id, NEW.restaurant_id;
    END IF;

    -- Block pinned users from writing to other branches
    IF auth.uid() IS NOT NULL
       AND NOT public.user_can_access_branch(auth.uid(), NEW.restaurant_id, NEW.branch_id) THEN
      RAISE EXCEPTION 'User % is not allowed to write to branch %',
        auth.uid(), NEW.branch_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Apply restrictive branch-pin policies to operational tables
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'sales_transactions','sales_items','shifts','cash_events','drawers',
    'expenses','inventory_items','purchases','purchase_invoices',
    'staff_advances','pos_terminals'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "Branch pin restriction" ON public.%I',
      tbl
    );
    EXECUTE format($p$
      CREATE POLICY "Branch pin restriction" ON public.%I
        AS RESTRICTIVE
        FOR ALL
        TO authenticated
        USING (
          branch_id IS NULL
          OR public.user_can_access_branch(auth.uid(), restaurant_id, branch_id)
        )
        WITH CHECK (
          branch_id IS NULL
          OR public.user_can_access_branch(auth.uid(), restaurant_id, branch_id)
        )
    $p$, tbl);
  END LOOP;
END $$;