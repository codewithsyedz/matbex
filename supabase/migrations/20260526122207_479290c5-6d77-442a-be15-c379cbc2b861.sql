
CREATE TABLE IF NOT EXISTS public.migration_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  source_system text NOT NULL DEFAULT 'csv',
  entity_type text NOT NULL CHECK (entity_type IN ('menu','inventory','customers','staff')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','validating','ready','committing','committed','failed')),
  file_path text,
  file_name text,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_count integer NOT NULL DEFAULT 0,
  total_count integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  committed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_migration_jobs_restaurant ON public.migration_jobs(restaurant_id, created_at DESC);

ALTER TABLE public.migration_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners/managers can view migration jobs"
  ON public.migration_jobs FOR SELECT
  USING (
    public.can_access_restaurant(restaurant_id)
    AND (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
      OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role))
  );

CREATE POLICY "Owners/managers can insert migration jobs"
  ON public.migration_jobs FOR INSERT
  WITH CHECK (
    public.can_access_restaurant(restaurant_id)
    AND (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
      OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role))
  );

CREATE POLICY "Owners/managers can update migration jobs"
  ON public.migration_jobs FOR UPDATE
  USING (
    public.can_access_restaurant(restaurant_id)
    AND (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
      OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role))
  );

CREATE POLICY "Owners/managers can delete migration jobs"
  ON public.migration_jobs FOR DELETE
  USING (
    public.can_access_restaurant(restaurant_id)
    AND (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
      OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role))
  );

CREATE TRIGGER trg_migration_jobs_updated
  BEFORE UPDATE ON public.migration_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.migration_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.migration_jobs(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL,
  row_number integer NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','valid','invalid','imported','skipped')),
  imported_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_migration_records_job ON public.migration_records(job_id, status);
CREATE INDEX IF NOT EXISTS idx_migration_records_tenant ON public.migration_records(restaurant_id);

ALTER TABLE public.migration_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners/managers can view migration records"
  ON public.migration_records FOR SELECT
  USING (
    public.can_access_restaurant(restaurant_id)
    AND (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
      OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role))
  );

CREATE POLICY "Owners/managers can insert migration records"
  ON public.migration_records FOR INSERT
  WITH CHECK (
    public.can_access_restaurant(restaurant_id)
    AND (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
      OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role))
  );

CREATE POLICY "Owners/managers can update migration records"
  ON public.migration_records FOR UPDATE
  USING (
    public.can_access_restaurant(restaurant_id)
    AND (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
      OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role))
  );

CREATE POLICY "Owners/managers can delete migration records"
  ON public.migration_records FOR DELETE
  USING (
    public.can_access_restaurant(restaurant_id)
    AND (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
      OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role))
  );

INSERT INTO storage.buckets (id, name, public)
VALUES ('migration-uploads', 'migration-uploads', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Tenant members can read migration uploads"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'migration-uploads'
    AND (storage.foldername(name))[1] IN (
      SELECT restaurant_id::text FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Tenant members can upload migration files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'migration-uploads'
    AND (storage.foldername(name))[1] IN (
      SELECT restaurant_id::text FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Tenant members can delete migration files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'migration-uploads'
    AND (storage.foldername(name))[1] IN (
      SELECT restaurant_id::text FROM public.profiles WHERE id = auth.uid()
    )
  );
