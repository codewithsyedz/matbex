ALTER TABLE public.cms_pages
  ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.cms_page_blocks
  ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_cms_pages_translations
  ON public.cms_pages USING GIN (translations);

CREATE INDEX IF NOT EXISTS idx_cms_page_blocks_translations
  ON public.cms_page_blocks USING GIN (translations);

COMMENT ON COLUMN public.cms_pages.translations IS
  'Per-locale overrides, e.g. {"ar": {"title": "...", "meta_title": "...", "meta_description": "..."}}';
COMMENT ON COLUMN public.cms_page_blocks.translations IS
  'Per-locale overrides for config fields, e.g. {"ar": {"title": "...", "subtitle": "...", "items": [...]}}';