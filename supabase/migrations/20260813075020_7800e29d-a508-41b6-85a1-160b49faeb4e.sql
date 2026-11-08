CREATE OR REPLACE FUNCTION public.validate_account_type_for_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_type TEXT;
  v_account_name TEXT;
  v_account_code TEXT;
  v_is_partner BOOLEAN := false;
  v_is_vat_liability BOOLEAN := false;
BEGIN
  SELECT account_type, account_name, account_code
  INTO v_account_type, v_account_name, v_account_code
  FROM public.chart_of_accounts
  WHERE id = NEW.account_id;

  -- Owner / partner capital accounts are a legitimate funding source when a
  -- partner settles a company bill from personal funds (DR AP / CR Capital).
  v_is_partner := public.is_partner_funding_account(v_account_code, v_account_name);

  -- Output VAT collected on a sale is a tax liability (2200 VAT Payable) and
  -- must be allowed on sale legs, otherwise VAT stays buried inside revenue.
  v_is_vat_liability := v_account_type = 'liability'
    AND (v_account_code IN ('2200','2201','2210') OR v_account_name ILIKE '%vat%' OR v_account_name ILIKE '%tax payable%');

  IF NEW.reference_type = 'sale' THEN
    IF NOT (v_account_type IN ('revenue', 'asset') OR v_is_vat_liability) THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Sales transactions must post to Revenue, Asset or VAT payable accounts. Account "% - %" is type "%".', v_account_code, v_account_name, v_account_type;
    END IF;
  ELSIF NEW.reference_type = 'expense' THEN
    IF NOT (
      v_account_type IN ('expense', 'asset', 'liability')
      OR (v_account_type = 'equity' AND v_is_partner)
    ) THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Expense transactions must post to Expense, Asset, Liability or partner capital accounts. Account "% - %" is type "%".', v_account_code, v_account_name, v_account_type;
    END IF;
  ELSIF NEW.reference_type = 'customer_balance' THEN
    IF v_account_type NOT IN ('asset', 'revenue') THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Customer balance adjustments must post to Asset (Receivables) or Revenue accounts. Account "% - %" is type "%".', v_account_code, v_account_name, v_account_type;
    END IF;
  ELSIF NEW.reference_type = 'supplier_payment' THEN
    IF NOT (
      v_account_type IN ('liability', 'asset', 'cogs')
      OR (v_account_type = 'equity' AND v_is_partner)
    ) THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Supplier payments must post to Liability (Payables), Asset, COGS or partner capital accounts. Account "% - %" is type "%".', v_account_code, v_account_name, v_account_type;
    END IF;
  ELSIF NEW.reference_type IN ('cogs_consumption', 'cogs_purchase') THEN
    IF v_account_type != 'cogs' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: COGS transactions must post to COGS accounts (5000-5999). Account "% - %" is type "%".', v_account_code, v_account_name, v_account_type;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;