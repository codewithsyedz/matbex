
CREATE TABLE IF NOT EXISTS public.zatca_clearance_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  restaurant_id uuid,
  sales_transaction_id uuid NOT NULL UNIQUE REFERENCES public.sales_transactions(id) ON DELETE CASCADE,
  device_id uuid,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 8,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error text,
  last_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zatca_queue_due
  ON public.zatca_clearance_queue (next_attempt_at, locked_until);

ALTER TABLE public.zatca_clearance_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zatca_queue_tenant_read"
  ON public.zatca_clearance_queue
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "zatca_queue_tenant_modify"
  ON public.zatca_clearance_queue
  FOR ALL TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id))
  WITH CHECK (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE TRIGGER trg_zatca_queue_set_updated_at
  BEFORE UPDATE ON public.zatca_clearance_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.zatca_sync_clearance_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  done boolean;
BEGIN
  done := NEW.zatca_clearance_status IN ('CLEARED','REPORTED','CLEARED_SIM');

  IF NEW.zatca_signed_xml_url IS NOT NULL AND NOT done THEN
    INSERT INTO public.zatca_clearance_queue (
      tenant_id, restaurant_id, sales_transaction_id, device_id,
      next_attempt_at, last_status
    )
    VALUES (
      NEW.tenant_id, NEW.restaurant_id, NEW.id, NEW.zatca_device_id,
      now(), COALESCE(NEW.zatca_clearance_status, 'PENDING')
    )
    ON CONFLICT (sales_transaction_id) DO UPDATE
      SET last_status = EXCLUDED.last_status,
          updated_at = now();
  ELSIF done THEN
    DELETE FROM public.zatca_clearance_queue
      WHERE sales_transaction_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zatca_sync_clearance_queue ON public.sales_transactions;
CREATE TRIGGER trg_zatca_sync_clearance_queue
  AFTER INSERT OR UPDATE OF zatca_signed_xml_url, zatca_clearance_status
  ON public.sales_transactions
  FOR EACH ROW EXECUTE FUNCTION public.zatca_sync_clearance_queue();

CREATE OR REPLACE FUNCTION public.zatca_claim_clearance_jobs(_limit int, _lock_seconds int DEFAULT 60)
RETURNS TABLE (
  id uuid,
  sales_transaction_id uuid,
  attempts int,
  max_attempts int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT q.id
    FROM public.zatca_clearance_queue q
    WHERE q.next_attempt_at <= now()
      AND (q.locked_until IS NULL OR q.locked_until < now())
      AND q.attempts < q.max_attempts
    ORDER BY q.next_attempt_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT _limit
  )
  UPDATE public.zatca_clearance_queue q
     SET locked_until = now() + make_interval(secs => _lock_seconds),
         attempts = q.attempts + 1,
         updated_at = now()
    FROM due
   WHERE q.id = due.id
  RETURNING q.id, q.sales_transaction_id, q.attempts, q.max_attempts;
END;
$$;
