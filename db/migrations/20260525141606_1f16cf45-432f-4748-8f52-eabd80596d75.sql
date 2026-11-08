
-- 1) pos_hardware_settings: restrict INSERT/UPDATE to owners/managers
DROP POLICY IF EXISTS "Users can insert their restaurant's POS settings" ON public.pos_hardware_settings;
DROP POLICY IF EXISTS "Users can update their restaurant's POS settings" ON public.pos_hardware_settings;

CREATE POLICY "Owners and managers can insert POS settings"
  ON public.pos_hardware_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  );

CREATE POLICY "Owners and managers can update POS settings"
  ON public.pos_hardware_settings
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), restaurant_id, 'owner'::app_role)
    OR public.has_role(auth.uid(), restaurant_id, 'manager'::app_role)
  );

-- 2) chart_of_accounts DELETE: fix correlated subquery
DROP POLICY IF EXISTS "Owners can delete accounts without transactions" ON public.chart_of_accounts;
CREATE POLICY "Owners can delete accounts without transactions"
  ON public.chart_of_accounts
  FOR DELETE TO authenticated
  USING (
    (public.is_superadmin(auth.uid()) OR public.tenant_has_role(tenant_id, 'owner'::text))
    AND NOT EXISTS (
      SELECT 1 FROM public.account_transactions at
      WHERE at.account_id = chart_of_accounts.id
    )
  );

-- 3) user_tenant_roles: replace open self-insert with safe variant
DROP POLICY IF EXISTS "Allow role creation during onboarding" ON public.user_tenant_roles;
CREATE POLICY "First owner role during onboarding"
  ON public.user_tenant_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'owner'::app_role
    AND NOT EXISTS (
      SELECT 1 FROM public.user_tenant_roles existing
      WHERE existing.tenant_id = user_tenant_roles.tenant_id
    )
  );

-- 4) seat_requests INSERT: scope to user's own tenant
DROP POLICY IF EXISTS "Users can create seat requests" ON public.seat_requests;
CREATE POLICY "Users can create seat requests for their tenant"
  ON public.seat_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
  );

-- 5) zatca_devices: restrict SELECT/INSERT/UPDATE/DELETE to owners/managers
DROP POLICY IF EXISTS zatca_devices_select ON public.zatca_devices;
DROP POLICY IF EXISTS zatca_devices_insert ON public.zatca_devices;
DROP POLICY IF EXISTS zatca_devices_update ON public.zatca_devices;
DROP POLICY IF EXISTS zatca_devices_delete ON public.zatca_devices;

CREATE POLICY zatca_devices_select ON public.zatca_devices
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
      OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role)
    )
  );

CREATE POLICY zatca_devices_insert ON public.zatca_devices
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
      OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role)
    )
  );

CREATE POLICY zatca_devices_update ON public.zatca_devices
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
      OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
      OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role)
    )
  );

CREATE POLICY zatca_devices_delete ON public.zatca_devices
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
      OR public.has_tenant_role(auth.uid(), tenant_id, 'manager'::app_role)
    )
  );

-- 6) onboarding-documents bucket: require authentication to upload
DROP POLICY IF EXISTS "Anyone can upload onboarding documents" ON storage.objects;
CREATE POLICY "Authenticated users can upload onboarding documents"
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'onboarding-documents');
