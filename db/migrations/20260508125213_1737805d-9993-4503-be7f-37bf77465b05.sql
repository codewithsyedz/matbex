
ALTER TABLE public.sales_transactions
  DROP CONSTRAINT IF EXISTS sales_transactions_zatca_clearance_status_check;

ALTER TABLE public.sales_transactions
  ADD CONSTRAINT sales_transactions_zatca_clearance_status_check
  CHECK (
    zatca_clearance_status IS NULL
    OR zatca_clearance_status IN ('PENDING','CLEARED','REPORTED','CLEARED_SIM','REJECTED','SCHEMA_INVALID','NOT_APPLICABLE')
  );
