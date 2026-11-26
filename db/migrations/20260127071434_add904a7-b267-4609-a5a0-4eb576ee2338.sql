-- Create tenant_domains table for subdomain/custom domain management
CREATE TABLE public.tenant_domains (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subdomain TEXT UNIQUE,
  custom_domain TEXT UNIQUE,
  domain_status TEXT NOT NULL DEFAULT 'pending' CHECK (domain_status IN ('pending', 'verifying', 'active', 'failed', 'offline')),
  ssl_status TEXT DEFAULT 'pending' CHECK (ssl_status IN ('pending', 'provisioning', 'active', 'failed')),
  verification_token TEXT,
  dns_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create tenant_pages table for storing page content
CREATE TABLE public.tenant_pages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
  page_type TEXT NOT NULL DEFAULT 'landing' CHECK (page_type IN ('landing', 'menu', 'about', 'contact')),
  title TEXT,
  meta_description TEXT,
  og_image_url TEXT,
  theme TEXT DEFAULT 'urban-cafe' CHECK (theme IN ('fine-diner', 'urban-cafe', 'rustic-bistro', 'modern-minimal', 'vibrant-street')),
  hero_image_url TEXT,
  hero_title TEXT,
  hero_subtitle TEXT,
  show_menu_sync BOOLEAN DEFAULT true,
  show_hours BOOLEAN DEFAULT true,
  show_location BOOLEAN DEFAULT true,
  custom_css TEXT,
  is_published BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, restaurant_id, page_type)
);

-- Create tenant_page_blocks table for block-based content (Phase 3 prep)
CREATE TABLE public.tenant_page_blocks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  page_id UUID NOT NULL REFERENCES public.tenant_pages(id) ON DELETE CASCADE,
  block_type TEXT NOT NULL CHECK (block_type IN ('hero', 'menu', 'hours', 'location', 'gallery', 'testimonials', 'cta', 'custom')),
  block_order INTEGER NOT NULL DEFAULT 0,
  content JSONB DEFAULT '{}',
  is_visible BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.tenant_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_page_blocks ENABLE ROW LEVEL SECURITY;

-- RLS Policies for tenant_domains
CREATE POLICY "Users can view their tenant domains"
  ON public.tenant_domains FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM public.user_tenant_roles WHERE user_id = auth.uid()
  ));

CREATE POLICY "Owners can manage tenant domains"
  ON public.tenant_domains FOR ALL
  USING (tenant_id IN (
    SELECT tenant_id FROM public.user_tenant_roles 
    WHERE user_id = auth.uid() AND role = 'owner'
  ));

-- RLS Policies for tenant_pages
CREATE POLICY "Users can view their tenant pages"
  ON public.tenant_pages FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM public.user_tenant_roles WHERE user_id = auth.uid()
  ));

CREATE POLICY "Owners and managers can manage tenant pages"
  ON public.tenant_pages FOR ALL
  USING (tenant_id IN (
    SELECT tenant_id FROM public.user_tenant_roles 
    WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
  ));

-- RLS Policies for tenant_page_blocks
CREATE POLICY "Users can view page blocks"
  ON public.tenant_page_blocks FOR SELECT
  USING (page_id IN (
    SELECT id FROM public.tenant_pages WHERE tenant_id IN (
      SELECT tenant_id FROM public.user_tenant_roles WHERE user_id = auth.uid()
    )
  ));

CREATE POLICY "Owners and managers can manage page blocks"
  ON public.tenant_page_blocks FOR ALL
  USING (page_id IN (
    SELECT id FROM public.tenant_pages WHERE tenant_id IN (
      SELECT tenant_id FROM public.user_tenant_roles 
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  ));

-- Create indexes
CREATE INDEX idx_tenant_domains_tenant_id ON public.tenant_domains(tenant_id);
CREATE INDEX idx_tenant_domains_subdomain ON public.tenant_domains(subdomain);
CREATE INDEX idx_tenant_domains_custom_domain ON public.tenant_domains(custom_domain);
CREATE INDEX idx_tenant_pages_tenant_id ON public.tenant_pages(tenant_id);
CREATE INDEX idx_tenant_page_blocks_page_id ON public.tenant_page_blocks(page_id);

-- Trigger for updated_at
CREATE TRIGGER update_tenant_domains_updated_at
  BEFORE UPDATE ON public.tenant_domains
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tenant_pages_updated_at
  BEFORE UPDATE ON public.tenant_pages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tenant_page_blocks_updated_at
  BEFORE UPDATE ON public.tenant_page_blocks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();