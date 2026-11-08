DROP TRIGGER IF EXISTS trg_audit_project_partners ON public.project_partners;
CREATE TRIGGER trg_audit_project_partners
AFTER INSERT OR UPDATE OR DELETE ON public.project_partners
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_created
  ON public.audit_logs (entity_type, entity_id, created_at DESC);