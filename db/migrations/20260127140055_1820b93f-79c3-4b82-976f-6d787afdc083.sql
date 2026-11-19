-- Tools Stack Section for Landing Page CMS

-- Categories (tabs like "Independent Restaurant", "Multi-Location", etc.)
CREATE TABLE public.landing_tools_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tools/Features linked to categories
CREATE TABLE public.landing_tools_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES public.landing_tools_categories(id) ON DELETE CASCADE,
  number INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  preview_type TEXT NOT NULL DEFAULT 'revenue' CHECK (preview_type IN ('revenue', 'inventory', 'dashboard', 'pos', 'reports', 'staff')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tools Stack Section Settings
CREATE TABLE public.landing_tools_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  eyebrow TEXT NOT NULL DEFAULT 'BUILT IN TOOLS',
  headline TEXT NOT NULL DEFAULT 'An entire stack of tools that keep your kitchen moving',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.landing_tools_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_tools_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_tools_settings ENABLE ROW LEVEL SECURITY;

-- Public read access for active items
CREATE POLICY "Anyone can view active tools categories" ON public.landing_tools_categories
  FOR SELECT USING (is_active = true);

CREATE POLICY "Anyone can view active tools items" ON public.landing_tools_items
  FOR SELECT USING (is_active = true);

CREATE POLICY "Anyone can view active tools settings" ON public.landing_tools_settings
  FOR SELECT USING (is_active = true);

-- SuperAdmin write access using existing helper function
CREATE POLICY "SuperAdmin can manage tools categories" ON public.landing_tools_categories
  FOR ALL USING (public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmin can manage tools items" ON public.landing_tools_items
  FOR ALL USING (public.is_superadmin(auth.uid()));

CREATE POLICY "SuperAdmin can manage tools settings" ON public.landing_tools_settings
  FOR ALL USING (public.is_superadmin(auth.uid()));

-- Insert default settings
INSERT INTO public.landing_tools_settings (eyebrow, headline, is_active) VALUES
('BUILT IN TOOLS', 'An entire stack of tools that keep your kitchen moving', true);

-- Insert default categories
INSERT INTO public.landing_tools_categories (name, sort_order) VALUES
('Independent Restaurant', 1),
('Multi-Location', 2),
('Quick Serve', 3),
('Café / Bakery', 4),
('Cloud Kitchen', 5),
('Food Truck', 6);

-- Insert default tools for Independent Restaurant category
INSERT INTO public.landing_tools_items (category_id, number, title, description, preview_type, sort_order)
SELECT 
  id,
  1,
  'Restaurant POS',
  'A fast, intuitive point-of-sale system built for front-of-house speed. Manage orders, split bills, and serve customers with zero friction.',
  'pos',
  1
FROM public.landing_tools_categories WHERE name = 'Independent Restaurant';

INSERT INTO public.landing_tools_items (category_id, number, title, description, preview_type, sort_order)
SELECT 
  id,
  2,
  'Inventory Management',
  'Track stocks in real-time. Monitor ingredients, automate reorders, reduce waste with recipes.',
  'inventory',
  2
FROM public.landing_tools_categories WHERE name = 'Independent Restaurant';

INSERT INTO public.landing_tools_items (category_id, number, title, description, preview_type, sort_order)
SELECT 
  id,
  3,
  'Dashboard',
  'Stay in control with insights across your restaurant. From sales to inventory, all in one powerful dashboard.',
  'dashboard',
  3
FROM public.landing_tools_categories WHERE name = 'Independent Restaurant';