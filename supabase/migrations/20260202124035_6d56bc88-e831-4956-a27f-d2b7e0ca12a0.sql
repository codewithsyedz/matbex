-- Create table for CMS pages with page builder architecture
CREATE TABLE public.cms_pages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  meta_title TEXT,
  meta_description TEXT,
  is_published BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table for page blocks (sections)
CREATE TABLE public.cms_page_blocks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  page_id UUID NOT NULL REFERENCES public.cms_pages(id) ON DELETE CASCADE,
  block_type TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_visible BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cms_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_page_blocks ENABLE ROW LEVEL SECURITY;

-- Public read access for published pages
CREATE POLICY "Anyone can view published pages" 
ON public.cms_pages 
FOR SELECT 
USING (is_published = true);

CREATE POLICY "Anyone can view blocks of published pages"
ON public.cms_page_blocks
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.cms_pages 
    WHERE id = page_id AND is_published = true
  )
);

-- SuperAdmin full access (using superadmin_users table)
CREATE POLICY "SuperAdmins can manage pages"
ON public.cms_pages
FOR ALL
USING (
  EXISTS (SELECT 1 FROM public.superadmin_users WHERE user_id = auth.uid())
);

CREATE POLICY "SuperAdmins can manage blocks"
ON public.cms_page_blocks
FOR ALL
USING (
  EXISTS (SELECT 1 FROM public.superadmin_users WHERE user_id = auth.uid())
);

-- Create indexes
CREATE INDEX idx_cms_pages_slug ON public.cms_pages(slug);
CREATE INDEX idx_cms_page_blocks_page_id ON public.cms_page_blocks(page_id);
CREATE INDEX idx_cms_page_blocks_sort_order ON public.cms_page_blocks(sort_order);

-- Trigger for updated_at
CREATE TRIGGER update_cms_pages_updated_at
  BEFORE UPDATE ON public.cms_pages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_cms_page_blocks_updated_at
  BEFORE UPDATE ON public.cms_page_blocks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default pages for all footer links
INSERT INTO public.cms_pages (slug, title, meta_title, meta_description) VALUES
-- Product
('investment-tiers', 'Investment Tiers', 'Investment Tiers | Matbex', 'Explore our enterprise plans and strategic partnership options'),
('integrations', 'Integrations', 'Integrations | Matbex', 'Connect with your favorite tools and services'),
('api', 'API', 'API Documentation | Matbex', 'Developer documentation for the Matbex API'),
-- Company
('about', 'About', 'About Us | Matbex', 'Learn about our mission and team'),
('careers', 'Careers', 'Careers | Matbex', 'Join our growing team'),
('blog', 'Blog', 'Blog | Matbex', 'Latest updates and insights'),
('press', 'Press', 'Press | Matbex', 'Press resources and media kit'),
-- Resources
('documentation', 'Documentation', 'Documentation | Matbex', 'Complete guides and tutorials'),
('help-center', 'Help Center', 'Help Center | Matbex', 'Get help with Matbex'),
('community', 'Community', 'Community | Matbex', 'Join our community'),
('status', 'Status', 'System Status | Matbex', 'Current system status and uptime'),
-- Legal
('privacy-policy', 'Privacy Policy', 'Privacy Policy | Matbex', 'How we handle your data'),
('terms-of-service', 'Terms of Service', 'Terms of Service | Matbex', 'Terms and conditions'),
('security', 'Security', 'Security | Matbex', 'Our security practices'),
('cookies', 'Cookies', 'Cookie Policy | Matbex', 'Cookie policy and preferences');