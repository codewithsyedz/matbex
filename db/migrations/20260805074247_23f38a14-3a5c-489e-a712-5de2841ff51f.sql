CREATE OR REPLACE FUNCTION public.validate_journal_entry_accounts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_batch RECORD;
  v_account RECORD;
BEGIN
  SELECT * INTO v_batch FROM journal_entry_batches WHERE id = NEW.batch_id;

  IF v_batch IS NULL OR v_batch.journal_type IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_account FROM chart_of_accounts WHERE id = NEW.account_id;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Account not found for transaction.';
  END IF;

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

    -- DEBIT should be Expense / COGS, OR a liability account (settlement of Accounts Payable)
    IF NEW.debit IS NOT NULL AND NEW.debit > 0 THEN
      IF NOT (
        v_account.account_type = 'expense' OR
        v_account.account_type = 'cogs' OR
        v_account.account_type = 'liability' OR
        (v_account.account_code >= '5000' AND v_account.account_code < '7000') OR
        (v_account.account_code >= '2000' AND v_account.account_code < '3000')
      ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Expense debit entries should use Expense (6000-6999), COGS (5000-5999), or Accounts Payable (2000-2999) accounts. Account "% - %" is type "%".',
          v_account.account_code, v_account.account_name, v_account.account_type;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;