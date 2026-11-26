
-- 1. Add per-tenant toggle (defaults to off)
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS accountant_can_post_journals boolean NOT NULL DEFAULT false;

-- 2. Helper: who is allowed to post journal entries / ledger transactions
CREATE OR REPLACE FUNCTION public.can_post_journal_entries(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_superadmin(auth.uid())
    OR public.tenant_has_role(_tenant_id, 'manager')
    OR (
      EXISTS (
        SELECT 1
        FROM public.user_tenant_roles utr
        WHERE utr.user_id = auth.uid()
          AND utr.tenant_id = _tenant_id
          AND utr.role = 'accountant'
      )
      AND COALESCE(
        (SELECT t.accountant_can_post_journals FROM public.tenants t WHERE t.id = _tenant_id),
        false
      ) = true
    )
$$;

-- 3. Replace insert policies on account_transactions
DROP POLICY IF EXISTS "Owners/Managers can insert transactions" ON public.account_transactions;
CREATE POLICY "Authorized roles can insert transactions"
ON public.account_transactions
FOR INSERT
TO authenticated
WITH CHECK (public.can_post_journal_entries(tenant_id));

-- 4. Replace policies on journal_entry_batches
DROP POLICY IF EXISTS "Managers can create journal batches" ON public.journal_entry_batches;
CREATE POLICY "Authorized roles can create journal batches"
ON public.journal_entry_batches
FOR INSERT
TO authenticated
WITH CHECK (public.can_post_journal_entries(tenant_id));

DROP POLICY IF EXISTS "Managers can update journal batches" ON public.journal_entry_batches;
CREATE POLICY "Authorized roles can update journal batches"
ON public.journal_entry_batches
FOR UPDATE
TO authenticated
USING (public.can_post_journal_entries(tenant_id));
