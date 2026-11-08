CREATE OR REPLACE FUNCTION public.reopen_day_after_adjustment_reversal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.reversed_at IS NOT NULL AND OLD.reversed_at IS NULL
     AND NEW.scope = 'daily_sales' AND NEW.scope_ref_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.account_transactions
                      WHERE reference_id = NEW.scope_ref_id AND COALESCE(is_voided,false) = false) THEN
    UPDATE public.daily_sales_summary
       SET status = 'draft', variance_resolved_at = NULL, variance_resolved_by = NULL,
           variance_status = 'pending', updated_at = now()
     WHERE id = NEW.scope_ref_id AND status = 'closed';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_reopen_day_after_adjustment_reversal ON public.day_end_adjustments;
CREATE TRIGGER trg_reopen_day_after_adjustment_reversal
AFTER UPDATE OF reversed_at ON public.day_end_adjustments
FOR EACH ROW EXECUTE FUNCTION public.reopen_day_after_adjustment_reversal();