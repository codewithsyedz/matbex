
-- 1) account_locks: remove public open INSERT/UPDATE; rely on service_role bypass
DROP POLICY IF EXISTS "System can insert account locks" ON public.account_locks;
DROP POLICY IF EXISTS "System can update account locks" ON public.account_locks;

-- 2) audit_logs: remove public open INSERT
DROP POLICY IF EXISTS "System can insert audit logs" ON public.audit_logs;

-- 3) in_app_notifications: remove public open INSERT
DROP POLICY IF EXISTS "Service role can insert notifications" ON public.in_app_notifications;

-- 4) shift_variance_logs: remove public open INSERT
DROP POLICY IF EXISTS "System can insert variance logs" ON public.shift_variance_logs;

-- 5) superadmin_audit_events: remove public open INSERT
DROP POLICY IF EXISTS "System can insert audit events" ON public.superadmin_audit_events;

-- 6) user_sessions: remove public open INSERT
DROP POLICY IF EXISTS "System can create sessions" ON public.user_sessions;

-- 7) user_roles: remove privilege-escalation self-insert policy
DROP POLICY IF EXISTS "Users can create their own roles" ON public.user_roles;

-- 8) pending_digest_notifications: remove public ALL/true policy
DROP POLICY IF EXISTS "Service role full access on pending digest" ON public.pending_digest_notifications;

-- 9) overhead_payments: fix broken correlated-subquery RLS (cross-tenant leak)
DROP POLICY IF EXISTS "Users can view overhead payments for their restaurant" ON public.overhead_payments;
DROP POLICY IF EXISTS "Users can create overhead payments for their restaurant" ON public.overhead_payments;
DROP POLICY IF EXISTS "Users can update overhead payments for their restaurant" ON public.overhead_payments;
DROP POLICY IF EXISTS "Users can delete overhead payments for their restaurant" ON public.overhead_payments;

CREATE POLICY "Members can view overhead payments"
  ON public.overhead_payments FOR SELECT
  TO authenticated
  USING (public.user_belongs_to_restaurant(auth.uid(), restaurant_id));

CREATE POLICY "Owners and managers can insert overhead payments"
  ON public.overhead_payments FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  );

CREATE POLICY "Owners and managers can update overhead payments"
  ON public.overhead_payments FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  );

CREATE POLICY "Owners can delete overhead payments"
  ON public.overhead_payments FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), restaurant_id, 'owner'::app_role));

-- 10) zatca_alert_state: fix broken correlated-subquery RLS
DROP POLICY IF EXISTS "Owners and managers can view zatca alerts" ON public.zatca_alert_state;

CREATE POLICY "Owners and managers can view zatca alerts"
  ON public.zatca_alert_state FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT r.tenant_id
      FROM public.restaurants r
      JOIN public.user_roles ur ON ur.restaurant_id = r.id
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('owner'::app_role, 'manager'::app_role)
    )
  );

-- 11) pos_hardware_settings: restrict SELECT to owner/manager (contains plaintext credentials)
DROP POLICY IF EXISTS "Users can view their restaurant's POS settings" ON public.pos_hardware_settings;

CREATE POLICY "Owners and managers can view POS settings"
  ON public.pos_hardware_settings FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  );

-- 12) tenant_applications: remove plaintext temporary_password column
ALTER TABLE public.tenant_applications DROP COLUMN IF EXISTS temporary_password;
