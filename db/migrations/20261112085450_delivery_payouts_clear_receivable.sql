-- delivery_payouts_clear_receivable
--
-- Delivery-app payouts (Channel P&L -> Settlements, aggregator_settlements) must clear what
-- End of Day booked: post_daily_sales_to_ledger debits delivery sales to 1100 ("Delivery Sales
-- Receivable"; 10,572 SAR on the production copy, never cleared). The old reconcile posting:
--   * credited code 2150, which is "Payroll Payable" in production (it assumed an aggregator
--     clearing account), and defaulted the bank to code 1100 (the receivable itself);
--   * did not book the platform's commission;
--   * used a random batch_id with no journal_entry_batches row, so the ledger's foreign key
--     rejected every reconcile.
-- Now, when a payout is marked reconciled:
--   DR bank (a cash/bank account 1000-1099)      net payout
--   DR Delivery Platform Commissions (6320)       commission
--   CR 1100 Delivery Sales Receivable             gross
-- with gross = net + commission. Platforms match the app's list.

ALTER TABLE public.aggregator_settlements DROP CONSTRAINT IF EXISTS aggregator_settlements_channel_check;
ALTER TABLE public.aggregator_settlements ADD CONSTRAINT aggregator_settlements_channel_check
  CHECK (channel = ANY (ARRAY['hungerstation','jahez','toyou','mrsool','carriage','talabat','uber_eats','other']));
ALTER TABLE public.aggregator_settlements ALTER COLUMN bank_account_code SET DEFAULT '1010';
ALTER TABLE public.aggregator_settlements DROP CONSTRAINT IF EXISTS aggregator_settlements_amounts_add_up;
ALTER TABLE public.aggregator_settlements ADD CONSTRAINT aggregator_settlements_amounts_add_up
  CHECK (abs(gross_amount - commission_amount - net_payout) <= 0.01);

-- The commission expense account: 6320 when it is the commissions account, else any active
-- expense account named for delivery/platform commissions, else a new 6320 (or next free 632x).
CREATE OR REPLACE FUNCTION public.delivery_commission_account(p_tenant_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_code text;
BEGIN
  SELECT id INTO v_id FROM chart_of_accounts
  WHERE tenant_id = p_tenant_id AND is_active AND account_type = 'expense'
    AND account_name ILIKE '%commission%' AND (account_name ILIKE '%deliver%' OR account_name ILIKE '%platform%' OR account_name ILIKE '%aggregator%')
  ORDER BY (account_code = '6320') DESC, account_code
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  SELECT c INTO v_code FROM (SELECT (6320 + g)::text c, g FROM generate_series(0, 9) g) cand
  WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts a WHERE a.tenant_id = p_tenant_id AND a.account_code = cand.c)
  ORDER BY g LIMIT 1;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_CONFIG_ERROR: no free 632x code for Delivery Platform Commissions';
  END IF;
  INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description)
  VALUES (p_tenant_id, v_code, 'Delivery Platform Commissions', 'expense', 'Commission deducted by delivery apps from payouts')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.delivery_commission_account(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.post_aggregator_settlement_reconciled()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_receivable uuid;
  v_bank uuid;
  v_commission uuid;
  v_batch uuid;
  v_actor uuid := COALESCE(auth.uid(), NEW.created_by);
  v_desc text;
BEGIN
  IF NEW.status <> 'reconciled' OR (TG_OP = 'UPDATE' AND OLD.status = 'reconciled') THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_receivable FROM chart_of_accounts
  WHERE tenant_id = NEW.tenant_id AND account_code = '1100' AND is_active LIMIT 1;
  SELECT id INTO v_bank FROM chart_of_accounts
  WHERE tenant_id = NEW.tenant_id AND account_code = NEW.bank_account_code AND is_active
    AND account_type = 'asset' AND account_code BETWEEN '1000' AND '1099' LIMIT 1;
  IF v_receivable IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_CONFIG_ERROR: Delivery Sales Receivable (1100) is missing';
  END IF;
  IF v_bank IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_CONFIG_ERROR: % is not an active cash or bank account (1000-1099)', NEW.bank_account_code;
  END IF;
  IF NEW.commission_amount > 0 THEN
    v_commission := public.delivery_commission_account(NEW.tenant_id);
  END IF;

  v_desc := 'Delivery payout ' || NEW.channel || COALESCE(' ' || NULLIF(NEW.reference, ''), '');
  INSERT INTO journal_entry_batches (tenant_id, batch_date, description, reference_number, entry_type, journal_type,
                                     created_by, is_posted, posted_at, posted_by, approval_status)
  VALUES (NEW.tenant_id, NEW.settlement_date, v_desc, 'DLV-' || left(NEW.id::text, 8), 'sale', 'automatic',
          v_actor, true, now(), v_actor, 'approved')
  RETURNING id INTO v_batch;

  INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, credit, description,
                                    reference_type, reference_id, channel, batch_id, created_by)
  VALUES (NEW.tenant_id, v_bank, NEW.settlement_date, NEW.net_payout, 0, v_desc,
          'aggregator_settlement', NEW.id, NEW.channel, v_batch, v_actor);
  IF NEW.commission_amount > 0 THEN
    INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, credit, description,
                                      reference_type, reference_id, channel, batch_id, created_by)
    VALUES (NEW.tenant_id, v_commission, NEW.settlement_date, NEW.commission_amount, 0, v_desc || ' (commission)',
            'aggregator_settlement', NEW.id, NEW.channel, v_batch, v_actor);
  END IF;
  INSERT INTO account_transactions (tenant_id, account_id, transaction_date, debit, credit, description,
                                    reference_type, reference_id, channel, batch_id, created_by)
  VALUES (NEW.tenant_id, v_receivable, NEW.settlement_date, 0, NEW.gross_amount, v_desc,
          'aggregator_settlement', NEW.id, NEW.channel, v_batch, v_actor);

  NEW.reconciled_at := COALESCE(NEW.reconciled_at, now());
  NEW.reconciled_by := COALESCE(NEW.reconciled_by, auth.uid());
  RETURN NEW;
END;
$function$;
