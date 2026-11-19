DROP TRIGGER IF EXISTS trg_auto_post_expense_on_approval_ins ON public.expenses;
DROP TRIGGER IF EXISTS trg_auto_post_expense_on_approval_upd ON public.expenses;

COMMENT ON FUNCTION public.approve_expense_for_ai_posting(uuid) IS
  'Approval gateway for expenses. Client approval workflows must call this before generate-expense-journal; legacy account-based approval triggers are intentionally disabled so AI selects the debit account before deterministic posting.';