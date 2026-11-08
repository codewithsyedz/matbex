ALTER TABLE public.journal_entry_batches REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.journal_entry_batches;