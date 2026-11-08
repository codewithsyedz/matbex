
CREATE TABLE public.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  name text NOT NULL,
  code text,
  address text,
  phone text,
  timezone text,
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_branches_restaurant ON public.branches(restaurant_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uniq_branches_primary_per_tenant
  ON public.branches(restaurant_id) WHERE is_primary = true AND deleted_at IS NULL;
CREATE UNIQUE INDEX uniq_branches_code_per_tenant
  ON public.branches(restaurant_id, lower(code)) WHERE code IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER trg_branches_updated_at
  BEFORE UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.branches (restaurant_id, name, code, is_primary, timezone)
SELECT r.id, 'Main Branch', 'MAIN', true, COALESCE(r.timezone, 'Asia/Riyadh')
FROM public.restaurants r;

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view branches"
  ON public.branches FOR SELECT
  USING (public.can_access_restaurant(restaurant_id));

CREATE POLICY "Owners/Managers can insert branches"
  ON public.branches FOR INSERT
  WITH CHECK (
    public.can_access_restaurant(restaurant_id)
    AND (
      public.has_role(auth.uid(), restaurant_id, 'owner'::public.app_role)
      OR public.has_role(auth.uid(), restaurant_id, 'manager'::public.app_role)
    )
  );

CREATE POLICY "Owners/Managers can update branches"
  ON public.branches FOR UPDATE
  USING (
    public.can_access_restaurant(restaurant_id)
    AND (
      public.has_role(auth.uid(), restaurant_id, 'owner'::public.app_role)
      OR public.has_role(auth.uid(), restaurant_id, 'manager'::public.app_role)
    )
  );

CREATE OR REPLACE FUNCTION public.protect_primary_branch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL AND OLD.is_primary = true THEN
    RAISE EXCEPTION 'Cannot delete the primary branch';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_primary = true AND NEW.is_primary = false THEN
    RAISE EXCEPTION 'Cannot unset the primary branch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_primary_branch
  BEFORE UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.protect_primary_branch();

CREATE OR REPLACE FUNCTION public.can_access_branch(_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = _branch_id
      AND b.deleted_at IS NULL
      AND public.can_access_restaurant(b.restaurant_id)
  );
$$;
