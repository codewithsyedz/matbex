-- Add image_url column to purchase_invoices table
ALTER TABLE public.purchase_invoices 
ADD COLUMN image_url TEXT;

-- Create storage bucket for invoice images
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoice-images', 'invoice-images', false)
ON CONFLICT (id) DO NOTHING;

-- Create RLS policies for invoice-images bucket
CREATE POLICY "Users can view invoice images from their restaurant"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'invoice-images' 
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() 
    AND (ur.restaurant_id)::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY "Users can upload invoice images to their restaurant"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'invoice-images' 
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() 
    AND (ur.restaurant_id)::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY "Managers can update invoice images in their restaurant"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'invoice-images' 
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() 
    AND (ur.restaurant_id)::text = (storage.foldername(name))[1]
    AND ur.role = ANY (ARRAY['owner'::app_role, 'manager'::app_role])
  )
);

CREATE POLICY "Managers can delete invoice images from their restaurant"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'invoice-images' 
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() 
    AND (ur.restaurant_id)::text = (storage.foldername(name))[1]
    AND ur.role = ANY (ARRAY['owner'::app_role, 'manager'::app_role])
  )
);