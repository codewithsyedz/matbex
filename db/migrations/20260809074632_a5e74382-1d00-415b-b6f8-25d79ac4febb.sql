CREATE OR REPLACE FUNCTION public.validate_journal_entry_accounts()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batch RECORD;
  v_account RECORD;
  v_other RECORD;
  v_is_partner boolean;
  v_is_fixed_asset boolean;
  v_capex_allowed boolean;
  v_is_input_vat boolean;
BEGIN
  SELECT * INTO v_batch FROM journal_entry_batches WHERE id = NEW.batch_id;

  IF v_batch IS NULL OR v_batch.journal_type IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_account FROM chart_of_accounts WHERE id = NEW.account_id;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Account not found for transaction.';
  END IF;

  -- Recoverable / input VAT sits in assets but is a valid leg on purchase & expense entries
  v_is_input_vat := (v_account.account_code IN ('1180','1181','1182'))
    OR (v_account.account_name ~* 'input vat' OR v_account.account_name ~* 'vat recoverable');

  IF v_batch.journal_type = 'purchase' THEN
    IF v_account.account_code >= '1200' AND v_account.account_code < '1300' THEN
      IF NEW.credit IS NOT NULL AND NEW.credit > 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Purchases increase Inventory. Inventory accounts (1200-1299) must be DEBITED, not credited. Use a CONSUMPTION entry to reduce inventory.';
      END IF;
    ELSIF v_account.account_type = 'cogs' OR (v_account.account_code >= '5000' AND v_account.account_code < '6000') THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Purchases should not hit COGS accounts (5000-5999). Purchase entries post to Inventory (1200-1299). To recognize cost, use a CONSUMPTION entry.';
    ELSIF NEW.credit IS NOT NULL AND NEW.credit > 0 THEN
      IF NOT (
        (v_account.account_code >= '1000' AND v_account.account_code < '1200') OR
        (v_account.account_code >= '2000' AND v_account.account_code < '3000')
      ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Purchase credit entries must use Cash (1000-1199) or Accounts Payable (2000-2999). Account "% - %" is not valid for purchase credits.', v_account.account_code, v_account.account_name;
      END IF;
    END IF;

  ELSIF v_batch.journal_type = 'consumption' THEN
    IF NEW.debit IS NOT NULL AND NEW.debit > 0 THEN
      IF NOT (v_account.account_type = 'cogs' OR (v_account.account_code >= '5000' AND v_account.account_code < '6000')) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: COGS/Consumption entries must DEBIT a COGS account (5000-5999). Account "% - %" is type "%". Consumption moves value from Inventory to Cost.',
          v_account.account_code, v_account.account_name, v_account.account_type;
      END IF;
    END IF;

    IF NEW.credit IS NOT NULL AND NEW.credit > 0 THEN
      IF NOT (v_account.account_code >= '1200' AND v_account.account_code < '1300') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: COGS/Consumption entries must CREDIT an Inventory account (1200-1299). Account "% - %" is not an Inventory account. Consumption reduces inventory value.',
          v_account.account_code, v_account.account_name;
      END IF;
    END IF;

  ELSIF v_batch.journal_type = 'sale' THEN
    IF v_account.account_code >= '1200' AND v_account.account_code < '1300' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Sales entries must not include Inventory accounts (1200-1299). Use CONSUMPTION entries to recognize COGS separately from revenue.';
    END IF;

    IF v_account.account_type = 'cogs' OR (v_account.account_code >= '5000' AND v_account.account_code < '6000') THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Sales entries must not include COGS accounts (5000-5999). Use CONSUMPTION entries to recognize cost of goods sold.';
    END IF;

    IF NEW.debit IS NOT NULL AND NEW.debit > 0 THEN
      IF NOT (v_account.account_code >= '1000' AND v_account.account_code < '1200') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Sales debit entries must use Cash, Bank, or Accounts Receivable (1000-1199). Account "% - %" is not valid.', v_account.account_code, v_account.account_name;
      END IF;
    END IF;

    IF NEW.credit IS NOT NULL AND NEW.credit > 0 THEN
      IF NOT (
        (v_account.account_code >= '4000' AND v_account.account_code < '5000') OR
        (v_account.account_code >= '2000' AND v_account.account_code < '3000')
      ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Sales credit entries must use Revenue (4000-4999) or Liability accounts (for VAT). Account "% - %" is not valid.', v_account.account_code, v_account.account_name;
      END IF;
    END IF;

  ELSIF v_batch.journal_type = 'expense' THEN
    IF v_account.account_code >= '1200' AND v_account.account_code < '1300' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Expense entries should not use Inventory accounts (1200-1299). For inventory purchases, use PURCHASE entry type.';
    END IF;

    IF NEW.debit IS NOT NULL AND NEW.debit > 0 THEN
      IF NOT (
        v_is_input_vat OR
        v_account.account_type = 'expense' OR
        v_account.account_type = 'cogs' OR
        v_account.account_type = 'liability' OR
        (v_account.account_code >= '5000' AND v_account.account_code < '7000') OR
        (v_account.account_code >= '2000' AND v_account.account_code < '3000')
      ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Expense debit entries should use Expense (6000-6999), COGS (5000-5999), Accounts Payable (2000-2999) or Input VAT Recoverable (1180) accounts. Account "% - %" is type "%".',
          v_account.account_code, v_account.account_name, v_account.account_type;
      END IF;
    END IF;
  END IF;

  v_is_partner := public.is_partner_funding_account(v_account.account_code, v_account.account_name);

  IF v_is_partner AND v_account.account_type NOT IN ('liability', 'equity') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: "% - %" is a partner loan/capital account but is classified as "%". Partner funding must sit in a liability (loan) or equity (capital) account — it can never be booked as revenue or income.',
      v_account.account_code, v_account.account_name, v_account.account_type;
  END IF;

  IF v_is_partner THEN
    SELECT t.id, coa.account_code, coa.account_name
      INTO v_other
      FROM account_transactions t
      JOIN chart_of_accounts coa ON coa.id = t.account_id
     WHERE t.batch_id = NEW.batch_id
       AND t.id <> NEW.id
       AND coalesce(t.is_voided, false) = false
       AND (coa.account_type = 'revenue' OR (coa.account_code >= '4000' AND coa.account_code < '5000'))
     LIMIT 1;

    IF v_other.id IS NOT NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Partner funding account "% - %" cannot be recorded in the same journal entry as revenue account "% - %". A partner loan or capital injection is financing, not sales income — post it against Cash/Bank and the partner loan or capital account only.',
        v_account.account_code, v_account.account_name, v_other.account_code, v_other.account_name;
    END IF;
  END IF;

  IF (v_account.account_type = 'revenue' OR (v_account.account_code >= '4000' AND v_account.account_code < '5000')) THEN
    SELECT t.id, coa.account_code, coa.account_name
      INTO v_other
      FROM account_transactions t
      JOIN chart_of_accounts coa ON coa.id = t.account_id
     WHERE t.batch_id = NEW.batch_id
       AND t.id <> NEW.id
       AND coalesce(t.is_voided, false) = false
       AND public.is_partner_funding_account(coa.account_code, coa.account_name)
     LIMIT 1;

    IF v_other.id IS NOT NULL THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: Revenue account "% - %" cannot be recorded in the same journal entry as partner funding account "% - %". Partner loans and capital injections must never increase revenue.',
        v_account.account_code, v_account.account_name, v_other.account_code, v_other.account_name;
    END IF;
  END IF;

  v_is_fixed_asset := coalesce(v_account.is_fixed_asset_account, false)
    OR (v_account.account_code >= '1500' AND v_account.account_code < '1600');

  IF v_is_fixed_asset AND NEW.debit IS NOT NULL AND NEW.debit > 0 THEN
    v_capex_allowed :=
      v_batch.journal_type IN ('opening_balance', 'adjustment', 'correction', 'reversal')
      OR v_batch.project_id IS NOT NULL
      OR coalesce(v_batch.reference_number, '') ~* '^(FA|CIP|ACQ|DEP|DISP|INST)[-_]';

    IF NOT v_capex_allowed THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: "% - %" is a fixed asset account and cannot be debited from a "%" entry. Capital purchases must be recorded through the Fixed Asset Register (or a project / cost-centre acquisition) so the asset, capitalisation threshold and depreciation schedule are created. If this spend is below the capitalisation threshold, post it to an expense account (6000-6999) instead.',
        v_account.account_code, v_account.account_name, v_batch.journal_type;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;