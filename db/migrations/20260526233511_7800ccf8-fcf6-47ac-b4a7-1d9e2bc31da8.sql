
CREATE TABLE public.docs_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  released_at date NOT NULL DEFAULT CURRENT_DATE,
  summary text,
  app_version text,
  schema_version text,
  is_current boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.docs_versions TO anon;
GRANT SELECT ON public.docs_versions TO authenticated;
GRANT ALL ON public.docs_versions TO service_role;

ALTER TABLE public.docs_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "docs_versions public read"
  ON public.docs_versions FOR SELECT
  USING (true);

CREATE POLICY "docs_versions superadmin manage"
  ON public.docs_versions FOR ALL
  TO authenticated
  USING (public.is_superadmin(auth.uid()))
  WITH CHECK (public.is_superadmin(auth.uid()));

CREATE TABLE public.docs_step_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anchor text NOT NULL,
  version_id uuid NOT NULL REFERENCES public.docs_versions(id) ON DELETE CASCADE,
  change_type text NOT NULL DEFAULT 'updated',
  change_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (anchor, version_id),
  CONSTRAINT docs_step_versions_change_type_check
    CHECK (change_type IN ('added', 'updated', 'unchanged', 'deprecated'))
);

CREATE INDEX idx_docs_step_versions_anchor ON public.docs_step_versions(anchor);
CREATE INDEX idx_docs_step_versions_version ON public.docs_step_versions(version_id);

GRANT SELECT ON public.docs_step_versions TO anon;
GRANT SELECT ON public.docs_step_versions TO authenticated;
GRANT ALL ON public.docs_step_versions TO service_role;

ALTER TABLE public.docs_step_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "docs_step_versions public read"
  ON public.docs_step_versions FOR SELECT
  USING (true);

CREATE POLICY "docs_step_versions superadmin manage"
  ON public.docs_step_versions FOR ALL
  TO authenticated
  USING (public.is_superadmin(auth.uid()))
  WITH CHECK (public.is_superadmin(auth.uid()));

CREATE OR REPLACE FUNCTION public.ensure_single_current_docs_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_current THEN
    UPDATE public.docs_versions
      SET is_current = false
      WHERE id <> NEW.id AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_docs_versions_single_current
  BEFORE INSERT OR UPDATE ON public.docs_versions
  FOR EACH ROW EXECUTE FUNCTION public.ensure_single_current_docs_version();

CREATE TRIGGER trg_docs_versions_updated_at
  BEFORE UPDATE ON public.docs_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

WITH v AS (
  INSERT INTO public.docs_versions (version, released_at, summary, app_version, schema_version, is_current, sort_order)
  VALUES ('1.0.0', CURRENT_DATE, 'Initial published documentation covering setup, daily operations, security and integrations.', '1.0.0', '2025.12.13', true, 100)
  RETURNING id
)
INSERT INTO public.docs_step_versions (anchor, version_id, change_type, change_summary)
SELECT anchor, v.id, 'added', 'Initial documentation step.'
FROM v, (VALUES
  ('installation'),('configuration'),('first-steps'),
  ('dashboard'),('sales-management'),('inventory-control'),
  ('authentication'),('endpoints'),('webhooks'),
  ('data-import'),('backups'),('reports'),
  ('mfa-setup'),('access-control'),('audit-logs'),
  ('pos-systems'),('accounting'),('delivery-platforms')
) AS s(anchor);
