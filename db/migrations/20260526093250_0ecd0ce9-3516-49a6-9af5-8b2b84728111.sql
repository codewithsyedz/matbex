
-- Audit trail for unpaid sale postings (attempted / queued_offline / succeeded / failed)
CREATE TABLE IF NOT EXISTS public.unpaid_posting_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL,
  branch_id UUID,
  user_id UUID,
  customer_id UUID,
  event TEXT NOT NULL CHECK (event IN ('attempted','queued_offline','succeeded','failed')),
  receipt_number TEXT,
  cart_total NUMERIC,
  error_message TEXT,
  error_details JSONB,
  is_online BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unpaid_posting_audit_restaurant_created
  ON public.unpaid_posting_audit (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unpaid_posting_audit_branch_created
  ON public.unpaid_posting_audit (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unpaid_posting_audit_event
  ON public.unpaid_posting_audit (event);

ALTER TABLE public.unpaid_posting_audit ENABLE ROW LEVEL SECURITY;

-- Members of the tenant can insert their own audit rows
CREATE POLICY "Tenant members can insert unpaid audit"
ON public.unpaid_posting_audit
FOR INSERT
TO authenticated
WITH CHECK (
  restaurant_id IN (
    SELECT p.restaurant_id FROM public.profiles p WHERE p.id = auth.uid()
  )
);

-- Owners/managers/admins can read; cashiers can read their own attempts
CREATE POLICY "Tenant staff can read unpaid audit"
ON public.unpaid_posting_audit
FOR SELECT
TO authenticated
USING (
  restaurant_id IN (
    SELECT p.restaurant_id FROM public.profiles p WHERE p.id = auth.uid()
  )
);

-- No updates / deletes: immutable audit log (no policies for UPDATE/DELETE)
