CREATE OR REPLACE FUNCTION public.reverse_daily_sales_posting(p_summary_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_s    RECORD;
  v_line RECORD;
  v_batch_id uuid;
  v_desc text;
  v_count int := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'Reversal reason must be at least 10 characters';
  END IF;

  SELECT * INTO v_s FROM public.daily_sales_summary WHERE id = p_summary_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sales day not found'; END IF;
  IF NOT (public.is_superadmin(v_user)
          OR (v_s.tenant_id = public.get_user_tenant_id(v_user)
              AND (public.tenant_has_role(v_s.tenant_id, 'owner') OR public.tenant_has_role(v_s.tenant_id, 'manager')))) THEN
    RAISE EXCEPTION 'Only owners or managers can reverse a posted sales day';
  END IF;

  v_desc := 'REVERSAL of Day-End sales ' || v_s.sales_date::text || ': ' || p_reason;

  IF EXISTS (
    SELECT 1 FROM public.account_transactions t
     WHERE t.reference_type = 'sale' AND t.reference_id = v_s.id
       AND t.tenant_id = v_s.tenant_id AND COALESCE(t.is_voided,false) = false
       AND NOT EXISTS (SELECT 1 FROM public.account_transactions r
                        WHERE r.original_transaction_id = t.id AND r.reference_type = 'sale_reversal'
                          AND COALESCE(r.is_voided,false) = false)
  ) THEN
    INSERT INTO public.journal_entry_batches (
      tenant_id, branch_id, batch_date, description, reference_number, entry_type,
      journal_type, created_by, is_posted, posted_at, posted_by
    ) VALUES (
      v_s.tenant_id, v_s.branch_id, current_date, v_desc,
      'SALE-REV-' || to_char(now(),'YYYYMMDD') || '-' || substr(v_s.id::text,1,8),
      'reversal', 'reversal', v_user, true, now(), v_user
    ) RETURNING id INTO v_batch_id;

    FOR v_line IN
      SELECT t.* FROM public.account_transactions t
       WHERE t.reference_type = 'sale' AND t.reference_id = v_s.id
         AND t.tenant_id = v_s.tenant_id AND COALESCE(t.is_voided,false) = false
         AND NOT EXISTS (SELECT 1 FROM public.account_transactions r
                          WHERE r.original_transaction_id = t.id AND r.reference_type = 'sale_reversal'
                            AND COALESCE(r.is_voided,false) = false)
    LOOP
      INSERT INTO public.account_transactions
        (tenant_id, account_id, transaction_date, debit, credit, description,
         reference_type, reference_id, created_by, batch_id, branch_id, original_transaction_id)
      VALUES
        (v_line.tenant_id, v_line.account_id, v_line.transaction_date,
         COALESCE(v_line.credit,0), COALESCE(v_line.debit,0), v_desc,
         'sale_reversal', v_line.reference_id, v_user, v_batch_id, v_line.branch_id, v_line.id);
      v_count := v_count + 1;
    END LOOP;
  END IF;

  UPDATE public.daily_sales_summary
     SET ledger_posted = false, ledger_batch_id = NULL, ledger_posted_at = NULL,
         status = 'draft', variance_status = 'pending',
         variance_resolved_at = NULL, variance_resolved_by = NULL, updated_at = now()
   WHERE id = v_s.id;

  RETURN jsonb_build_object('summary_id', v_s.id, 'reversal_batch_id', v_batch_id, 'lines_reversed', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_daily_sales_posting(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_daily_sales_posting(uuid, text) TO authenticated;

-- Reopen-after-adjustment-reversal: ignore sale lines that have already been reversed.
CREATE OR REPLACE FUNCTION public.reopen_day_after_adjustment_reversal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.reversed_at IS NOT NULL AND OLD.reversed_at IS NULL
     AND NEW.scope = 'daily_sales' AND NEW.scope_ref_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.account_transactions t
        WHERE t.reference_id = NEW.scope_ref_id AND COALESCE(t.is_voided,false) = false
          AND t.reference_type NOT LIKE '%\_reversal'
          AND NOT EXISTS (SELECT 1 FROM public.account_transactions r
                           WHERE r.original_transaction_id = t.id AND COALESCE(r.is_voided,false) = false)
     ) THEN
    UPDATE public.daily_sales_summary
       SET status = 'draft', variance_resolved_at = NULL, variance_resolved_by = NULL,
           variance_status = 'pending', updated_at = now()
     WHERE id = NEW.scope_ref_id AND status = 'closed';
  END IF;
  RETURN NEW;
END
$$;