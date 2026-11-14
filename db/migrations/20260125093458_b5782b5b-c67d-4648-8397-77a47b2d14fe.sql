-- =====================================================
-- Fix Storage Bucket Security Policies
-- This migration restricts storage access to proper tenant/user scoping
-- =====================================================

-- =====================================================
-- 1. EXPENSE-RECEIPTS BUCKET
-- Structure: ${restaurantId}/${filename}
-- Fix: Make private, scope to users who belong to the restaurant
-- =====================================================

-- Make bucket private (don't expose URLs publicly)
UPDATE storage.buckets SET public = false WHERE id = 'expense-receipts';

-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Users can upload expense receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can view expense receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can update expense receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete expense receipts" ON storage.objects;
DROP POLICY IF EXISTS "Public can view expense receipts" ON storage.objects;

-- Create properly scoped policies using restaurant_id from folder path
CREATE POLICY "Users can upload receipts to their restaurant"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'expense-receipts' 
  AND auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.restaurant_id::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY "Users can view receipts from their restaurant"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'expense-receipts' 
  AND (
    -- SuperAdmins can view all
    public.is_superadmin(auth.uid())
    OR
    -- Users can view their restaurant's receipts
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.restaurant_id::text = (storage.foldername(name))[1]
    )
  )
);

CREATE POLICY "Managers can update receipts in their restaurant"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'expense-receipts' 
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.restaurant_id::text = (storage.foldername(name))[1]
    AND ur.role IN ('owner', 'manager')
  )
);

CREATE POLICY "Managers can delete receipts in their restaurant"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'expense-receipts' 
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.restaurant_id::text = (storage.foldername(name))[1]
    AND ur.role IN ('owner', 'manager')
  )
);

-- =====================================================
-- 2. CHAT-ATTACHMENTS BUCKET  
-- Structure: ${userId}/${filename}
-- Fix: Scope to channel/conversation membership
-- =====================================================

-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Users can view chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own chat attachments" ON storage.objects;

-- Users can only upload to their own folder
CREATE POLICY "Users can upload chat attachments to their folder"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'chat-attachments' 
  AND auth.uid() IS NOT NULL
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can view attachments if:
-- 1. It's their own upload OR
-- 2. They are a member of the same restaurant as the uploader
CREATE POLICY "Users can view chat attachments in their restaurant"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'chat-attachments' 
  AND (
    -- SuperAdmins can view all
    public.is_superadmin(auth.uid())
    OR
    -- Users can view their own uploads
    auth.uid()::text = (storage.foldername(name))[1]
    OR
    -- Users can view attachments from their restaurant members
    EXISTS (
      SELECT 1 FROM public.user_roles ur1
      JOIN public.user_roles ur2 ON ur1.restaurant_id = ur2.restaurant_id
      WHERE ur1.user_id = auth.uid()
      AND ur2.user_id::text = (storage.foldername(name))[1]
    )
  )
);

-- Users can only delete their own uploads
CREATE POLICY "Users can delete their own chat attachments"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'chat-attachments' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- =====================================================
-- 3. MENU-IMAGES BUCKET
-- Structure: ${restaurantId}/${filename}
-- Fix: Public read is OK for menus, but write should be restaurant-scoped
-- =====================================================

-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Menu images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload menu images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update menu images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete menu images" ON storage.objects;

-- Public read is acceptable for menu images (customers view menus)
CREATE POLICY "Menu images are publicly viewable"
ON storage.objects FOR SELECT
USING (bucket_id = 'menu-images');

-- Only restaurant members can upload menu images
CREATE POLICY "Restaurant staff can upload menu images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'menu-images' 
  AND auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.restaurant_id::text = (storage.foldername(name))[1]
    AND ur.role IN ('owner', 'manager')
  )
);

-- Only managers/owners can update menu images
CREATE POLICY "Restaurant managers can update menu images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'menu-images' 
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.restaurant_id::text = (storage.foldername(name))[1]
    AND ur.role IN ('owner', 'manager')
  )
);

-- Only managers/owners can delete menu images
CREATE POLICY "Restaurant managers can delete menu images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'menu-images' 
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.restaurant_id::text = (storage.foldername(name))[1]
    AND ur.role IN ('owner', 'manager')
  )
);