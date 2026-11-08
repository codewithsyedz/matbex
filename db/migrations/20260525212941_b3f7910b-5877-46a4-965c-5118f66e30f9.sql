-- Rebrand Cookie Policy from Matbex to Matbex

-- 1. Update page metadata
UPDATE public.cms_pages
SET 
  meta_title = 'Cookie Policy | Matbex',
  meta_description = 'Learn about the cookies we use and how to manage them.'
WHERE slug = 'cookies';

-- 2. Update hero block: replace Matbex with Matbex and refresh badge date
UPDATE public.cms_page_blocks
SET config = jsonb_set(
  jsonb_set(
    config,
    '{subtitle}',
    to_jsonb(replace(config->>'subtitle', 'Matbex', 'Matbex'))
  ),
  '{badge}',
  '"Last updated: May 25, 2026"'::jsonb
)
WHERE page_id = (SELECT id FROM public.cms_pages WHERE slug = 'cookies')
  AND block_type = 'hero';

-- 3. Update text block body: replace branding, email, and address
UPDATE public.cms_page_blocks
SET config = jsonb_set(
  config,
  '{body}',
  to_jsonb(
    replace(
      replace(
        replace(config->>'body', 'Matbex', 'Matbex'),
        'privacy@matbex.net',
        'privacy@matbex.com'
      ),
      'Matbex Inc.',
      'Rilan Business Company'
    )
  )
)
WHERE page_id = (SELECT id FROM public.cms_pages WHERE slug = 'cookies')
  AND block_type = 'text';