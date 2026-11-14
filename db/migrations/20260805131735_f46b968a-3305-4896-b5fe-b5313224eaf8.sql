
create policy "compliance_evidence_read" on storage.objects for select to authenticated
using (bucket_id = 'compliance-evidence' and public.can_access_restaurant(((storage.foldername(name))[1])::uuid));

create policy "compliance_evidence_insert" on storage.objects for insert to authenticated
with check (bucket_id = 'compliance-evidence' and public.can_access_restaurant(((storage.foldername(name))[1])::uuid));

create policy "compliance_evidence_update" on storage.objects for update to authenticated
using (bucket_id = 'compliance-evidence' and public.can_access_restaurant(((storage.foldername(name))[1])::uuid));

create policy "compliance_evidence_delete" on storage.objects for delete to authenticated
using (bucket_id = 'compliance-evidence' and public.can_access_restaurant(((storage.foldername(name))[1])::uuid));
