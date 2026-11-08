-- Ensure sales transactions always get a receipt number
CREATE OR REPLACE FUNCTION public.ensure_sales_receipt_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  ts timestamptz;
BEGIN
  IF NEW.receipt_number IS NULL OR NEW.receipt_number = '' THEN
    ts := COALESCE(NEW.created_at, now());
    NEW.receipt_number := 'RCP-' || to_char(ts, 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_transactions_receipt_number ON public.sales_transactions;
CREATE TRIGGER trg_sales_transactions_receipt_number
BEFORE INSERT ON public.sales_transactions
FOR EACH ROW
EXECUTE FUNCTION public.ensure_sales_receipt_number();