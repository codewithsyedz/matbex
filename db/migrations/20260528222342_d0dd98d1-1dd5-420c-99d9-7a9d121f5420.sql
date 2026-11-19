-- Audit log for floor-plan layout edits (status changes are already tracked in pos_table_status_events)
CREATE TABLE public.pos_floor_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  restaurant_id UUID,
  branch_id UUID,
  floor_plan_id UUID,
  table_id UUID,
  entity_type TEXT NOT NULL,        -- 'floor_plan' | 'table'
  action TEXT NOT NULL,             -- 'create' | 'move' | 'resize' | 'reshape' | 'rename' | 'recapacity' | 'rotate' | 'delete' | 'restore' | 'update'
  label TEXT,                       -- snapshot of the table/floor label at time of change
  changes JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { field: { from, to } }
  changed_by UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.pos_floor_audit_log TO authenticated;
GRANT ALL ON public.pos_floor_audit_log TO service_role;

ALTER TABLE public.pos_floor_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view floor audit log"
ON public.pos_floor_audit_log
FOR SELECT
TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant members can insert floor audit log"
ON public.pos_floor_audit_log
FOR INSERT
TO authenticated
WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE INDEX idx_pos_floor_audit_tenant_time ON public.pos_floor_audit_log (tenant_id, occurred_at DESC);
CREATE INDEX idx_pos_floor_audit_floor_time ON public.pos_floor_audit_log (floor_plan_id, occurred_at DESC);
CREATE INDEX idx_pos_floor_audit_table_time ON public.pos_floor_audit_log (table_id, occurred_at DESC);

