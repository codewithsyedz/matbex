CREATE TABLE public.posting_rule_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid,
  user_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  rule text NOT NULL,
  source text NOT NULL,
  origin text NOT NULL DEFAULT 'client',
  title text NOT NULL,
  message text NOT NULL,
  route text,
  entity_type text,
  entity_id uuid,
  attempted_amount numeric,
  attempted_date date,
  offending_accounts jsonb NOT NULL DEFAULT '[]'::jsonb,
  offending_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  attempted_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT posting_rule_rejections_origin_check CHECK (origin IN ('client','database'))
);

GRANT SELECT, INSERT ON public.posting_rule_rejections TO authenticated;
GRANT ALL ON public.posting_rule_rejections TO service_role;

ALTER TABLE public.posting_rule_rejections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can log rejections for their tenant"
ON public.posting_rule_rejections FOR INSERT TO authenticated
WITH CHECK (tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()));

CREATE POLICY "Finance roles can review rejections"
ON public.posting_rule_rejections FOR SELECT TO authenticated
USING (
  tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = ANY (ARRAY['owner'::app_role,'manager'::app_role,'accountant'::app_role,'superadmin'::app_role])
  )
);

CREATE INDEX idx_posting_rule_rejections_tenant_time
  ON public.posting_rule_rejections (tenant_id, occurred_at DESC);
CREATE INDEX idx_posting_rule_rejections_rule
  ON public.posting_rule_rejections (tenant_id, rule, occurred_at DESC);
CREATE INDEX idx_posting_rule_rejections_branch
  ON public.posting_rule_rejections (branch_id, occurred_at DESC);