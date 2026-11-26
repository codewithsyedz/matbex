-- 1. Real per-business costs for SuperAdmin → Tenant Costs.
-- 2. Full data export an owner downloads (PDPL portability).
-- 3. Account closure: an owner asks for their data to be deleted; after a 30-day grace period a
--    SuperAdmin erases the personal data, and a permanent record of what was done is kept.

-- ---------------------------------------------------------------------------- 1. costs
-- Per business over the last _days: money actually received (subscription payments excl. VAT,
-- less refunds), Matbex's own Moyasar volume (card fees are on these), AI invoice scans with
-- tokens per model, and usage. The page prices AI and fees with the rates in platform_settings
-- "cost_model".
CREATE OR REPLACE FUNCTION public.admin_tenant_costs(_days int DEFAULT 30)
RETURNS TABLE (
  tenant_id uuid, name text, status text, plan text, plan_price numeric,
  users int, branches int, sales int,
  revenue numeric, moyasar_amount numeric, moyasar_payments int,
  ai_usage jsonb
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_since timestamptz := now() - make_interval(days => greatest(coalesce(_days, 30), 1));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'SuperAdmin access required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH r AS (SELECT id, tenant_id FROM public.restaurants),
  pay AS (
    SELECT sp.tenant_id,
           sum(coalesce(sp.subtotal, sp.amount)) AS gross,
           sum(sp.amount) FILTER (WHERE sp.method = 'moyasar') AS moy_amount,
           count(*) FILTER (WHERE sp.method = 'moyasar')::int AS moy_count
      FROM public.subscription_payments sp
     WHERE sp.status = 'paid' AND sp.paid_at >= v_since AND sp.tenant_id IS NOT NULL
     GROUP BY sp.tenant_id
  ), ref AS (
    SELECT sr.tenant_id, sum(sr.amount - sr.vat_amount) AS amount
      FROM public.subscription_refunds sr WHERE sr.created_at >= v_since GROUP BY sr.tenant_id
  ), ai AS (
    SELECT x.tenant_id, jsonb_object_agg(x.model, jsonb_build_object('scans', x.scans, 'input_tokens', x.tin, 'output_tokens', x.tout)) AS usage
      FROM (
        SELECT r.tenant_id, coalesce(s.model, 'unknown') AS model, count(*)::int AS scans,
               coalesce(sum(s.input_tokens), 0)::bigint AS tin, coalesce(sum(s.output_tokens), 0)::bigint AS tout
          FROM public.invoice_scans s JOIN r ON r.id = s.restaurant_id
         WHERE s.created_at >= v_since
         GROUP BY r.tenant_id, coalesce(s.model, 'unknown')
      ) x GROUP BY x.tenant_id
  ), sales AS (
    SELECT r.tenant_id, count(*)::int AS n
      FROM public.sales_transactions st JOIN r ON r.id = st.restaurant_id
     WHERE st.created_at >= v_since AND st.voided_at IS NULL AND st.voids_transaction_id IS NULL
     GROUP BY r.tenant_id
  ), u AS (
    SELECT utr.tenant_id, count(DISTINCT utr.user_id)::int AS n FROM public.user_tenant_roles utr GROUP BY utr.tenant_id
  ), b AS (
    SELECT r.tenant_id, count(*)::int AS n FROM r GROUP BY r.tenant_id
  )
  SELECT t.id, t.name, t.status, p.name, coalesce(p.price, 0),
         coalesce(u.n, 0), coalesce(b.n, 0), coalesce(sales.n, 0),
         round(coalesce(pay.gross, 0) - coalesce(ref.amount, 0), 2), round(coalesce(pay.moy_amount, 0), 2), coalesce(pay.moy_count, 0),
         coalesce(ai.usage, '{}'::jsonb)
    FROM public.tenants t
    LEFT JOIN public.plans p ON p.id = t.plan_id
    LEFT JOIN pay ON pay.tenant_id = t.id
    LEFT JOIN ref ON ref.tenant_id = t.id
    LEFT JOIN ai ON ai.tenant_id = t.id
    LEFT JOIN sales ON sales.tenant_id = t.id
    LEFT JOIN u ON u.tenant_id = t.id
    LEFT JOIN b ON b.tenant_id = t.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_tenant_costs(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_tenant_costs(int) TO authenticated;

-- ---------------------------------------------------------------------------- 2. data exports
-- One row per export. Built in the background (tenant-data-export, tasks queue) into a private
-- bucket; owners download through a short-lived signed link; files expire after 7 days.
CREATE TABLE IF NOT EXISTS public.data_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'building', 'ready', 'failed', 'expired')),
  file_path text,
  file_size bigint,
  row_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz,
  downloaded_at timestamptz
);
CREATE INDEX IF NOT EXISTS data_exports_tenant_idx ON public.data_exports (tenant_id, requested_at DESC);
ALTER TABLE public.data_exports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "data_exports_owner_read" ON public.data_exports;
CREATE POLICY "data_exports_owner_read" ON public.data_exports FOR SELECT TO authenticated
  USING (public.is_superadmin(auth.uid()) OR public.tenant_has_role(tenant_id, 'owner'));
