-- pgcrypto is installed in the "extensions" schema, but these functions pin
-- search_path = public and call digest()/hmac()/crypt() unqualified, so they fail with
-- "function digest(text, unknown) does not exist". The visible effect: any update that
-- changes a sale's zatca_clearance_status (trg_zatca_audit_sales -> append_zatca_audit)
-- rolls back, the ZATCA audit chain cannot be verified, and terminal keys cannot be checked.
ALTER FUNCTION public.append_zatca_audit(uuid, text, uuid, text, uuid, jsonb) SET search_path = public, extensions;
ALTER FUNCTION public.inspect_zatca_audit_break(uuid) SET search_path = public, extensions;
ALTER FUNCTION public.verify_zatca_audit_chain_admin(uuid) SET search_path = public, extensions;
ALTER FUNCTION public.verify_zatca_audit_chain(uuid) SET search_path = public, extensions;
ALTER FUNCTION public.verify_terminal_key(text) SET search_path = public, extensions;
