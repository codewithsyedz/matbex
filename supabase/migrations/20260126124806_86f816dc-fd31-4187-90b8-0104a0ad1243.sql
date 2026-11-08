-- Create storage bucket for restaurant logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('restaurant-logos', 'restaurant-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for restaurant logos
CREATE POLICY "Public can view restaurant logos"
ON storage.objects FOR SELECT
USING (bucket_id = 'restaurant-logos');

CREATE POLICY "Authenticated users can upload logos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'restaurant-logos');

CREATE POLICY "Users can update their restaurant logos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'restaurant-logos');

CREATE POLICY "Users can delete their restaurant logos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'restaurant-logos');

-- Create restaurant branding table
CREATE TABLE public.restaurant_branding (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  logo_url TEXT,
  favicon_url TEXT,
  business_display_name TEXT,
  tagline TEXT,
  primary_color TEXT DEFAULT '#10B981',
  secondary_color TEXT DEFAULT '#059669',
  accent_color TEXT DEFAULT '#34D399',
  background_color TEXT DEFAULT '#FFFFFF',
  text_color TEXT DEFAULT '#1F2937',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id)
);

-- Enable RLS
ALTER TABLE public.restaurant_branding ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view branding for their tenant restaurants"
ON public.restaurant_branding FOR SELECT
TO authenticated
USING (
  tenant_id IN (
    SELECT tenant_id FROM public.user_tenant_roles 
    WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Owners can manage branding"
ON public.restaurant_branding FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_tenant_roles
    WHERE user_id = auth.uid()
    AND tenant_id = restaurant_branding.tenant_id
    AND role = 'owner'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_tenant_roles
    WHERE user_id = auth.uid()
    AND tenant_id = restaurant_branding.tenant_id
    AND role = 'owner'
  )
);

-- Public read for customer-facing pages (e.g., QR menus)
CREATE POLICY "Public can view branding for public pages"
ON public.restaurant_branding FOR SELECT
TO anon
USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_restaurant_branding_updated_at
BEFORE UPDATE ON public.restaurant_branding
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();