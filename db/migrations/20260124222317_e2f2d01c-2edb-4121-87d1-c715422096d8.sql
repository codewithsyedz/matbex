-- Create storage bucket for menu images
INSERT INTO storage.buckets (id, name, public)
VALUES ('menu-images', 'menu-images', true)
ON CONFLICT (id) DO NOTHING;

-- Create policy for public read access
CREATE POLICY "Menu images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'menu-images');

-- Create policy for authenticated users to upload
CREATE POLICY "Authenticated users can upload menu images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'menu-images' AND auth.role() = 'authenticated');

-- Create policy for authenticated users to update their uploads
CREATE POLICY "Authenticated users can update menu images"
ON storage.objects FOR UPDATE
USING (bucket_id = 'menu-images' AND auth.role() = 'authenticated');

-- Create policy for authenticated users to delete menu images
CREATE POLICY "Authenticated users can delete menu images"
ON storage.objects FOR DELETE
USING (bucket_id = 'menu-images' AND auth.role() = 'authenticated');