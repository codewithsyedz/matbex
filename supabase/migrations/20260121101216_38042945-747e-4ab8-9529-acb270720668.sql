-- Add RLS policies for expense-receipts bucket (if they don't exist)

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can upload expense receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can view expense receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete expense receipts" ON storage.objects;
DROP POLICY IF EXISTS "Public can view expense receipts" ON storage.objects;

-- Allow authenticated users to upload receipts
CREATE POLICY "Users can upload expense receipts"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'expense-receipts');

-- Allow authenticated users to view expense receipts
CREATE POLICY "Users can view expense receipts"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'expense-receipts');

-- Allow authenticated users to delete their receipts
CREATE POLICY "Users can delete expense receipts"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'expense-receipts');

-- Allow public read access since bucket is public
CREATE POLICY "Public can view expense receipts"
ON storage.objects
FOR SELECT
TO anon
USING (bucket_id = 'expense-receipts');