
alter table public.zatca_certification_reports
  add column if not exists verification_token uuid not null default gen_random_uuid(),
  add column if not exists snapshot jsonb;

create unique index if not exists idx_zatca_cert_reports_verification_token
  on public.zatca_certification_reports (verification_token);

create or replace function public.get_zatca_certification_snapshot(_token uuid)
returns table (
  id uuid,
  file_name text,
  completed_steps integer,
  total_steps integer,
  certified boolean,
  created_at timestamptz,
  snapshot jsonb,
  tenant_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.file_name,
    r.completed_steps,
    r.total_steps,
    r.certified,
    r.created_at,
    r.snapshot,
    t.name as tenant_name
  from public.zatca_certification_reports r
  left join public.tenants t on t.id = r.tenant_id
  where r.verification_token = _token
  limit 1;
$$;

grant execute on function public.get_zatca_certification_snapshot(uuid) to anon, authenticated;
