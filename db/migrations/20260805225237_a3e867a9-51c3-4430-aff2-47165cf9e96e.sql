CREATE TABLE public.import_row_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  scope text NOT NULL,
  scope_ref uuid,
  row_hash text NOT NULL,
  source_file text,
  source_sheet text,
  source_row_number integer,
  row_preview jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_table text,
  target_id uuid,
  imported_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX import_row_fingerprints_unique
  ON public.import_row_fingerprints (tenant_id, scope, row_hash);

CREATE INDEX import_row_fingerprints_scope_idx
  ON public.import_row_fingerprints (tenant_id, scope, scope_ref);

GRANT SELECT, INSERT ON public.import_row_fingerprints TO authenticated;
GRANT ALL ON public.import_row_fingerprints TO service_role;

ALTER TABLE public.import_row_fingerprints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant staff can view import fingerprints"
  ON public.import_row_fingerprints
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Tenant staff can record import fingerprints"
  ON public.import_row_fingerprints
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND imported_by = auth.uid()
  );