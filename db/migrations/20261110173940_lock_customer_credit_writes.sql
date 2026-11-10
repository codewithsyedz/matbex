-- Customer credit is written only by /api/v1/credit/* (server/src/modules/credit), which runs
-- as the table owner: settlement invoices, their payments (posted to the ledger by trigger),
-- instalments, write-offs, reversals and manual balance adjustments. The balance itself is
-- recomputed by the database (20261110172707).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.settlement_invoices FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.settlement_payments FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.customer_balance_adjustments FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.settlement_audit_logs FROM anon, authenticated;

-- Sales: browsers may still update only what the ZATCA helpers (src/lib/zatca), the VAT
-- audit and the VAT receipt drilldown write. Settlement status, amounts paid, invoice links,
-- customer, shift, payment method, receipt number and void fields change only through the API.
REVOKE UPDATE ON public.sales_transactions FROM anon, authenticated;
GRANT UPDATE (
  zatca_seller_name, zatca_seller_name_ar, zatca_vat_number, zatca_qr_base64, zatca_pdf_url,
  zatca_invoice_total, zatca_vat_total, zatca_timestamp, zatca_generated_at, zatca_device_id,
  zatca_uuid, zatca_icv, zatca_pih, zatca_invoice_hash, zatca_clearance_status, zatca_xml_url,
  branch_id, subtotal, tax, total
) ON public.sales_transactions TO authenticated;
