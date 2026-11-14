-- Enable realtime for audit_logs table to support real-time notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_logs;