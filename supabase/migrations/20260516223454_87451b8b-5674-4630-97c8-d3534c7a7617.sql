
-- Bucket
insert into storage.buckets (id, name, public)
values ('zatca-certification-reports', 'zatca-certification-reports', false)
on conflict (id) do nothing;

-- Table
create table if not exists public.zatca_certification_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  storage_path text not null unique,
  file_name text not null,
  file_size_bytes integer,
  completed_steps integer not null default 0,
  total_steps integer not null default 0,
  certified boolean not null default false,
  generated_by uuid,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_zatca_cert_reports_tenant_created
  on public.zatca_certification_reports (tenant_id, created_at desc);

alter table public.zatca_certification_reports enable row level security;

create policy "Tenant members read certification reports"
  on public.zatca_certification_reports for select
  using (tenant_id = public.get_user_tenant_id(auth.uid()));

create policy "Tenant members insert certification reports"
  on public.zatca_certification_reports for insert
  with check (
    tenant_id = public.get_user_tenant_id(auth.uid())
    and generated_by = auth.uid()
  );

create policy "Owners and managers delete certification reports"
  on public.zatca_certification_reports for delete
  using (
    tenant_id = public.get_user_tenant_id(auth.uid())
    and (public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
         or public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role))
  );

-- Storage policies (path = "{tenant_id}/...")
create policy "zatca_cert_reports_read"
  on storage.objects for select
  using (
    bucket_id = 'zatca-certification-reports'
    and public.user_belongs_to_restaurant(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

create policy "zatca_cert_reports_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'zatca-certification-reports'
    and public.user_belongs_to_restaurant(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

create policy "zatca_cert_reports_delete"
  on storage.objects for delete
  using (
    bucket_id = 'zatca-certification-reports'
    and (
      public.has_tenant_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'owner'::app_role)
      or public.has_tenant_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'manager'::app_role)
    )
  );
