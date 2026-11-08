UPDATE public.cms_page_blocks
SET config = (
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(config::text, '@matbex\.net', '@matbex.com', 'gi'),
        '@matbex\.com', '@matbex.com', 'gi'
      ),
      'Matbex', 'Matbex', 'g'
    ),
    'matbex', 'matbex', 'g'
  )
)::jsonb
WHERE config::text ~* 'matbex';

UPDATE public.cms_page_blocks
SET config = jsonb_set(
  jsonb_set(config, '{buttonLink}', '"mailto:security@matbex.com"'),
  '{buttonText}', '"Contact Security Team"'
)
WHERE id = 'c3bd8eb4-0258-4e94-8727-06beb0908845';

UPDATE public.footer_link_settings
SET is_enabled = false
WHERE link_key IN ('careers', 'press');

CREATE TABLE IF NOT EXISTS public.newsletter_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  source text NOT NULL DEFAULT 'blog',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, source)
);

ALTER TABLE public.newsletter_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can subscribe to the newsletter"
ON public.newsletter_subscriptions
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "SuperAdmins can view newsletter subscriptions"
ON public.newsletter_subscriptions
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.superadmin_users
  WHERE superadmin_users.user_id = auth.uid()
));