-- Trigger function for pos_tables layout changes
CREATE OR REPLACE FUNCTION public.log_pos_table_layout_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changes JSONB := '{}'::jsonb;
  v_action TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.pos_floor_audit_log
      (tenant_id, restaurant_id, branch_id, floor_plan_id, table_id, entity_type, action, label, changes, changed_by)
    VALUES
      (NEW.tenant_id, NEW.restaurant_id, NEW.branch_id, NEW.floor_plan_id, NEW.id, 'table', 'create',
       NEW.label,
       jsonb_build_object(
         'label', NEW.label, 'capacity', NEW.capacity, 'shape', NEW.shape,
         'x', NEW.x, 'y', NEW.y, 'width', NEW.width, 'height', NEW.height
       ),
       auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Soft delete / restore
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      v_action := CASE WHEN NEW.deleted_at IS NOT NULL THEN 'delete' ELSE 'restore' END;
      INSERT INTO public.pos_floor_audit_log
        (tenant_id, restaurant_id, branch_id, floor_plan_id, table_id, entity_type, action, label, changes, changed_by)
      VALUES
        (NEW.tenant_id, NEW.restaurant_id, NEW.branch_id, NEW.floor_plan_id, NEW.id, 'table', v_action,
         NEW.label, '{}'::jsonb, auth.uid());
      RETURN NEW;
    END IF;

    IF NEW.x IS DISTINCT FROM OLD.x OR NEW.y IS DISTINCT FROM OLD.y THEN
      v_changes := v_changes || jsonb_build_object(
        'x', jsonb_build_object('from', OLD.x, 'to', NEW.x),
        'y', jsonb_build_object('from', OLD.y, 'to', NEW.y)
      );
      v_action := 'move';
    END IF;
    IF NEW.width IS DISTINCT FROM OLD.width OR NEW.height IS DISTINCT FROM OLD.height THEN
      v_changes := v_changes || jsonb_build_object(
        'width', jsonb_build_object('from', OLD.width, 'to', NEW.width),
        'height', jsonb_build_object('from', OLD.height, 'to', NEW.height)
      );
      v_action := COALESCE(v_action, 'resize');
    END IF;
    IF NEW.shape IS DISTINCT FROM OLD.shape THEN
      v_changes := v_changes || jsonb_build_object('shape', jsonb_build_object('from', OLD.shape, 'to', NEW.shape));
      v_action := 'reshape';
    END IF;
    IF NEW.rotation IS DISTINCT FROM OLD.rotation THEN
      v_changes := v_changes || jsonb_build_object('rotation', jsonb_build_object('from', OLD.rotation, 'to', NEW.rotation));
      v_action := COALESCE(v_action, 'rotate');
    END IF;
    IF NEW.label IS DISTINCT FROM OLD.label THEN
      v_changes := v_changes || jsonb_build_object('label', jsonb_build_object('from', OLD.label, 'to', NEW.label));
      v_action := 'rename';
    END IF;
    IF NEW.capacity IS DISTINCT FROM OLD.capacity THEN
      v_changes := v_changes || jsonb_build_object('capacity', jsonb_build_object('from', OLD.capacity, 'to', NEW.capacity));
      v_action := COALESCE(v_action, 'recapacity');
    END IF;
    IF NEW.floor_plan_id IS DISTINCT FROM OLD.floor_plan_id THEN
      v_changes := v_changes || jsonb_build_object('floor_plan_id', jsonb_build_object('from', OLD.floor_plan_id, 'to', NEW.floor_plan_id));
      v_action := COALESCE(v_action, 'update');
    END IF;

    IF v_changes <> '{}'::jsonb THEN
      INSERT INTO public.pos_floor_audit_log
        (tenant_id, restaurant_id, branch_id, floor_plan_id, table_id, entity_type, action, label, changes, changed_by)
      VALUES
        (NEW.tenant_id, NEW.restaurant_id, NEW.branch_id, NEW.floor_plan_id, NEW.id, 'table', v_action,
         NEW.label, v_changes, auth.uid());
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_pos_table_layout_change ON public.pos_tables;
CREATE TRIGGER trg_log_pos_table_layout_change
AFTER INSERT OR UPDATE ON public.pos_tables
FOR EACH ROW
EXECUTE FUNCTION public.log_pos_table_layout_change();

-- Trigger function for pos_floor_plans changes
CREATE OR REPLACE FUNCTION public.log_pos_floor_plan_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changes JSONB := '{}'::jsonb;
  v_action TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.pos_floor_audit_log
      (tenant_id, restaurant_id, branch_id, floor_plan_id, entity_type, action, label, changes, changed_by)
    VALUES
      (NEW.tenant_id, NEW.restaurant_id, NEW.branch_id, NEW.id, 'floor_plan', 'create',
       NEW.name,
       jsonb_build_object('name', NEW.name, 'width', NEW.width, 'height', NEW.height, 'is_default', NEW.is_default),
       auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      v_action := CASE WHEN NEW.deleted_at IS NOT NULL THEN 'delete' ELSE 'restore' END;
      INSERT INTO public.pos_floor_audit_log
        (tenant_id, restaurant_id, branch_id, floor_plan_id, entity_type, action, label, changes, changed_by)
      VALUES
        (NEW.tenant_id, NEW.restaurant_id, NEW.branch_id, NEW.id, 'floor_plan', v_action,
         NEW.name, '{}'::jsonb, auth.uid());
      RETURN NEW;
    END IF;
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('from', OLD.name, 'to', NEW.name));
      v_action := 'rename';
    END IF;
    IF NEW.width IS DISTINCT FROM OLD.width OR NEW.height IS DISTINCT FROM OLD.height THEN
      v_changes := v_changes || jsonb_build_object(
        'width', jsonb_build_object('from', OLD.width, 'to', NEW.width),
        'height', jsonb_build_object('from', OLD.height, 'to', NEW.height)
      );
      v_action := COALESCE(v_action, 'resize');
    END IF;
    IF NEW.is_default IS DISTINCT FROM OLD.is_default THEN
      v_changes := v_changes || jsonb_build_object('is_default', jsonb_build_object('from', OLD.is_default, 'to', NEW.is_default));
      v_action := COALESCE(v_action, 'update');
    END IF;
    IF v_changes <> '{}'::jsonb THEN
      INSERT INTO public.pos_floor_audit_log
        (tenant_id, restaurant_id, branch_id, floor_plan_id, entity_type, action, label, changes, changed_by)
      VALUES
        (NEW.tenant_id, NEW.restaurant_id, NEW.branch_id, NEW.id, 'floor_plan', v_action,
         NEW.name, v_changes, auth.uid());
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_pos_floor_plan_change ON public.pos_floor_plans;
CREATE TRIGGER trg_log_pos_floor_plan_change
AFTER INSERT OR UPDATE ON public.pos_floor_plans
FOR EACH ROW
EXECUTE FUNCTION public.log_pos_floor_plan_change();