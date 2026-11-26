ALTER TABLE public.zatca_audit_trail REPLICA IDENTITY FULL;
ALTER TABLE public.zatca_devices REPLICA IDENTITY FULL;
ALTER TABLE public.zatca_credit_notes REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.zatca_audit_trail;
ALTER PUBLICATION supabase_realtime ADD TABLE public.zatca_devices;
ALTER PUBLICATION supabase_realtime ADD TABLE public.zatca_credit_notes;