-- card_clearing_account_for_every_chart
--
-- End of Day debits card sales to 1015 "Card Settlements Receivable" and the card payout screen
-- (post_card_settlement_deposit) clears it into the bank net of fees. The standard chart new
-- businesses get did not include 1015, so their card sales went straight into the bank
-- (post_daily_sales_to_ledger falls back to 1010): the bank never matches the statement (payouts
-- arrive later, less fees) and the payout screen cannot be used. Found while adding month-end
-- reminders (2026-11-14): QA Test Kitchen and Starter Walkthrough lacked it.
--
-- Every chart gets 1015 now; a chart that gets its main bank account (1010) gets 1015 with it.

CREATE OR REPLACE FUNCTION public.ensure_card_clearing_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.account_code = '1010' THEN
    INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description, is_system_account)
    VALUES (NEW.tenant_id, '1015', 'Card Settlements Receivable', 'asset',
            'Card sales waiting for the payment provider''s payout; cleared when the payout reaches the bank', true)
    ON CONFLICT (tenant_id, account_code) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.ensure_card_clearing_account() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ensure_card_clearing_account ON public.chart_of_accounts;
CREATE TRIGGER trg_ensure_card_clearing_account
  AFTER INSERT ON public.chart_of_accounts
  FOR EACH ROW WHEN (NEW.account_code = '1010')
  EXECUTE FUNCTION public.ensure_card_clearing_account();

INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description, is_system_account)
SELECT t.id, '1015', 'Card Settlements Receivable', 'asset',
       'Card sales waiting for the payment provider''s payout; cleared when the payout reaches the bank', true
FROM tenants t
WHERE EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.tenant_id = t.id)
ON CONFLICT (tenant_id, account_code) DO NOTHING;
