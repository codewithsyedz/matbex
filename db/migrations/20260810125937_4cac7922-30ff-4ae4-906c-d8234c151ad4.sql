CREATE TABLE public.project_posting_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  performed_by uuid,
  performed_at timestamptz not null default now(),
  scope text not null default 'filter',
  category text,
  date_from date,
  date_to date,
  shift text,
  txn_ids uuid[] not null default '{}',
  txn_count integer not null default 0,
  failed_count integer not null default 0,
  total_amount numeric not null default 0,
  note text,
  created_at timestamptz not null default now()
);

CREATE INDEX idx_project_posting_runs_project ON public.project_posting_runs(project_id, performed_at DESC);

GRANT SELECT, INSERT ON public.project_posting_runs TO authenticated;
GRANT ALL ON public.project_posting_runs TO service_role;

ALTER TABLE public.project_posting_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members view project posting runs"
ON public.project_posting_runs FOR SELECT TO authenticated
USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Tenant members log project posting runs"
ON public.project_posting_runs FOR INSERT TO authenticated
WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND performed_by = auth.uid());