-- input_vat_account_for_every_chart
--
-- Expenses with a VAT split post the VAT to 1180 "Input VAT Recoverable" (post_expense_to_ledger,
-- apply_expense_vat_split, resolve_vat_account, post_project_acquisition), but the standard chart
-- (ensure_standard_coa_accounts) never created 1180: on the production copy only one business
-- has it. Everyone else's VAT-split expenses were saved with no ledger entry ("Input VAT account
-- (1180) not found"). Found in the staging QA walk-through.
--
-- Every chart gets 1180 now, and a chart that gets its VAT Payable (2200) account gets 1180 with
-- it, which covers every seeding path. A business that already uses code 1180 for something
-- else is left alone (none on the production copy) and keeps the error.

CREATE OR REPLACE FUNCTION public.ensure_input_vat_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.account_code = '2200' THEN
    INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description, is_system_account)
    VALUES (NEW.tenant_id, '1180', 'Input VAT Recoverable', 'asset', 'VAT paid on purchases and expenses, recoverable from ZATCA', true)
    ON CONFLICT (tenant_id, account_code) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.ensure_input_vat_account() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ensure_input_vat_account ON public.chart_of_accounts;
CREATE TRIGGER trg_ensure_input_vat_account
  AFTER INSERT ON public.chart_of_accounts
  FOR EACH ROW WHEN (NEW.account_code = '2200')
  EXECUTE FUNCTION public.ensure_input_vat_account();

INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, description, is_system_account)
SELECT t.id, '1180', 'Input VAT Recoverable', 'asset', 'VAT paid on purchases and expenses, recoverable from ZATCA', true
FROM tenants t
WHERE EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.tenant_id = t.id)
ON CONFLICT (tenant_id, account_code) DO NOTHING;
