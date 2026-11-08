CREATE POLICY "report_exports_insert_own_restaurant"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'report-exports'
  AND public.can_access_restaurant(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "report_exports_select_own_restaurant"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'report-exports'
  AND public.can_access_restaurant(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "report_exports_delete_own_restaurant"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'report-exports'
  AND public.can_access_restaurant(((storage.foldername(name))[1])::uuid)
);