
-- 0) Tenant-level role helper (any restaurant in tenant)
CREATE OR REPLACE FUNCTION public.has_tenant_role(_user_id uuid, _tenant_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.restaurants r ON r.id = ur.restaurant_id
    WHERE ur.user_id = _user_id
      AND r.tenant_id = _tenant_id
      AND ur.role = _role
  )
$$;

-- 1) Channel tag on ledger
ALTER TABLE public.account_transactions
  ADD COLUMN IF NOT EXISTS channel text;
CREATE INDEX IF NOT EXISTS idx_account_transactions_channel
  ON public.account_transactions(channel) WHERE channel IS NOT NULL;

-- 2) Idempotent system-account seeder
CREATE OR REPLACE FUNCTION public.ensure_aggregator_accounts(_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.chart_of_accounts (tenant_id, account_code, account_name, account_type, is_system_account, description)
  VALUES
    (_tenant_id, '2150', 'Aggregator Clearing',         'liability', true, 'Receivable from delivery aggregators awaiting payout'),
    (_tenant_id, '4010', 'Aggregator Sales',            'revenue',   true, 'Net sales from delivery aggregators'),
    (_tenant_id, '6300', 'Commission Expense - Aggregators', 'expense', true, 'Commission paid to delivery aggregators')
  ON CONFLICT (tenant_id, account_code) DO NOTHING;
END;
$$;

-- 3) Trigger: aggregator order paid -> ledger
CREATE OR REPLACE FUNCTION public.post_aggregator_order_paid()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_clearing  uuid;
  v_revenue   uuid;
  v_commission uuid;
  v_gross     numeric(15,2);
  v_commission_amt numeric(15,2);
  v_net       numeric(15,2);
  v_batch     uuid := gen_random_uuid();
BEGIN
  IF NEW.channel NOT IN ('hungerstation','jahez','mrsool','talabat') THEN RETURN NEW; END IF;
  IF NEW.payment_status <> 'paid' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.payment_status = 'paid' THEN RETURN NEW; END IF;

  SELECT tenant_id INTO v_tenant_id FROM public.restaurants WHERE id = NEW.restaurant_id;
  IF v_tenant_id IS NULL THEN RETURN NEW; END IF;

  PERFORM public.ensure_aggregator_accounts(v_tenant_id);

  SELECT id INTO v_clearing   FROM public.chart_of_accounts WHERE tenant_id = v_tenant_id AND account_code = '2150';
  SELECT id INTO v_revenue    FROM public.chart_of_accounts WHERE tenant_id = v_tenant_id AND account_code = '4010';
  SELECT id INTO v_commission FROM public.chart_of_accounts WHERE tenant_id = v_tenant_id AND account_code = '6300';

  v_gross := COALESCE(NEW.total, 0);
  v_commission_amt := COALESCE(NEW.commission_amount, 0);
  v_net := v_gross - v_commission_amt;
  IF v_gross <= 0 THEN RETURN NEW; END IF;

  INSERT INTO public.account_transactions
    (tenant_id, account_id, transaction_date, debit, credit, description, reference_type, reference_id, channel, batch_id)
  VALUES
    (v_tenant_id, v_clearing, CURRENT_DATE, v_gross, 0,
     'Aggregator order #'||NEW.order_number||' ('||NEW.channel||')',
     'aggregator_order', NEW.id, NEW.channel, v_batch);

  IF v_net > 0 THEN
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description, reference_type, reference_id, channel, batch_id)
    VALUES
      (v_tenant_id, v_revenue, CURRENT_DATE, 0, v_net,
       'Aggregator sale #'||NEW.order_number||' ('||NEW.channel||')',
       'aggregator_order', NEW.id, NEW.channel, v_batch);
  END IF;

  IF v_commission_amt > 0 THEN
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description, reference_type, reference_id, channel, batch_id)
    VALUES
      (v_tenant_id, v_commission, CURRENT_DATE, v_commission_amt, 0,
       'Commission #'||NEW.order_number||' ('||NEW.channel||')',
       'aggregator_order', NEW.id, NEW.channel, v_batch);
    INSERT INTO public.account_transactions
      (tenant_id, account_id, transaction_date, debit, credit, description, reference_type, reference_id, channel, batch_id)
    VALUES
      (v_tenant_id, v_clearing, CURRENT_DATE, 0, v_commission_amt,
       'Commission accrual #'||NEW.order_number||' ('||NEW.channel||')',
       'aggregator_order', NEW.id, NEW.channel, v_batch);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_aggregator_order_paid ON public.online_orders;
CREATE TRIGGER trg_post_aggregator_order_paid
  AFTER INSERT OR UPDATE OF payment_status ON public.online_orders
  FOR EACH ROW EXECUTE FUNCTION public.post_aggregator_order_paid();

