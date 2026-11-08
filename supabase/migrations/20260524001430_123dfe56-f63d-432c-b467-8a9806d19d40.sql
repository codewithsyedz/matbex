-- 1. Enrich zatca_settings with phone/social/loyalty/reorder/promo
ALTER TABLE public.zatca_settings
  ADD COLUMN IF NOT EXISTS phone_display text,
  ADD COLUMN IF NOT EXISTS whatsapp_number text,
  ADD COLUMN IF NOT EXISTS instagram_handle text,
  ADD COLUMN IF NOT EXISTS x_handle text,
  ADD COLUMN IF NOT EXISTS tiktok_handle text,
  ADD COLUMN IF NOT EXISTS snapchat_handle text,
  ADD COLUMN IF NOT EXISTS loyalty_qr_url text,
  ADD COLUMN IF NOT EXISTS loyalty_qr_label_ar text,
  ADD COLUMN IF NOT EXISTS loyalty_qr_label_en text,
  ADD COLUMN IF NOT EXISTS reorder_qr_url text,
  ADD COLUMN IF NOT EXISTS reorder_qr_label_ar text,
  ADD COLUMN IF NOT EXISTS reorder_qr_label_en text,
  ADD COLUMN IF NOT EXISTS promo_message_ar text,
  ADD COLUMN IF NOT EXISTS promo_message_en text,
  ADD COLUMN IF NOT EXISTS show_phone boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_social_handles boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_loyalty_qr boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_reorder_qr boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_promo_message boolean NOT NULL DEFAULT false;

-- 2. Per-branch receipt overrides
CREATE TABLE IF NOT EXISTS public.branch_receipt_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  address_ar text,
  address_en text,
  phone text,
  terminal_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_receipt_overrides_branch_unique UNIQUE (branch_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_receipt_overrides_tenant
  ON public.branch_receipt_overrides (tenant_id);

ALTER TABLE public.branch_receipt_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "branch_receipt_overrides_select" ON public.branch_receipt_overrides;
CREATE POLICY "branch_receipt_overrides_select"
  ON public.branch_receipt_overrides
  FOR SELECT TO authenticated
  USING (can_access_restaurant(tenant_id));

DROP POLICY IF EXISTS "branch_receipt_overrides_insert" ON public.branch_receipt_overrides;
CREATE POLICY "branch_receipt_overrides_insert"
  ON public.branch_receipt_overrides
  FOR INSERT TO authenticated
  WITH CHECK (
    can_access_restaurant(tenant_id) AND (
      has_role(auth.uid(), tenant_id, 'owner'::app_role)
      OR has_role(auth.uid(), tenant_id, 'manager'::app_role)
    )
  );

DROP POLICY IF EXISTS "branch_receipt_overrides_update" ON public.branch_receipt_overrides;
CREATE POLICY "branch_receipt_overrides_update"
  ON public.branch_receipt_overrides
  FOR UPDATE TO authenticated
  USING (
    can_access_restaurant(tenant_id) AND (
      has_role(auth.uid(), tenant_id, 'owner'::app_role)
      OR has_role(auth.uid(), tenant_id, 'manager'::app_role)
    )
  )
  WITH CHECK (
    can_access_restaurant(tenant_id) AND (
      has_role(auth.uid(), tenant_id, 'owner'::app_role)
      OR has_role(auth.uid(), tenant_id, 'manager'::app_role)
    )
  );

DROP POLICY IF EXISTS "branch_receipt_overrides_delete" ON public.branch_receipt_overrides;
CREATE POLICY "branch_receipt_overrides_delete"
  ON public.branch_receipt_overrides
  FOR DELETE TO authenticated
  USING (
    can_access_restaurant(tenant_id) AND (
      has_role(auth.uid(), tenant_id, 'owner'::app_role)
      OR has_role(auth.uid(), tenant_id, 'manager'::app_role)
    )
  );

DROP TRIGGER IF EXISTS trg_branch_receipt_overrides_updated ON public.branch_receipt_overrides;
CREATE TRIGGER trg_branch_receipt_overrides_updated
  BEFORE UPDATE ON public.branch_receipt_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();