CREATE TABLE public.capital_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  capital_account_id uuid NOT NULL REFERENCES public.owner_capital_accounts(id) ON DELETE CASCADE,
  branch_id uuid,
  statement_date date NOT NULL,
  description text,
  reference text,
  amount numeric(14,2) NOT NULL,
  direction text NOT NULL DEFAULT 'credit' CHECK (direction IN ('credit','debit')),
  match_status text NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched','matched','ignored')),
  matched_movement_id uuid REFERENCES public.capital_movements(id) ON DELETE SET NULL,
  matched_by uuid,
  matched_at timestamptz,
  notes text,
  imported_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_capital_statement_lines_acct ON public.capital_statement_lines(capital_account_id, statement_date);
CREATE INDEX idx_capital_statement_lines_tenant ON public.capital_statement_lines(tenant_id, statement_date);
CREATE UNIQUE INDEX uq_capital_statement_lines_movement ON public.capital_statement_lines(matched_movement_id) WHERE matched_movement_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.capital_statement_lines TO authenticated;
GRANT ALL ON public.capital_statement_lines TO service_role;

ALTER TABLE public.capital_statement_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Capital managers can read statement lines"
ON public.capital_statement_lines FOR SELECT TO authenticated
USING (public.can_manage_capital(tenant_id));

CREATE POLICY "Capital managers can insert statement lines"
ON public.capital_statement_lines FOR INSERT TO authenticated
WITH CHECK (public.can_manage_capital(tenant_id));

CREATE POLICY "Capital managers can update statement lines"
ON public.capital_statement_lines FOR UPDATE TO authenticated
USING (public.can_manage_capital(tenant_id))
WITH CHECK (public.can_manage_capital(tenant_id));

CREATE POLICY "Capital managers can delete statement lines"
ON public.capital_statement_lines FOR DELETE TO authenticated
USING (public.can_manage_capital(tenant_id));

CREATE TRIGGER trg_capital_statement_lines_updated_at
BEFORE UPDATE ON public.capital_statement_lines
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();