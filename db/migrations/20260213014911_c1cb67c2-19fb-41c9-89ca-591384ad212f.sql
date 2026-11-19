
-- Create a public storage bucket for press/brand assets
INSERT INTO storage.buckets (id, name, public) 
VALUES ('press-assets', 'press-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access
CREATE POLICY "Public can read press assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'press-assets');

-- Allow authenticated admins to upload
CREATE POLICY "Admins can upload press assets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'press-assets' AND auth.role() = 'authenticated');

-- Allow authenticated admins to update
CREATE POLICY "Admins can update press assets"
ON storage.objects FOR UPDATE
USING (bucket_id = 'press-assets' AND auth.role() = 'authenticated');

-- Allow authenticated admins to delete
CREATE POLICY "Admins can delete press assets"
ON storage.objects FOR DELETE
USING (bucket_id = 'press-assets' AND auth.role() = 'authenticated');
