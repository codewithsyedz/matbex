
INSERT INTO storage.buckets (id, name, public)
VALUES ('zatca-receipts', 'zatca-receipts', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "zatca_receipts_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'zatca-receipts'
    AND public.user_belongs_to_restaurant(
      auth.uid(),
      ((storage.foldername(name))[1])::uuid
    )
  );

CREATE POLICY "zatca_receipts_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'zatca-receipts'
    AND public.user_belongs_to_restaurant(
      auth.uid(),
      ((storage.foldername(name))[1])::uuid
    )
  );
