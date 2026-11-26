ALTER TABLE public.failed_sync_items
  ADD COLUMN IF NOT EXISTS input_payload JSONB,
  ADD COLUMN IF NOT EXISTS validation_errors JSONB,
  ADD COLUMN IF NOT EXISTS last_attempt JSONB,
  ADD COLUMN IF NOT EXISTS error_category TEXT;

UPDATE public.failed_sync_items
   SET error_category = public.classify_dlq_error(error_message)
 WHERE error_category IS NULL;

CREATE INDEX IF NOT EXISTS idx_failed_sync_items_category
  ON public.failed_sync_items (tenant_id, error_category, created_at DESC)
  WHERE error_category IS NOT NULL;

-- Auto-fill error_category on insert/update so classify never falls behind
CREATE OR REPLACE FUNCTION public.set_failed_sync_item_category()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.error_category IS NULL AND NEW.error_message IS NOT NULL THEN
    NEW.error_category := public.classify_dlq_error(NEW.error_message);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_failed_sync_item_category ON public.failed_sync_items;
CREATE TRIGGER trg_set_failed_sync_item_category
  BEFORE INSERT OR UPDATE OF error_message ON public.failed_sync_items
  FOR EACH ROW EXECUTE FUNCTION public.set_failed_sync_item_category();