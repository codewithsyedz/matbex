-- Drop the existing constraint and recreate with 'settlement' type included
ALTER TABLE customer_balance_adjustments 
DROP CONSTRAINT IF EXISTS customer_balance_adjustments_adjustment_type_check;

ALTER TABLE customer_balance_adjustments 
ADD CONSTRAINT customer_balance_adjustments_adjustment_type_check 
CHECK (adjustment_type IN ('credit', 'debit', 'correction', 'write_off', 'settlement'));