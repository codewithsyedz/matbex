
-- Sync landing_sections with the actual Landing.tsx render order and add missing sections
UPDATE public.landing_sections SET sort_order = 1 WHERE section_key = 'hero';
INSERT INTO public.landing_sections (section_key, section_name, sort_order, is_active)
VALUES ('compliance', 'Compliance Badges', 2, true)
ON CONFLICT (section_key) DO UPDATE SET section_name = EXCLUDED.section_name, sort_order = EXCLUDED.sort_order;

UPDATE public.landing_sections SET sort_order = 3 WHERE section_key = 'bento';
UPDATE public.landing_sections SET sort_order = 4 WHERE section_key = 'mission';
UPDATE public.landing_sections SET sort_order = 5 WHERE section_key = 'tools';
UPDATE public.landing_sections SET sort_order = 6 WHERE section_key = 'features';

INSERT INTO public.landing_sections (section_key, section_name, sort_order, is_active)
VALUES ('online_ordering', 'Online Ordering Section', 7, true)
ON CONFLICT (section_key) DO UPDATE SET section_name = EXCLUDED.section_name, sort_order = EXCLUDED.sort_order;

UPDATE public.landing_sections SET sort_order = 8 WHERE section_key = 'testimonials';
UPDATE public.landing_sections SET sort_order = 9 WHERE section_key = 'pricing';
UPDATE public.landing_sections SET sort_order = 10 WHERE section_key = 'faq';

INSERT INTO public.landing_sections (section_key, section_name, sort_order, is_active)
VALUES ('contact', 'Contact Section', 11, true)
ON CONFLICT (section_key) DO UPDATE SET section_name = EXCLUDED.section_name, sort_order = EXCLUDED.sort_order;
