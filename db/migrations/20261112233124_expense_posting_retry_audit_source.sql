-- expense_posting_retry_audit_source
--
-- post_single_expense (Posting Center: "Post", "Post N eligible", retry) logs its attempts with
-- trigger_source 'retry', which expense_posting_audit's check constraint did not allow. Every
-- single-expense post therefore failed (the success log violated the constraint, and so did the
-- failure log), for every business: no 'retry' row was ever written. Found in the staging QA
-- walk-through: an expense whose first posting failed could not be posted again.

ALTER TABLE public.expense_posting_audit DROP CONSTRAINT IF EXISTS expense_posting_audit_trigger_source_check;
ALTER TABLE public.expense_posting_audit ADD CONSTRAINT expense_posting_audit_trigger_source_check
  CHECK (trigger_source = ANY (ARRAY['manual', 'bulk', 'auto_trigger', 'reconcile_job', 'retry']));