-- 4) Settlements table
CREATE TABLE IF NOT EXISTS public.aggregator_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('hungerstation','jahez','mrsool','talabat')),
  settlement_date date NOT NULL,
  gross_amount numeric(12,2) NOT NULL CHECK (gross_amount >= 0),
  commission_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
  net_payout numeric(12,2) NOT NULL CHECK (net_payout >= 0),
  reference text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reconciled','disputed')),
  notes text,
  bank_account_code text NOT NULL DEFAULT '1100',
  created_by uuid,
  reconciled_by uuid,
  reconciled_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.aggregator_settlements TO authenticated;
GRANT ALL ON public.aggregator_settlements TO service_role;

ALTER TABLE public.aggregator_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read settlements"
  ON public.aggregator_settlements FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Owners managers insert settlements"
  ON public.aggregator_settlements FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
      OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role))
  );

CREATE POLICY "Owners managers update settlements"
  ON public.aggregator_settlements FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
      OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role))
  );

CREATE POLICY "Owners delete settlements"
  ON public.aggregator_settlements FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
  );

CREATE INDEX idx_aggregator_settlements_tenant ON public.aggregator_settlements(tenant_id);
CREATE INDEX idx_aggregator_settlements_status ON public.aggregator_settlements(status) WHERE deleted_at IS NULL;

-- 5) Settlement reconciliation trigger
CREATE OR REPLACE FUNCTION public.post_aggregator_settlement_reconciled()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_clearing uuid;
  v_bank     uuid;
  v_batch    uuid := gen_random_uuid();
BEGIN
  IF NEW.status <> 'reconciled' OR (TG_OP = 'UPDATE' AND OLD.status = 'reconciled') THEN
    RETURN NEW;
  END IF;

  PERFORM public.ensure_aggregator_accounts(NEW.tenant_id);

  SELECT id INTO v_clearing FROM public.chart_of_accounts WHERE tenant_id = NEW.tenant_id AND account_code = '2150';
  SELECT id INTO v_bank     FROM public.chart_of_accounts WHERE tenant_id = NEW.tenant_id AND account_code = NEW.bank_account_code;

  IF v_bank IS NULL OR v_clearing IS NULL THEN
    RAISE EXCEPTION 'Missing chart accounts for settlement (clearing=%, bank=%)', v_clearing, v_bank;
  END IF;

  INSERT INTO public.account_transactions
    (tenant_id, account_id, transaction_date, debit, credit, description, reference_type, reference_id, channel, batch_id)
  VALUES
    (NEW.tenant_id, v_bank, NEW.settlement_date, NEW.net_payout, 0,
     'Aggregator payout '||NEW.channel||' '||COALESCE(NEW.reference,''),
     'aggregator_settlement', NEW.id, NEW.channel, v_batch),
    (NEW.tenant_id, v_clearing, NEW.settlement_date, 0, NEW.net_payout,
     'Aggregator payout '||NEW.channel||' '||COALESCE(NEW.reference,''),
     'aggregator_settlement', NEW.id, NEW.channel, v_batch);

  NEW.reconciled_at := COALESCE(NEW.reconciled_at, now());
  NEW.reconciled_by := COALESCE(NEW.reconciled_by, auth.uid());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_aggregator_settlement ON public.aggregator_settlements;
CREATE TRIGGER trg_post_aggregator_settlement
  BEFORE INSERT OR UPDATE OF status ON public.aggregator_settlements
  FOR EACH ROW EXECUTE FUNCTION public.post_aggregator_settlement_reconciled();

CREATE TRIGGER trg_aggregator_settlements_updated_at
  BEFORE UPDATE ON public.aggregator_settlements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6) Reporting view
CREATE OR REPLACE VIEW public.v_channel_profitability AS
SELECT
  at.tenant_id,
  COALESCE(at.channel, 'direct') AS channel,
  at.transaction_date,
  COA.account_code,
  COA.account_type,
  SUM(at.debit)  AS total_debit,
  SUM(at.credit) AS total_credit
FROM public.account_transactions at
JOIN public.chart_of_accounts COA ON COA.id = at.account_id
WHERE at.is_voided = false
  AND at.channel IS NOT NULL
  AND COA.account_code IN ('4010','6300','2150')
GROUP BY at.tenant_id, COALESCE(at.channel, 'direct'), at.transaction_date, COA.account_code, COA.account_type;

GRANT SELECT ON public.v_channel_profitability TO authenticated;

-- 7) Feature flag
INSERT INTO public.feature_flags (key, enabled, description)
VALUES ('channel_pnl_enabled', true, 'Aggregator channel profitability report and settlement reconciliation')
ON CONFLICT (key) DO NOTHING;
