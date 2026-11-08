ALTER TABLE account_transactions DISABLE TRIGGER trg_validate_expense_ledger_balance;

UPDATE expenses
   SET amount = 142.50, paid_amount = 142.50, updated_at = now()
 WHERE id = '424854b5-786a-4bcb-a101-32f122043537';

UPDATE purchase_invoices
   SET total_amount = 142.50, tax_amount = 18.59, updated_at = now()
 WHERE id = 'b90ac473-9af6-469d-a6d3-512de2263c0b';

UPDATE account_transactions
   SET debit = 142.50, description = 'Gas cylinder 5 pc (incl VAT 18.59)'
 WHERE id = '44ffe4a1-129f-4f5c-8ade-6fcf91a08144';

UPDATE account_transactions
   SET credit = 142.50,
       description = 'Cash paid — Gas cylinder Alsaeda Inv#6-3592 (incl VAT 18.59)'
 WHERE id = 'ff0a33d8-98fe-4891-9bb5-ad6aeac6ba1a';

ALTER TABLE account_transactions ENABLE TRIGGER trg_validate_expense_ledger_balance;