-- Hero
ALTER TABLE public.landing_hero
  ADD COLUMN IF NOT EXISTS eyebrow_ar text,
  ADD COLUMN IF NOT EXISTS headline_ar text,
  ADD COLUMN IF NOT EXISTS subheadline_ar text,
  ADD COLUMN IF NOT EXISTS primary_cta_text_ar text,
  ADD COLUMN IF NOT EXISTS secondary_cta_text_ar text;

-- Mission
ALTER TABLE public.landing_mission
  ADD COLUMN IF NOT EXISTS headline_prefix_ar text,
  ADD COLUMN IF NOT EXISTS headline_bold_ar text,
  ADD COLUMN IF NOT EXISTS opening_paragraph_ar text,
  ADD COLUMN IF NOT EXISTS core_mission_ar text,
  ADD COLUMN IF NOT EXISTS identity_text_ar text,
  ADD COLUMN IF NOT EXISTS symbolic_statement_ar text,
  ADD COLUMN IF NOT EXISTS closing_text_ar text;

-- Features
ALTER TABLE public.landing_features
  ADD COLUMN IF NOT EXISTS title_ar text,
  ADD COLUMN IF NOT EXISTS description_ar text;

-- Testimonials
ALTER TABLE public.landing_testimonials
  ADD COLUMN IF NOT EXISTS quote_ar text,
  ADD COLUMN IF NOT EXISTS author_name_ar text,
  ADD COLUMN IF NOT EXISTS author_role_ar text,
  ADD COLUMN IF NOT EXISTS restaurant_name_ar text;

-- Pricing plans
ALTER TABLE public.landing_pricing_plans
  ADD COLUMN IF NOT EXISTS name_ar text,
  ADD COLUMN IF NOT EXISTS tagline_ar text,
  ADD COLUMN IF NOT EXISTS description_ar text,
  ADD COLUMN IF NOT EXISTS features_ar jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cta_text_ar text,
  ADD COLUMN IF NOT EXISTS badge_text_ar text;

-- FAQ
ALTER TABLE public.landing_faq
  ADD COLUMN IF NOT EXISTS question_ar text,
  ADD COLUMN IF NOT EXISTS answer_ar text;

-- Tools settings
ALTER TABLE public.landing_tools_settings
  ADD COLUMN IF NOT EXISTS eyebrow_ar text,
  ADD COLUMN IF NOT EXISTS headline_ar text;

-- Tools categories
ALTER TABLE public.landing_tools_categories
  ADD COLUMN IF NOT EXISTS name_ar text;

-- Tools items
ALTER TABLE public.landing_tools_items
  ADD COLUMN IF NOT EXISTS title_ar text,
  ADD COLUMN IF NOT EXISTS description_ar text;