-- Create storage bucket for tenant assets (hero images, etc.)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('tenant-assets', 'tenant-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their tenant folder
CREATE POLICY "Authenticated users can upload tenant assets"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'tenant-assets' 
  AND auth.role() = 'authenticated'
);

-- Allow public read access to tenant assets
CREATE POLICY "Public read access for tenant assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'tenant-assets');

-- Allow users to update their own tenant assets
CREATE POLICY "Users can update tenant assets"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'tenant-assets' 
  AND auth.role() = 'authenticated'
);

-- Allow users to delete their own tenant assets
CREATE POLICY "Users can delete tenant assets"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'tenant-assets' 
  AND auth.role() = 'authenticated'
);