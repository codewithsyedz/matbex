-- invoice_scans
--
-- Supplier invoices read by AI (server function scan-supplier-invoice): what was scanned, by
-- whom, the draft returned, and the tokens used (for cost tracking and a daily per-restaurant
-- cap). Staff of the restaurant can read their scans; only the server writes them.
CREATE TABLE IF NOT EXISTS public.invoice_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  image_path text NOT NULL,
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'failed')),
  draft jsonb,
  error text,
  input_tokens int,
  output_tokens int,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_scans_restaurant_idx ON public.invoice_scans (restaurant_id, created_at DESC);

ALTER TABLE public.invoice_scans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invoice_scans_restaurant_read" ON public.invoice_scans;
CREATE POLICY "invoice_scans_restaurant_read" ON public.invoice_scans
  FOR SELECT TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));
GRANT SELECT ON public.invoice_scans TO authenticated;
GRANT ALL ON public.invoice_scans TO service_role;
