-- A void is recorded as a negative mirror sale (voids_transaction_id set). It is not a new
-- sale, so managers should not get a "New sale recorded" notification for it.
DROP TRIGGER IF EXISTS trg_notify_managers_on_sale ON public.sales_transactions;
CREATE TRIGGER trg_notify_managers_on_sale
  AFTER INSERT ON public.sales_transactions
  FOR EACH ROW
  WHEN (NEW.voids_transaction_id IS NULL)
  EXECUTE FUNCTION public.notify_managers_on_sale();
