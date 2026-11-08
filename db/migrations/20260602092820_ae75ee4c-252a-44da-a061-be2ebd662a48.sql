-- Gap #3: hard session timeout, Gap #2: server-side validation against tampering.

ALTER TABLE public.role_impersonation_logs
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS end_reason text;

-- Backfill expiry for any existing rows (1h from start) and set default for new rows.
UPDATE public.role_impersonation_logs
SET expires_at = started_at + interval '60 minutes'
WHERE expires_at IS NULL;

ALTER TABLE public.role_impersonation_logs
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '60 minutes'),
  ALTER COLUMN expires_at SET NOT NULL;

-- Constrain end_reason to a known vocabulary.
ALTER TABLE public.role_impersonation_logs
  DROP CONSTRAINT IF EXISTS role_impersonation_logs_end_reason_check;
ALTER TABLE public.role_impersonation_logs
  ADD CONSTRAINT role_impersonation_logs_end_reason_check
  CHECK (end_reason IS NULL OR end_reason IN ('manual','timeout','signout','invalidated'));

-- Active-session lookup index for the validator.
CREATE INDEX IF NOT EXISTS idx_role_impersonation_logs_active
  ON public.role_impersonation_logs(owner_user_id, ended_at)
  WHERE ended_at IS NULL;

-- Server-side validator. SECURITY DEFINER so we can read the row even if RLS
-- would otherwise hide it, but we always scope by auth.uid().
CREATE OR REPLACE FUNCTION public.validate_active_impersonation(_log_id uuid)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  impersonated_role text,
  started_at timestamptz,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.tenant_id, l.impersonated_role, l.started_at, l.expires_at
  FROM public.role_impersonation_logs l
  WHERE l.id = _log_id
    AND l.owner_user_id = auth.uid()
    AND l.ended_at IS NULL
    AND l.expires_at > now()
    AND EXISTS (
      SELECT 1 FROM public.user_tenant_roles utr
      WHERE utr.user_id = auth.uid()
        AND utr.tenant_id = l.tenant_id
        AND utr.role = 'owner'
    );
$$;

GRANT EXECUTE ON FUNCTION public.validate_active_impersonation(uuid) TO authenticated;
