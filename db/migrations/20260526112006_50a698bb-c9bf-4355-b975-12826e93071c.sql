
DO $$ BEGIN
  CREATE TYPE public.payment_gateway AS ENUM ('hyperpay','stcpay','paymob','moyasar','amazon_ps','geidea');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_method AS ENUM ('mada','apple_pay','visa','mastercard','stc_pay','cash','external_card');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_intent_status AS ENUM ('created','pending','authorized','captured','failed','expired','refunded','partial_refunded','canceled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_txn_kind AS ENUM ('charge','refund','void','external_card_recorded','cash');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_txn_status AS ENUM ('success','failed','pending','reversed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_channel AS ENUM ('pos','online','both');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.payment_gateway_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid NULL,
  gateway public.payment_gateway NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  credentials_ref text NULL,
  priority int NOT NULL DEFAULT 100,
  allowed_methods public.payment_method[] NOT NULL DEFAULT ARRAY[]::public.payment_method[],
  channel public.payment_channel NOT NULL DEFAULT 'both',
  refund_enabled boolean NOT NULL DEFAULT true,
  offline_tolerance_minutes int NOT NULL DEFAULT 5,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, gateway)
);
CREATE INDEX IF NOT EXISTS idx_pgc_tenant_branch ON public.payment_gateway_configs (tenant_id, branch_id);
ALTER TABLE public.payment_gateway_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pgc_select_same_tenant" ON public.payment_gateway_configs
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "pgc_modify_owner_manager" ON public.payment_gateway_configs
  FOR ALL TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND public.tenant_has_role(tenant_id, 'manager')
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND public.tenant_has_role(tenant_id, 'manager')
  );

CREATE TABLE IF NOT EXISTS public.payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid NULL,
  terminal_id uuid NULL,
  order_id uuid NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'SAR' CHECK (currency = 'SAR'),
  method public.payment_method NOT NULL,
  gateway public.payment_gateway NULL,
  status public.payment_intent_status NOT NULL DEFAULT 'created',
  gateway_intent_id text NULL,
  gateway_reference text NULL,
  idempotency_key text NOT NULL,
  redirect_url text NULL,
  qr_payload text NULL,
  expires_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_pi_tenant_status ON public.payment_intents (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_pi_order ON public.payment_intents (order_id);
CREATE INDEX IF NOT EXISTS idx_pi_pending ON public.payment_intents (status, created_at)
  WHERE status IN ('created','pending','authorized');

ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pi_select_same_tenant" ON public.payment_intents
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "pi_insert_same_tenant" ON public.payment_intents
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "pi_update_owner_manager" ON public.payment_intents
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND public.tenant_has_role(tenant_id, 'manager')
  );

CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid NULL,
  terminal_id uuid NULL,
  intent_id uuid NULL REFERENCES public.payment_intents(id) ON DELETE SET NULL,
  order_id uuid NULL,
  kind public.payment_txn_kind NOT NULL,
  gateway public.payment_gateway NULL,
  method public.payment_method NOT NULL,
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'SAR' CHECK (currency = 'SAR'),
  status public.payment_txn_status NOT NULL,
  gateway_reference text NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ptx_tenant_branch_date ON public.payment_transactions (tenant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ptx_intent ON public.payment_transactions (intent_id);
CREATE INDEX IF NOT EXISTS idx_ptx_order ON public.payment_transactions (order_id);

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ptx_select_same_tenant" ON public.payment_transactions
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "ptx_insert_same_tenant" ON public.payment_transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      kind IN ('charge','cash','external_card_recorded')
      OR public.tenant_has_role(tenant_id, 'manager')
    )
  );

CREATE OR REPLACE FUNCTION public.payment_transactions_block_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'payment_transactions is append-only. Use a new refund/void row instead.'
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_ptx_no_update ON public.payment_transactions;
CREATE TRIGGER trg_ptx_no_update
  BEFORE UPDATE OR DELETE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.payment_transactions_block_mutation();

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  gateway public.payment_gateway NOT NULL,
  event_id text NOT NULL,
  signature_verified boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL,
  processed_at timestamptz NULL,
  error text NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gateway, event_id)
);
CREATE INDEX IF NOT EXISTS idx_pwe_unprocessed ON public.payment_webhook_events (gateway, received_at)
  WHERE processed_at IS NULL;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.payment_reconciliation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  intent_id uuid NOT NULL REFERENCES public.payment_intents(id) ON DELETE CASCADE,
  attempts int NOT NULL DEFAULT 0,
  last_attempt_at timestamptz NULL,
  last_error text NULL,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prj_unresolved ON public.payment_reconciliation_jobs (resolved, last_attempt_at)
  WHERE resolved = false;
ALTER TABLE public.payment_reconciliation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prj_select_same_tenant" ON public.payment_reconciliation_jobs
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP TRIGGER IF EXISTS trg_pgc_updated_at ON public.payment_gateway_configs;
CREATE TRIGGER trg_pgc_updated_at BEFORE UPDATE ON public.payment_gateway_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_pi_updated_at ON public.payment_intents;
CREATE TRIGGER trg_pi_updated_at BEFORE UPDATE ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
