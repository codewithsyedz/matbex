-- Create table for footer link settings
CREATE TABLE public.footer_link_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_key TEXT NOT NULL UNIQUE,
  link_label TEXT NOT NULL,
  link_href TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('product', 'company', 'resources', 'legal')),
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.footer_link_settings ENABLE ROW LEVEL SECURITY;

-- Allow public read access (for landing page)
CREATE POLICY "Anyone can view enabled footer links"
ON public.footer_link_settings
FOR SELECT
USING (true);

-- SuperAdmins can manage footer links (using superadmin_users table)
CREATE POLICY "SuperAdmins can manage footer links"
ON public.footer_link_settings
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.superadmin_users
    WHERE user_id = auth.uid()
  )
);

-- Insert default footer links
INSERT INTO public.footer_link_settings (link_key, link_label, link_href, category, sort_order, is_enabled) VALUES
-- Product
('features', 'Features', '/#features', 'product', 1, true),
('pricing', 'Pricing', '/#pricing', 'product', 2, true),
('investment-tiers', 'Investment Tiers', '/investment-tiers', 'product', 3, true),
('integrations', 'Integrations', '/integrations', 'product', 4, true),
('api', 'API', '/api', 'product', 5, true),
-- Company
('about', 'About', '/about', 'company', 1, true),
('blog', 'Blog', '/blog', 'company', 2, true),
('careers', 'Careers', '/careers', 'company', 3, true),
('press', 'Press', '/press', 'company', 4, true),
-- Resources
('documentation', 'Documentation', '/docs', 'resources', 1, true),
('help-center', 'Help Center', '/help', 'resources', 2, true),
('community', 'Community', '/community', 'resources', 3, true),
('status', 'Status', '/status', 'resources', 4, true),
-- Legal
('privacy', 'Privacy', '/privacy', 'legal', 1, true),
('terms', 'Terms', '/terms', 'legal', 2, true),
('security', 'Security', '/security', 'legal', 3, true),
('cookies', 'Cookies', '/cookies', 'legal', 4, true);

-- Create trigger for updated_at
CREATE TRIGGER update_footer_link_settings_updated_at
BEFORE UPDATE ON public.footer_link_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();