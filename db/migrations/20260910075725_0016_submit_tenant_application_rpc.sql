CREATE OR REPLACE FUNCTION public.submit_tenant_application(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(payload->>'email'));
  v_existing public.tenant_applications%ROWTYPE;
  v_id uuid;
BEGIN
  IF v_email IS NULL OR v_email = '' OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'A valid email is required';
  END IF;
  IF coalesce(trim(payload->>'restaurant_name'),'') = '' THEN
    RAISE EXCEPTION 'Restaurant name is required';
  END IF;

  SELECT * INTO v_existing
  FROM public.tenant_applications
  WHERE lower(email) = v_email
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND AND v_existing.status = 'approved' THEN
    RETURN jsonb_build_object('id', v_existing.id, 'status', 'approved', 'created', false);
  END IF;

  IF FOUND THEN
    UPDATE public.tenant_applications SET
      full_name = coalesce(nullif(trim(payload->>'full_name'),''), full_name),
      phone = nullif(trim(payload->>'phone'),''),
      country = coalesce(nullif(trim(payload->>'country'),''), country),
      referral_code = nullif(trim(payload->>'referral_code'),''),
      company_name = coalesce(nullif(trim(payload->>'company_name'),''), company_name),
      cr_number = nullif(trim(payload->>'cr_number'),''),
      vat_number = nullif(trim(payload->>'vat_number'),''),
      cr_document_url = nullif(trim(payload->>'cr_document_url'),''),
      restaurant_name = trim(payload->>'restaurant_name'),
      restaurant_type = nullif(trim(payload->>'restaurant_type'),''),
      estimated_monthly_revenue = nullif(trim(payload->>'estimated_monthly_revenue'),''),
      location_count = coalesce(nullif(payload->>'location_count','')::int, location_count),
      plan_id = coalesce(nullif(payload->>'plan_id','')::uuid, plan_id),
      billing_interval = coalesce(nullif(payload->>'billing_interval',''), billing_interval),
      selected_addon_ids = coalesce(
        (SELECT array_agg(value::text::uuid) FROM jsonb_array_elements_text(coalesce(payload->'selected_addon_ids','[]'::jsonb)) AS value),
        selected_addon_ids
      ),
      status = CASE WHEN status IN ('rejected','draft') THEN 'submitted' ELSE status END
    WHERE id = v_existing.id
    RETURNING id INTO v_id;

    RETURN jsonb_build_object(
      'id', v_id,
      'status', (SELECT status FROM public.tenant_applications WHERE id = v_id),
      'created', false
    );
  END IF;

  INSERT INTO public.tenant_applications (
    full_name, email, phone, country, referral_code,
    company_name, cr_number, vat_number, cr_document_url,
    restaurant_name, restaurant_type, estimated_monthly_revenue,
    location_count, plan_id, billing_interval, status, selected_addon_ids
  ) VALUES (
    nullif(trim(payload->>'full_name'),''),
    v_email,
    nullif(trim(payload->>'phone'),''),
    nullif(trim(payload->>'country'),''),
    nullif(trim(payload->>'referral_code'),''),
    nullif(trim(payload->>'company_name'),''),
    nullif(trim(payload->>'cr_number'),''),
    nullif(trim(payload->>'vat_number'),''),
    nullif(trim(payload->>'cr_document_url'),''),
    trim(payload->>'restaurant_name'),
    nullif(trim(payload->>'restaurant_type'),''),
    nullif(trim(payload->>'estimated_monthly_revenue'),''),
    coalesce(nullif(payload->>'location_count','')::int, 1),
    nullif(payload->>'plan_id','')::uuid,
    coalesce(nullif(payload->>'billing_interval',''), 'monthly'),
    'submitted',
    (SELECT array_agg(value::text::uuid) FROM jsonb_array_elements_text(coalesce(payload->'selected_addon_ids','[]'::jsonb)) AS value)
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'status', 'submitted', 'created', true);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_tenant_application(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_tenant_application(jsonb) TO anon, authenticated, service_role;