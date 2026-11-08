CREATE OR REPLACE FUNCTION public.post_daily_sales_to_ledger_integrity_hook()
RETURNS void LANGUAGE sql AS $$ SELECT 1; $$;
DROP FUNCTION public.post_daily_sales_to_ledger_integrity_hook();

DO $do$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'post_daily_sales_to_ledger';

  IF v_src IS NOT NULL AND position('check_sale_posting_vat_integrity' in v_src) = 0 THEN
    v_src := replace(
      v_src,
      '  RETURN v_batch_id;
END;',
      '  PERFORM public.check_sale_posting_vat_integrity(v_batch_id, ''daily_sales'', p_sales_id);

  RETURN v_batch_id;
END;'
    );
    EXECUTE v_src;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'post_night_summary_to_ledger';

  IF v_src IS NOT NULL AND position('check_sale_posting_vat_integrity' in v_src) = 0 THEN
    v_src := replace(
      v_src,
      '  RETURN v_batch_id;
END;',
      '  PERFORM public.check_sale_posting_vat_integrity(v_batch_id, ''night_summary'', p_summary_id);

  RETURN v_batch_id;
END;'
    );
    EXECUTE v_src;
  END IF;
END
$do$;