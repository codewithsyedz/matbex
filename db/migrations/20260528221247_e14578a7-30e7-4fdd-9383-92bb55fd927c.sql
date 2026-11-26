-- Track every status change on pos_tables for timeline/turn-time analytics
CREATE TABLE public.pos_table_status_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  restaurant_id UUID,
  branch_id UUID,
  table_id UUID NOT NULL REFERENCES public.pos_tables(id) ON DELETE CASCADE,
  floor_plan_id UUID,
  from_status TEXT,
  to_status TEXT NOT NULL,
  guest_count INTEGER,
  server_id UUID,
  changed_by UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.pos_table_status_events TO authenticated;
GRANT ALL ON public.pos_table_status_events TO service_role;

ALTER TABLE public.pos_table_status_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view table status events"
ON public.pos_table_status_events
FOR SELECT
TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant members can insert table status events"
ON public.pos_table_status_events
FOR INSERT
TO authenticated
WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE INDEX idx_pos_table_status_events_tenant_time
  ON public.pos_table_status_events (tenant_id, occurred_at DESC);
CREATE INDEX idx_pos_table_status_events_table_time
  ON public.pos_table_status_events (table_id, occurred_at DESC);

-- Trigger: log every status change automatically
CREATE OR REPLACE FUNCTION public.log_pos_table_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.pos_table_status_events
      (tenant_id, restaurant_id, branch_id, table_id, floor_plan_id,
       from_status, to_status, guest_count, server_id, changed_by, occurred_at)
    VALUES
      (NEW.tenant_id, NEW.restaurant_id, NEW.branch_id, NEW.id, NEW.floor_plan_id,
       NULL, COALESCE(NEW.status, 'free'), NEW.guest_count, NEW.server_id, auth.uid(), now());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.pos_table_status_events
      (tenant_id, restaurant_id, branch_id, table_id, floor_plan_id,
       from_status, to_status, guest_count, server_id, changed_by, occurred_at)
    VALUES
      (NEW.tenant_id, NEW.restaurant_id, NEW.branch_id, NEW.id, NEW.floor_plan_id,
       OLD.status, NEW.status, NEW.guest_count, NEW.server_id, auth.uid(), now());
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_pos_table_status_change ON public.pos_tables;
CREATE TRIGGER trg_log_pos_table_status_change
AFTER INSERT OR UPDATE OF status ON public.pos_tables
FOR EACH ROW
EXECUTE FUNCTION public.log_pos_table_status_change();