-- Add 'daily' to the cogs_frequency enum
ALTER TYPE public.cogs_frequency ADD VALUE IF NOT EXISTS 'daily' BEFORE 'weekly';