GRANT SELECT ON public.data_exports TO authenticated;
GRANT ALL ON public.data_exports TO service_role;

INSERT INTO storage.buckets (id, name, public) VALUES ('tenant-exports', 'tenant-exports', false)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------- 3. closure and erasure
CREATE TABLE IF NOT EXISTS public.tenant_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  requested_by_email text,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled', 'completed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  -- personal data is erased on or after this date (30-day grace period to change their mind)
  scheduled_for timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  cancelled_at timestamptz,
  completed_at timestamptz,
  completed_by uuid,
  -- what was erased (rows per table) and what was kept for legal retention, and until when
  summary jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_deletion_one_pending ON public.tenant_deletion_requests (tenant_id) WHERE status = 'pending';
ALTER TABLE public.tenant_deletion_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_deletion_read" ON public.tenant_deletion_requests;
CREATE POLICY "tenant_deletion_read" ON public.tenant_deletion_requests FOR SELECT TO authenticated
  USING (public.is_superadmin(auth.uid()) OR public.tenant_has_role(tenant_id, 'owner'));
GRANT SELECT ON public.tenant_deletion_requests TO authenticated;
GRANT ALL ON public.tenant_deletion_requests TO service_role;

-- Erase a business's personal data (PDPL), keeping what tax law requires (ZATCA: invoices and
-- accounting records for 6 years). Personal fields are blanked or replaced, chat and device data
-- deleted, the business's user logins disabled (users who also belong to another business, and
-- SuperAdmins, are kept), and the business suspended. Returns the record stored on the request.
-- Called only by the admin-tenant-erasure server function (service role) for a request whose
-- grace period has ended.
CREATE OR REPLACE FUNCTION public.erase_tenant_personal_data(_request_id uuid, _actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  q public.tenant_deletion_requests%ROWTYPE;
  v_rest uuid[];
  v_users uuid[];
  n int;
  counts jsonb := '{}'::jsonb;
  v_summary jsonb;
BEGIN
  SELECT * INTO q FROM public.tenant_deletion_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR q.status <> 'pending' THEN
    RAISE EXCEPTION 'No pending deletion request';
  END IF;
  IF q.scheduled_for > now() THEN
    RAISE EXCEPTION 'The 30-day grace period ends on %', to_char(q.scheduled_for, 'YYYY-MM-DD');
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO v_rest FROM public.restaurants WHERE tenant_id = q.tenant_id;

  UPDATE public.customers SET name = 'Deleted customer', phone = NULL, email = NULL, address = NULL WHERE restaurant_id = ANY (v_rest);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('customers', n);
  UPDATE public.staff SET name = 'Former staff member', phone = NULL WHERE restaurant_id = ANY (v_rest);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('staff', n);
  UPDATE public.riders SET name = 'Former rider', phone = NULL WHERE restaurant_id = ANY (v_rest);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('riders', n);
  UPDATE public.table_reservations SET guest_name = 'Deleted', guest_phone = NULL, guest_email = NULL WHERE restaurant_id = ANY (v_rest) OR tenant_id = q.tenant_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('table_reservations', n);
  UPDATE public.online_orders SET customer_name = 'Deleted', customer_phone = NULL, customer_email = NULL, delivery_address = NULL WHERE restaurant_id = ANY (v_rest);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('online_orders', n);
  UPDATE public.delivery_orders SET customer_name = 'Deleted', customer_phone = NULL WHERE restaurant_id = ANY (v_rest) OR tenant_id = q.tenant_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('delivery_orders', n);
  UPDATE public.suppliers SET contact_name = NULL, phone = NULL, email = NULL WHERE restaurant_id = ANY (v_rest);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('supplier_contacts', n);
  UPDATE public.team_invitations SET email = 'deleted-' || id || '@deleted.invalid' WHERE tenant_id = q.tenant_id OR restaurant_id = ANY (v_rest);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('team_invitations', n);
  DELETE FROM public.owner_whatsapp_subscriptions WHERE restaurant_id = ANY (v_rest);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('whatsapp_numbers', n);
  DELETE FROM public.chat_messages WHERE restaurant_id = ANY (v_rest);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('chat_messages', n);
  DELETE FROM public.push_subscriptions WHERE tenant_id = q.tenant_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('push_subscriptions', n);
  DELETE FROM public.user_sessions WHERE tenant_id = q.tenant_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('user_sessions', n);
  DELETE FROM public.client_errors WHERE tenant_id = q.tenant_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('client_errors', n);
  UPDATE public.support_requests SET user_email = NULL, user_name = 'Deleted user', user_agent = NULL, recent_errors = '[]'::jsonb WHERE tenant_id = q.tenant_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('support_requests', n);

  -- The business's logins: only users who belong to no other business and are not SuperAdmins.
  SELECT coalesce(array_agg(DISTINCT r.user_id), '{}') INTO v_users
    FROM public.user_tenant_roles r
   WHERE r.tenant_id = q.tenant_id
     AND NOT EXISTS (SELECT 1 FROM public.user_tenant_roles o WHERE o.user_id = r.user_id AND o.tenant_id <> q.tenant_id)
     AND NOT EXISTS (SELECT 1 FROM public.superadmin_users s WHERE s.user_id = r.user_id);
  UPDATE public.profiles SET full_name = 'Deleted user' WHERE id = ANY (v_users);
  DELETE FROM auth.sessions WHERE user_id = ANY (v_users);
  UPDATE auth.users
     SET email = 'deleted-' || id || '@deleted.invalid', phone = NULL, encrypted_password = NULL,
         raw_user_meta_data = '{}'::jsonb, banned_until = '9999-12-31 00:00:00+00', deleted_at = now(), updated_at = now()
   WHERE id = ANY (v_users);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('user_logins_disabled', n);

  UPDATE public.tenants SET status = 'suspended', updated_at = now() WHERE id = q.tenant_id;

  v_summary := jsonb_build_object(
    'erased', counts,
    'kept_for_legal_retention', jsonb_build_object(
      'what', 'Sales and tax invoices (with B2B buyer details), credit notes, expenses and purchase invoices, the ledger and VAT returns',
      'why', 'ZATCA requires invoices and accounting records to be kept for 6 years',
      'until', (SELECT to_char(greatest(max(legal_retention_until), now() + interval '6 years'), 'YYYY-MM-DD')
                  FROM public.sales_transactions WHERE restaurant_id = ANY (v_rest))
    ),
    'business_suspended', true
  );
  UPDATE public.tenant_deletion_requests
     SET status = 'completed', completed_at = now(), completed_by = _actor, summary = v_summary
   WHERE id = q.id;
  RETURN v_summary;
END;
$function$;
REVOKE ALL ON FUNCTION public.erase_tenant_personal_data(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erase_tenant_personal_data(uuid, uuid) TO service_role;
