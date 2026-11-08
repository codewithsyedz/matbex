UPDATE public.landing_hero
SET subheadline = REGEXP_REPLACE(REGEXP_REPLACE(subheadline, 'SufraOS', 'Matbex', 'g'), 'sufraos', 'matbex', 'g'),
    headline = REGEXP_REPLACE(REGEXP_REPLACE(headline, 'SufraOS', 'Matbex', 'g'), 'sufraos', 'matbex', 'g'),
    eyebrow = REGEXP_REPLACE(REGEXP_REPLACE(eyebrow, 'SufraOS', 'Matbex', 'g'), 'sufraos', 'matbex', 'g'),
    updated_at = now()
WHERE subheadline ILIKE '%sufra%' OR headline ILIKE '%sufra%' OR eyebrow ILIKE '%sufra%';

UPDATE public.landing_features
SET title = REGEXP_REPLACE(REGEXP_REPLACE(title, 'SufraOS', 'Matbex', 'g'), 'sufraos', 'matbex', 'g'),
    description = REGEXP_REPLACE(REGEXP_REPLACE(description, 'SufraOS', 'Matbex', 'g'), 'sufraos', 'matbex', 'g'),
    updated_at = now()
WHERE title ILIKE '%sufra%' OR description ILIKE '%sufra%';

UPDATE public.cms_pages
SET title = REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(title,''), 'SufraOS', 'Matbex', 'g'), 'sufraos', 'matbex', 'g'),
    meta_title = REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(meta_title,''), 'SufraOS', 'Matbex', 'g'), 'sufraos', 'matbex', 'g'),
    meta_description = REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(meta_description,''), 'SufraOS', 'Matbex', 'g'), 'sufraos', 'matbex', 'g'),
    updated_at = now()
WHERE title ILIKE '%sufra%' OR meta_title ILIKE '%sufra%' OR meta_description ILIKE '%sufra%';

-- Also sweep mission, faq, testimonials, pricing, tools just in case (no-ops if clean)
UPDATE public.landing_mission SET
  headline_prefix = REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(headline_prefix,''), 'SufraOS','Matbex','g'),'sufraos','matbex','g'),
  headline_bold = REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(headline_bold,''), 'SufraOS','Matbex','g'),'sufraos','matbex','g'),
  opening_paragraph = REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(opening_paragraph,''), 'SufraOS','Matbex','g'),'sufraos','matbex','g'),
  core_mission = REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(core_mission,''), 'SufraOS','Matbex','g'),'sufraos','matbex','g'),
  identity_text = REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(identity_text,''), 'SufraOS','Matbex','g'),'sufraos','matbex','g'),
  symbolic_statement = REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(symbolic_statement,''), 'SufraOS','Matbex','g'),'sufraos','matbex','g'),
  closing_text = REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(closing_text,''), 'SufraOS','Matbex','g'),'sufraos','matbex','g'),
  updated_at = now()
WHERE headline_prefix||headline_bold||opening_paragraph||core_mission||identity_text||symbolic_statement||closing_text ILIKE '%sufra%';

UPDATE public.cms_page_blocks
SET config = REPLACE(REPLACE(config::text, 'SufraOS','Matbex'),'sufraos','matbex')::jsonb,
    updated_at = now()
WHERE config::text ILIKE '%sufra%';

UPDATE public.landing_pricing_plans
SET features = REPLACE(REPLACE(features::text,'SufraOS','Matbex'),'sufraos','matbex')::jsonb,
    name = REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(name,''),'SufraOS','Matbex','g'),'sufraos','matbex','g'),
    tagline = REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(tagline,''),'SufraOS','Matbex','g'),'sufraos','matbex','g'),
    description = REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(description,''),'SufraOS','Matbex','g'),'sufraos','matbex','g'),
    updated_at = now()
WHERE features::text||COALESCE(name,'')||COALESCE(tagline,'')||COALESCE(description,'') ILIKE '%sufra%';