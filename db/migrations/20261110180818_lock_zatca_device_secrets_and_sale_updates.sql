-- 1. ZATCA device secrets stay on the server.
--    The device's XAdES private key and the compliance/production CSID secrets were readable
--    (and writable) by any signed-in user of the tenant: the device screen loaded them with
--    select("*") and the signing function read them as the user. Now only the API's service
--    client reads them (zatca-sign-invoice, zatca-submit-clearance, zatca-onboard-device).
REVOKE ALL ON public.zatca_devices FROM anon;
REVOKE SELECT, INSERT, UPDATE, TRUNCATE ON public.zatca_devices FROM authenticated;
GRANT SELECT (
  id, tenant_id, restaurant_id, name, serial_number, model, otp, registration_status, csr,
  compliance_csid, production_csid, csid_expires_at, icv_counter, last_pih, registered_at,
  revoked_at, created_at, updated_at, public_cert_pem, last_zatca_check_at,
  compliance_request_id, compliance_passed_at
) ON public.zatca_devices TO authenticated;
GRANT INSERT (tenant_id, restaurant_id, name, serial_number, model, otp) ON public.zatca_devices TO authenticated;
GRANT UPDATE (name, model, otp, registration_status, revoked_at) ON public.zatca_devices TO authenticated;

-- 2. The invoice chain is allocated only by the server, together with stamping the sale
--    (POST /api/v1/zatca/sales/:id/chain), so an allocated ICV always lands on an invoice.
REVOKE EXECUTE ON FUNCTION public.next_zatca_chain(uuid, text) FROM PUBLIC, anon, authenticated;

-- 3. Browsers no longer update sales at all. ZATCA records go through /api/v1/zatca/*, VAT
--    fixes through /api/v1/pos/sales/:id/vat-reconcile, branch re-tagging through
--    PATCH /api/v1/pos/sales/:id. Column grants are revoked explicitly: revoking the table
--    privilege does not remove them.
REVOKE UPDATE (
  zatca_seller_name, zatca_seller_name_ar, zatca_vat_number, zatca_qr_base64, zatca_pdf_url,
  zatca_invoice_total, zatca_vat_total, zatca_timestamp, zatca_generated_at, zatca_device_id,
  zatca_uuid, zatca_icv, zatca_pih, zatca_invoice_hash, zatca_clearance_status, zatca_xml_url,
  branch_id, subtotal, tax, total
) ON public.sales_transactions FROM authenticated;
REVOKE UPDATE ON public.sales_transactions FROM anon, authenticated;
