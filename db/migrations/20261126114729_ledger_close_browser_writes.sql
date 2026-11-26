-- Ledger integrity, phase B (docs/plans/ledger-integrity.md): browsers no longer write the ledger.
--
-- Manual journal entries are posted, voided and reversed by /api/v1/ledger/* (server/src/modules/
-- ledger), which checks balance, accounts, branch and period in one transaction. Before this,
-- the browser inserted a posted batch and then its lines in a second request, checked balance
-- only client-side, and "rolled back" a failed second request by deleting the batch.
--
-- Every other ledger write already goes through SECURITY DEFINER functions (posting functions,
-- submit/approve/reject_journal_entry, void_transaction), which run as the table owner and are
-- not affected. Reads (RLS SELECT policies) are unchanged.

DROP POLICY IF EXISTS "Authorized roles can insert transactions" ON public.account_transactions;
DROP POLICY IF EXISTS "Authorized roles can create journal batches" ON public.journal_entry_batches;
DROP POLICY IF EXISTS "Authorized roles can update journal batches" ON public.journal_entry_batches;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.account_transactions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.journal_entry_batches FROM anon, authenticated;
