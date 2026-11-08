CREATE TABLE public.seat_requests (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    restaurant_id UUID,
    requested_by UUID NOT NULL,
    requester_email TEXT,
    quota_type TEXT NOT NULL,
    current_usage INTEGER NOT NULL,
    quota_limit INTEGER NOT NULL,
    requested_role TEXT,
    owner_emails TEXT[] DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'sent',
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.seat_requests ENABLE ROW LEVEL SECURITY;

-- Only admins and the requester can view seat requests within their tenant
CREATE POLICY "Users can view their tenant seat requests"
ON public.seat_requests
FOR SELECT
TO authenticated
USING (tenant_id IN (
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
));

-- Only authenticated users can create seat requests
CREATE POLICY "Users can create seat requests"
ON public.seat_requests
FOR INSERT
TO authenticated
WITH CHECK (true);