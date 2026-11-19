
CREATE POLICY "Members view fine evidence" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'fine-evidence'
  AND EXISTS (
    SELECT 1 FROM public.restaurants r
    WHERE r.id::text = (storage.foldername(name))[1]
      AND public.user_belongs_to_restaurant(auth.uid(), r.id)
  )
);

CREATE POLICY "Managers upload fine evidence" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'fine-evidence'
  AND EXISTS (
    SELECT 1 FROM public.restaurants r
    WHERE r.id::text = (storage.foldername(name))[1]
      AND (public.has_role(auth.uid(), r.id, 'owner'::app_role) OR public.has_role(auth.uid(), r.id, 'manager'::app_role))
  )
);

CREATE POLICY "Managers update fine evidence" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'fine-evidence'
  AND EXISTS (
    SELECT 1 FROM public.restaurants r
    WHERE r.id::text = (storage.foldername(name))[1]
      AND (public.has_role(auth.uid(), r.id, 'owner'::app_role) OR public.has_role(auth.uid(), r.id, 'manager'::app_role))
  )
);

CREATE POLICY "Managers delete fine evidence" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'fine-evidence'
  AND EXISTS (
    SELECT 1 FROM public.restaurants r
    WHERE r.id::text = (storage.foldername(name))[1]
      AND (public.has_role(auth.uid(), r.id, 'owner'::app_role) OR public.has_role(auth.uid(), r.id, 'manager'::app_role))
  )
);
