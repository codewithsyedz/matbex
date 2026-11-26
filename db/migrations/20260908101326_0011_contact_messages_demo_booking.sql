ALTER TABLE public.contact_messages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'enquiry',
  ADD COLUMN IF NOT EXISTS company text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS branch_count text,
  ADD COLUMN IF NOT EXISTS preferred_date date,
  ADD COLUMN IF NOT EXISTS preferred_slot text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contact_messages_kind_check'
  ) THEN
    ALTER TABLE public.contact_messages
      ADD CONSTRAINT contact_messages_kind_check CHECK (kind IN ('enquiry', 'demo'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS contact_messages_kind_created_idx
  ON public.contact_messages (kind, created_at DESC);