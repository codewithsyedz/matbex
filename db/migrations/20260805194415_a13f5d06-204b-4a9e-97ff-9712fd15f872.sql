CREATE TABLE public.partner_settlement_acks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  batch_id uuid NOT NULL REFERENCES public.journal_entry_batches(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES public.project_partners(id) ON DELETE SET NULL,
  acknowledged_by uuid,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_settlement_acks TO authenticated;
GRANT ALL ON public.partner_settlement_acks TO service_role;

ALTER TABLE public.partner_settlement_acks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance roles read settlement acks"
ON public.partner_settlement_acks FOR SELECT TO authenticated
USING (public.can_manage_capital(tenant_id));

CREATE POLICY "Finance roles insert settlement acks"
ON public.partner_settlement_acks FOR INSERT TO authenticated
WITH CHECK (public.can_manage_capital(tenant_id) AND acknowledged_by = auth.uid());

CREATE POLICY "Finance roles update settlement acks"
ON public.partner_settlement_acks FOR UPDATE TO authenticated
USING (public.can_manage_capital(tenant_id))
WITH CHECK (public.can_manage_capital(tenant_id));

CREATE POLICY "Finance roles delete settlement acks"
ON public.partner_settlement_acks FOR DELETE TO authenticated
USING (public.can_manage_capital(tenant_id));

CREATE INDEX idx_partner_settlement_acks_tenant ON public.partner_settlement_acks (tenant_id, partner_id);

CREATE TRIGGER trg_partner_settlement_acks_updated_at
BEFORE UPDATE ON public.partner_settlement_acks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();