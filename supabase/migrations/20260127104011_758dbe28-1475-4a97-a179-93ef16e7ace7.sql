-- Add payment tracking columns to tenant_applications
ALTER TABLE public.tenant_applications 
ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending', -- pending, paid, failed
ADD COLUMN IF NOT EXISTS stripe_session_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_tenant_applications_stripe_session ON public.tenant_applications(stripe_session_id);

COMMENT ON COLUMN public.tenant_applications.payment_status IS 'Payment status: pending, paid, failed';
COMMENT ON COLUMN public.tenant_applications.stripe_session_id IS 'Stripe checkout session ID for payment verification';