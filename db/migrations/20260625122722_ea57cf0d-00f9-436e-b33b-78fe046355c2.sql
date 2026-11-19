
-- Background posting jobs with resumable execution
CREATE TABLE public.posting_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  branch_id UUID,
  job_type TEXT NOT NULL CHECK (job_type IN ('bulk_post','auto_reconcile')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),
  expense_ids UUID[] NOT NULL DEFAULT '{}',
  total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  posted INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  fixed INTEGER NOT NULL DEFAULT 0,
  manual_review INTEGER NOT NULL DEFAULT 0,
  current_expense_id UUID,
  last_error TEXT,
  details JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

GRANT SELECT, INSERT, UPDATE ON public.posting_jobs TO authenticated;
GRANT ALL ON public.posting_jobs TO service_role;

ALTER TABLE public.posting_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view their posting jobs"
  ON public.posting_jobs FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.user_tenant_roles WHERE user_id = auth.uid()));

CREATE POLICY "Posting-eligible roles can create posting jobs"
  ON public.posting_jobs FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.user_tenant_roles
      WHERE user_id = auth.uid()
        AND role IN ('owner','manager','accountant')
    )
  );

CREATE POLICY "Posting-eligible roles can update their posting jobs"
  ON public.posting_jobs FOR UPDATE TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.user_tenant_roles
      WHERE user_id = auth.uid()
        AND role IN ('owner','manager','accountant')
    )
  );

CREATE INDEX idx_posting_jobs_tenant_status ON public.posting_jobs(tenant_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_posting_jobs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_posting_jobs_updated_at
  BEFORE UPDATE ON public.posting_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_posting_jobs_updated_at();

-- Enqueue a job. Validates role membership and returns the new job id.
CREATE OR REPLACE FUNCTION public.enqueue_posting_job(
  p_tenant_id UUID,
  p_branch_id UUID,
  p_job_type TEXT,
  p_expense_ids UUID[]
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job_id UUID; v_allowed BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_tenant_roles
    WHERE user_id = auth.uid()
      AND tenant_id = p_tenant_id
      AND role IN ('owner','manager','accountant')
  ) INTO v_allowed;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Not authorized to enqueue posting jobs for this tenant';
  END IF;
  IF p_job_type NOT IN ('bulk_post','auto_reconcile') THEN
    RAISE EXCEPTION 'Invalid job_type: %', p_job_type;
  END IF;

  INSERT INTO public.posting_jobs (
    tenant_id, branch_id, job_type, expense_ids, total, status, created_by
  ) VALUES (
    p_tenant_id, p_branch_id, p_job_type,
    COALESCE(p_expense_ids, '{}'::uuid[]),
    COALESCE(array_length(p_expense_ids, 1), 0),
    'queued', auth.uid()
  ) RETURNING id INTO v_job_id;

  RETURN v_job_id;
END $$;

REVOKE ALL ON FUNCTION public.enqueue_posting_job(UUID, UUID, TEXT, UUID[]) FROM public;
GRANT EXECUTE ON FUNCTION public.enqueue_posting_job(UUID, UUID, TEXT, UUID[]) TO authenticated;
