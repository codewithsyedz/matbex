-- Fix company name in Cookie Policy text block
UPDATE public.cms_page_blocks
SET config = jsonb_set(
  config,
  '{body}',
  to_jsonb(replace(config->>'body', 'Matbex Inc.', 'Rilan Business Company.'))
)
WHERE page_id = (SELECT id FROM public.cms_pages WHERE slug = 'cookies')
  AND block_type = 'text';