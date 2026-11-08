-- Create landing_sections table for section visibility management
CREATE TABLE public.landing_sections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  section_key TEXT NOT NULL UNIQUE,
  section_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.landing_sections ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Public can view sections" ON public.landing_sections
  FOR SELECT USING (true);

-- SuperAdmin write access
CREATE POLICY "SuperAdmin can manage sections" ON public.landing_sections
  FOR ALL USING (public.is_superadmin(auth.uid()));

-- Create landing_mission table for mission statement CMS
CREATE TABLE public.landing_mission (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  headline_prefix TEXT NOT NULL DEFAULT 'Engineered Vitality for the',
  headline_bold TEXT NOT NULL DEFAULT 'Modern Restaurateur.',
  opening_paragraph TEXT NOT NULL DEFAULT 'Hospitality is a complex, living ecosystem operating on razor-thin margins. It is an industry defined by chaos, where disconnected systems lead to operational failure.',
  core_mission TEXT NOT NULL DEFAULT 'Matbex exists to synchronize this chaos.',
  identity_text TEXT NOT NULL DEFAULT 'Our visual identity, the "Pulse Line," is our operational mandate. It seamlessly bridges the eternal art of service, represented by the traditional cloche, with the clinical precision of real-time data.',
  symbolic_statement TEXT NOT NULL DEFAULT 'It symbolizes the moment intuition meets intelligence.',
  closing_text TEXT NOT NULL DEFAULT 'We are not merely providing software; we are installing a central nervous system. Matbex ensures that the heartbeat of your kitchen is perfectly synchronized with the financial health of your business, breathing new life into the low-margin environment.',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.landing_mission ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Public can view mission" ON public.landing_mission
  FOR SELECT USING (true);

-- SuperAdmin write access
CREATE POLICY "SuperAdmin can manage mission" ON public.landing_mission
  FOR ALL USING (public.is_superadmin(auth.uid()));

-- Insert default section visibility records
INSERT INTO public.landing_sections (section_key, section_name, is_active, sort_order) VALUES
  ('hero', 'Hero Section', true, 1),
  ('mission', 'Mission Statement', true, 2),
  ('bento', 'Features Bento Grid', true, 3),
  ('tools', 'Tools Stack Section', true, 4),
  ('features', 'Feature Sections', true, 5),
  ('testimonials', 'Testimonials Carousel', true, 6),
  ('pricing', 'Pricing Table', true, 7),
  ('faq', 'FAQ Section', true, 8);

-- Insert default mission content
INSERT INTO public.landing_mission (
  headline_prefix,
  headline_bold,
  opening_paragraph,
  core_mission,
  identity_text,
  symbolic_statement,
  closing_text
) VALUES (
  'Engineered Vitality for the',
  'Modern Restaurateur.',
  'Hospitality is a complex, living ecosystem operating on razor-thin margins. It is an industry defined by chaos, where disconnected systems lead to operational failure.',
  'Matbex exists to synchronize this chaos.',
  'Our visual identity, the "Pulse Line," is our operational mandate. It seamlessly bridges the eternal art of service, represented by the traditional cloche, with the clinical precision of real-time data.',
  'It symbolizes the moment intuition meets intelligence.',
  'We are not merely providing software; we are installing a central nervous system. Matbex ensures that the heartbeat of your kitchen is perfectly synchronized with the financial health of your business, breathing new life into the low-margin environment.'
);