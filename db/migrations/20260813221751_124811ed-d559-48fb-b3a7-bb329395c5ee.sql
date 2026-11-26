CREATE OR REPLACE FUNCTION public.pos_ack_diagnostics(
  _branch_id uuid,
  _start_utc timestamptz,
  _end_utc timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_keys jsonb;
  v_dlq_only jsonb;
  v_summary jsonb;
  v_daily jsonb;
BEGIN
  IF _branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id is required';
  END IF;

  IF NOT public.can_access_branch(_branch_id) THEN
    RAISE EXCEPTION 'Not authorised to view diagnostics for this branch';
  END IF;

  WITH term AS (
    SELECT t.terminal_uid, t.restaurant_id, t.id AS terminal_id, t.name, t.branch_id
    FROM public.pos_terminals t
    WHERE t.branch_id = _branch_id
  ),
  k AS (
    SELECT
      pik.id,
      pik.idempotency_key,
      pik.entity_type,
      pik.terminal_uid,
      term.terminal_id,
      term.name AS terminal_name,
      pik.status,
      pik.request_id,
      pik.created_at,
      NULLIF(pik.response ->> 'server_id', '')::uuid AS server_id,
      pik.response,
      split_part(pik.idempotency_key, ':', 3) AS local_record_id
    FROM public.pos_idempotency_keys pik
    JOIN term ON term.terminal_uid = pik.terminal_uid
             AND term.restaurant_id = pik.restaurant_id
    WHERE pik.created_at >= _start_utc AND pik.created_at < _end_utc
  ),
  dlq AS (
    SELECT f.*
    FROM public.failed_sync_items f
    WHERE f.branch_id = _branch_id
      AND f.created_at >= _start_utc AND f.created_at < _end_utc
  ),
  enriched AS (
    SELECT
      k.*,
      st.id AS sale_id,
      st.receipt_number,
      st.total AS sale_total,
      st.created_at AS sale_created_at,
      (SELECT jsonb_agg(DISTINCT jsonb_build_object(
                'batch_id', at.batch_id,
                'transaction_id', at.id,
                'transaction_date', at.transaction_date,
                'debit', at.debit,
                'credit', at.credit,
                'is_voided', at.is_voided))
         FROM public.account_transactions at
        WHERE at.reference_type = 'sale'
          AND at.reference_id = st.id) AS ledger_links,
      d.id AS dlq_item_id,
      d.status AS dlq_status,
      d.error_message AS dlq_error,
      d.error_category AS dlq_error_category,
      d.batch_id AS dlq_batch_id,
      d.retry_exhausted AS dlq_retry_exhausted
    FROM k
    LEFT JOIN public.sales_transactions st
           ON st.id = k.server_id
    LEFT JOIN dlq d
           ON d.event_id = k.local_record_id
  ),
  problems AS (
    SELECT
      e.*,
      CASE
        WHEN e.status IS DISTINCT FROM 'completed' THEN 'not_acked'
        WHEN e.server_id IS NULL THEN 'ack_without_server_id'
        WHEN e.sale_id IS NULL AND e.entity_type IN ('INVOICE', 'ORDER', 'PAYMENT') THEN 'acked_but_sale_missing'
        WHEN e.dlq_item_id IS NOT NULL AND e.dlq_status IN ('open', 'retrying') THEN 'acked_but_in_dlq'
      END AS issue
    FROM enriched e
  )
  SELECT
    COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC) FILTER (WHERE p.issue IS NOT NULL), '[]'::jsonb),
    jsonb_build_object(
      'total_keys', COUNT(*),
      'completed', COUNT(*) FILTER (WHERE p.status = 'completed'),
      'not_acked', COUNT(*) FILTER (WHERE p.issue = 'not_acked'),
      'ack_without_server_id', COUNT(*) FILTER (WHERE p.issue = 'ack_without_server_id'),
      'acked_but_sale_missing', COUNT(*) FILTER (WHERE p.issue = 'acked_but_sale_missing'),
      'acked_but_in_dlq', COUNT(*) FILTER (WHERE p.issue = 'acked_but_in_dlq'),
      'sales_linked', COUNT(*) FILTER (WHERE p.sale_id IS NOT NULL),
      'ledger_linked', COUNT(*) FILTER (WHERE p.ledger_links IS NOT NULL)
    )
  INTO v_keys, v_summary
  FROM problems p;

  -- Terminal events that never produced an idempotency key row at all
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'dlq_item_id', d.id,
           'event_type', d.event_type,
           'event_id', d.event_id,
           'terminal_id', d.terminal_id,
           'batch_id', d.batch_id,
           'request_id', d.request_id,
           'http_status', d.http_status,
           'error_category', d.error_category,
           'error_message', d.error_message,
           'retry_count', d.retry_count,
           'retry_exhausted', d.retry_exhausted,
           'status', d.status,
           'created_at', d.created_at
         ) ORDER BY d.created_at DESC), '[]'::jsonb)
  INTO v_dlq_only
  FROM public.failed_sync_items d
  WHERE d.branch_id = _branch_id
    AND d.created_at >= _start_utc AND d.created_at < _end_utc
    AND NOT EXISTS (
      SELECT 1 FROM public.pos_idempotency_keys pik
      WHERE split_part(pik.idempotency_key, ':', 3) = d.event_id
    );

  SELECT COALESCE(to_jsonb(s), 'null'::jsonb)
  INTO v_daily
  FROM (
    SELECT dss.id, dss.sales_date, dss.total_sales, dss.pos_reported_total,
           dss.system_calculated_total, dss.variance_amount, dss.variance_status,
           dss.status, dss.ledger_posted, dss.ledger_batch_id
    FROM public.daily_sales_summary dss
    WHERE dss.branch_id = _branch_id
      AND dss.sales_date = (_start_utc AT TIME ZONE 'UTC')::date
    ORDER BY dss.created_at DESC
    LIMIT 1
  ) s;

  v_result := jsonb_build_object(
    'branch_id', _branch_id,
    'window_start', _start_utc,
    'window_end', _end_utc,
    'generated_at', now(),
    'summary', COALESCE(v_summary, jsonb_build_object('total_keys', 0)),
    'issues', COALESCE(v_keys, '[]'::jsonb),
    'unacked_dlq_events', COALESCE(v_dlq_only, '[]'::jsonb),
    'daily_sales_summary', v_daily
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_ack_diagnostics(uuid, timestamptz, timestamptz) TO authenticated;