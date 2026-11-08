
INSERT INTO storage.buckets (id, name, public)
VALUES ('zatca-xml', 'zatca-xml', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "zatca_xml_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'zatca-xml'
    AND public.user_belongs_to_restaurant(
      auth.uid(),
      ((storage.foldername(name))[1])::uuid
    )
  );

CREATE POLICY "zatca_xml_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'zatca-xml'
    AND public.user_belongs_to_restaurant(
      auth.uid(),
      ((storage.foldername(name))[1])::uuid
    )
  );
