-- Create tenant_applications table for the vetted gate onboarding
CREATE TABLE public.tenant_applications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Contact Info
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  country TEXT NOT NULL DEFAULT 'SA',
  referral_code TEXT,
  
  -- Business Entity Details
  company_name TEXT NOT NULL,
  cr_number TEXT, -- Commercial Registration
  vat_number TEXT,
  cr_document_url TEXT, -- Uploaded CR PDF
  
  -- Restaurant Details
  restaurant_name TEXT,
  restaurant_type TEXT, -- fine_dining, qsr, cafe, dark_kitchen
  estimated_monthly_revenue TEXT,
  location_count INTEGER DEFAULT 1,
  
  -- Plan Selection
  plan_id UUID REFERENCES public.plans(id),
  billing_interval TEXT DEFAULT 'monthly', -- monthly or annual
  
  -- Application State
  status TEXT NOT NULL DEFAULT 'prospect', -- prospect, submitted, pending_approval, approved, rejected
  
  -- Review Info
  reviewed_by UUID,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  review_notes TEXT,
  
  -- After Approval
  tenant_id UUID REFERENCES public.tenants(id),
  user_id UUID,
  temporary_password TEXT,
  credentials_sent_at TIMESTAMP WITH TIME ZONE,
  first_login_at TIMESTAMP WITH TIME ZONE,
  password_changed BOOLEAN DEFAULT FALSE,
  
  -- Audit
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.tenant_applications ENABLE ROW LEVEL SECURITY;

-- SuperAdmin can access all applications
CREATE POLICY "SuperAdmins can view all applications"
  ON public.tenant_applications
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM superadmin_users WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "SuperAdmins can update applications"
  ON public.tenant_applications
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM superadmin_users WHERE user_id = auth.uid()
    )
  );

-- Allow public inserts (for registration flow)
CREATE POLICY "Anyone can submit applications"
  ON public.tenant_applications
  FOR INSERT
  WITH CHECK (true);

-- Applicants can view their own application by email
CREATE POLICY "Applicants can view own application"
  ON public.tenant_applications
  FOR SELECT
  USING (email = current_setting('request.jwt.claims', true)::json->>'email');

-- Create index for faster lookups
CREATE INDEX idx_tenant_applications_status ON public.tenant_applications(status);
CREATE INDEX idx_tenant_applications_email ON public.tenant_applications(email);

-- Add trigger for updated_at
CREATE TRIGGER update_tenant_applications_updated_at
  BEFORE UPDATE ON public.tenant_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for CR documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'onboarding-documents',
  'onboarding-documents',
  false,
  10485760, -- 10MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/jpg']
);

-- Storage policies for onboarding documents
CREATE POLICY "Anyone can upload onboarding documents"
  ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'onboarding-documents');

CREATE POLICY "SuperAdmins can view onboarding documents"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'onboarding-documents' AND
    EXISTS (SELECT 1 FROM superadmin_users WHERE user_id = auth.uid())
  );