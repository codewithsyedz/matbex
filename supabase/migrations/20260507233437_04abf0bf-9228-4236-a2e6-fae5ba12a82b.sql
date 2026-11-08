
ALTER TABLE public.zatca_devices
  ADD COLUMN IF NOT EXISTS private_key_pem text,
  ADD COLUMN IF NOT EXISTS public_cert_pem text;

ALTER TABLE public.sales_transactions
  ADD COLUMN IF NOT EXISTS zatca_signature text,
  ADD COLUMN IF NOT EXISTS zatca_signed_xml_url text;
