-- Create login_attempts table for tracking and rate limiting
CREATE TABLE public.login_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  failure_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for efficient querying
CREATE INDEX idx_login_attempts_email ON public.login_attempts(email);
CREATE INDEX idx_login_attempts_created_at ON public.login_attempts(created_at);
CREATE INDEX idx_login_attempts_ip ON public.login_attempts(ip_address);

-- Create account_locks table
CREATE TABLE public.account_locks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  locked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  locked_until TIMESTAMP WITH TIME ZONE NOT NULL,
  lock_reason TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  unlocked_at TIMESTAMP WITH TIME ZONE,
  unlocked_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_account_locks_email ON public.account_locks(email);

-- Enable RLS
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_locks ENABLE ROW LEVEL SECURITY;

-- RLS policies for login_attempts (SuperAdmin only for viewing, system can insert)
CREATE POLICY "SuperAdmins can view login attempts"
  ON public.login_attempts FOR SELECT
  USING (is_superadmin(auth.uid()));

CREATE POLICY "System can insert login attempts"
  ON public.login_attempts FOR INSERT
  WITH CHECK (true);

-- RLS policies for account_locks
CREATE POLICY "SuperAdmins can manage account locks"
  ON public.account_locks FOR ALL
  USING (is_superadmin(auth.uid()));

CREATE POLICY "System can insert account locks"
  ON public.account_locks FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update account locks"
  ON public.account_locks FOR UPDATE
  USING (true);