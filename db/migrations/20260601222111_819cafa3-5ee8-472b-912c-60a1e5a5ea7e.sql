
-- 1. Document type enum
DO $$ BEGIN
  CREATE TYPE public.application_doc_type AS ENUM (
    'commercial_registration',
    'tax_registration',
    'bank_iban',
    'brand_logo',
    'cover_photo',
    'dine_in_menu',
    'opening_hours'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.application_doc_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. Application documents table
CREATE TABLE IF NOT EXISTS public.application_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.tenant_applications(id) ON DELETE CASCADE,
  doc_type public.application_doc_type NOT NULL,
  file_url text NOT NULL,
  file_path text NOT NULL,
  file_name text NOT NULL,
  size_bytes bigint,
  mime_type text,
  status public.application_doc_status NOT NULL DEFAULT 'pending',
  reviewer_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, doc_type)
);

CREATE INDEX IF NOT EXISTS idx_application_documents_app ON public.application_documents(application_id);
CREATE INDEX IF NOT EXISTS idx_application_documents_status ON public.application_documents(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.application_documents TO authenticated;
GRANT ALL ON public.application_documents TO service_role;

ALTER TABLE public.application_documents ENABLE ROW LEVEL SECURITY;

-- Applicants can view/manage docs tied to their own application (email match)
CREATE POLICY "Applicants view own application documents"
ON public.application_documents FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.tenant_applications ta
    WHERE ta.id = application_documents.application_id
      AND ta.email = ((current_setting('request.jwt.claims', true))::json ->> 'email')
  )
);

CREATE POLICY "Applicants insert own application documents"
ON public.application_documents FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tenant_applications ta
    WHERE ta.id = application_documents.application_id
      AND ta.email = ((current_setting('request.jwt.claims', true))::json ->> 'email')
  )
);

CREATE POLICY "Applicants update own application documents"
ON public.application_documents FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.tenant_applications ta
    WHERE ta.id = application_documents.application_id
      AND ta.email = ((current_setting('request.jwt.claims', true))::json ->> 'email')
  )
);

CREATE POLICY "Applicants delete own application documents"
ON public.application_documents FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.tenant_applications ta
    WHERE ta.id = application_documents.application_id
      AND ta.email = ((current_setting('request.jwt.claims', true))::json ->> 'email')
      AND application_documents.status <> 'approved'
  )
);

CREATE POLICY "SuperAdmins view all application documents"
ON public.application_documents FOR SELECT
USING (EXISTS (SELECT 1 FROM public.superadmin_users WHERE user_id = auth.uid()));

CREATE POLICY "SuperAdmins update application documents"
ON public.application_documents FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.superadmin_users WHERE user_id = auth.uid()));

CREATE TRIGGER update_application_documents_updated_at
BEFORE UPDATE ON public.application_documents
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Extend tenant_applications with verification stage + structured fields
ALTER TABLE public.tenant_applications
  ADD COLUMN IF NOT EXISTS verification_stage text NOT NULL DEFAULT 'welcome',
  ADD COLUMN IF NOT EXISTS opening_hours jsonb,
  ADD COLUMN IF NOT EXISTS brand_logo_url text,
  ADD COLUMN IF NOT EXISTS cover_photo_url text,
  ADD COLUMN IF NOT EXISTS dine_in_menu_url text,
  ADD COLUMN IF NOT EXISTS iban_document_url text,
  ADD COLUMN IF NOT EXISTS vat_document_url text;

-- 4. Private storage bucket for application documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('application-docs', 'application-docs', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: applicants manage files under their own application folder; SuperAdmins read all.
-- Path convention: {application_id}/{doc_type}/{filename}
CREATE POLICY "Applicants read own application docs"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'application-docs'
  AND EXISTS (
    SELECT 1 FROM public.tenant_applications ta
    WHERE ta.id::text = (storage.foldername(name))[1]
      AND ta.email = ((current_setting('request.jwt.claims', true))::json ->> 'email')
  )
);

CREATE POLICY "Applicants upload own application docs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'application-docs'
  AND EXISTS (
    SELECT 1 FROM public.tenant_applications ta
    WHERE ta.id::text = (storage.foldername(name))[1]
      AND ta.email = ((current_setting('request.jwt.claims', true))::json ->> 'email')
  )
);

CREATE POLICY "Applicants delete own application docs"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'application-docs'
  AND EXISTS (
    SELECT 1 FROM public.tenant_applications ta
    WHERE ta.id::text = (storage.foldername(name))[1]
      AND ta.email = ((current_setting('request.jwt.claims', true))::json ->> 'email')
  )
);

CREATE POLICY "SuperAdmins read all application docs"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'application-docs'
  AND EXISTS (SELECT 1 FROM public.superadmin_users WHERE user_id = auth.uid())
);
