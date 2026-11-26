ALTER TABLE public.zatca_credit_notes
  ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'CREDIT';

ALTER TABLE public.zatca_credit_notes
  DROP CONSTRAINT IF EXISTS zatca_cn_doctype_chk;

ALTER TABLE public.zatca_credit_notes
  ADD CONSTRAINT zatca_cn_doctype_chk CHECK (document_type IN ('CREDIT','DEBIT'));