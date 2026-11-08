-- Create enum for account types
CREATE TYPE public.account_type AS ENUM ('asset', 'liability', 'equity', 'revenue', 'cogs', 'expense');

-- Create Chart of Accounts table
CREATE TABLE public.chart_of_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_code VARCHAR(10) NOT NULL,
  account_name VARCHAR(100) NOT NULL,
  account_type public.account_type NOT NULL,
  parent_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  description TEXT,
  is_system_account BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  balance NUMERIC(15,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Enforce unique account codes per tenant
  CONSTRAINT unique_account_code_per_tenant UNIQUE (tenant_id, account_code),
  
  -- Enforce account code ranges based on type
  CONSTRAINT valid_account_code_range CHECK (
    (account_type = 'asset' AND account_code >= '1000' AND account_code < '2000') OR
    (account_type = 'liability' AND account_code >= '2000' AND account_code < '3000') OR
    (account_type = 'equity' AND account_code >= '3000' AND account_code < '4000') OR
    (account_type = 'revenue' AND account_code >= '4000' AND account_code < '5000') OR
    (account_type = 'cogs' AND account_code >= '5000' AND account_code < '6000') OR
    (account_type = 'expense' AND account_code >= '6000' AND account_code < '7000')
  )
);

-- Create index for faster lookups
CREATE INDEX idx_coa_tenant_id ON public.chart_of_accounts(tenant_id);
CREATE INDEX idx_coa_account_type ON public.chart_of_accounts(account_type);
CREATE INDEX idx_coa_parent_id ON public.chart_of_accounts(parent_id);

-- Create transactions reference table (to track if accounts have transactions)
CREATE TABLE public.account_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  debit NUMERIC(15,2) DEFAULT 0,
  credit NUMERIC(15,2) DEFAULT 0,
  description TEXT,
  reference_type VARCHAR(50),
  reference_id UUID,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_account_transactions_account ON public.account_transactions(account_id);
CREATE INDEX idx_account_transactions_tenant ON public.account_transactions(tenant_id);
CREATE INDEX idx_account_transactions_date ON public.account_transactions(transaction_date);

-- Enable RLS
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_transactions ENABLE ROW LEVEL SECURITY;

-- RLS policies for chart_of_accounts
CREATE POLICY "Users can view their tenant's accounts"
ON public.chart_of_accounts
FOR SELECT
USING (
  public.is_superadmin(auth.uid()) OR
  public.user_belongs_to_tenant(auth.uid(), tenant_id)
);

CREATE POLICY "Owners/Managers can insert accounts"
ON public.chart_of_accounts
FOR INSERT
WITH CHECK (
  public.is_superadmin(auth.uid()) OR
  public.tenant_has_role(tenant_id, 'manager')
);

CREATE POLICY "Owners/Managers can update accounts"
ON public.chart_of_accounts
FOR UPDATE
USING (
  public.is_superadmin(auth.uid()) OR
  public.tenant_has_role(tenant_id, 'manager')
);

CREATE POLICY "Owners can delete accounts without transactions"
ON public.chart_of_accounts
FOR DELETE
USING (
  (public.is_superadmin(auth.uid()) OR public.tenant_has_role(tenant_id, 'owner'))
  AND NOT EXISTS (
    SELECT 1 FROM public.account_transactions at WHERE at.account_id = id
  )
);

-- RLS policies for account_transactions
CREATE POLICY "Users can view their tenant's transactions"
ON public.account_transactions
FOR SELECT
USING (
  public.is_superadmin(auth.uid()) OR
  public.user_belongs_to_tenant(auth.uid(), tenant_id)
);

CREATE POLICY "Owners/Managers can insert transactions"
ON public.account_transactions
FOR INSERT
WITH CHECK (
  public.is_superadmin(auth.uid()) OR
  public.tenant_has_role(tenant_id, 'manager')
);

-- Function to check if account has transactions
CREATE OR REPLACE FUNCTION public.account_has_transactions(_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_transactions
    WHERE account_id = _account_id
  )
$$;

-- Trigger to update account balance
CREATE OR REPLACE FUNCTION public.update_account_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.chart_of_accounts
  SET balance = balance + COALESCE(NEW.debit, 0) - COALESCE(NEW.credit, 0),
      updated_at = now()
  WHERE id = NEW.account_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_account_balance
AFTER INSERT ON public.account_transactions
FOR EACH ROW
EXECUTE FUNCTION public.update_account_balance();

-- Trigger to update updated_at
CREATE TRIGGER update_chart_of_accounts_updated_at
BEFORE UPDATE ON public.chart_of_accounts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();