-- Add notification sound preferences column
ALTER TABLE public.notification_preferences 
ADD COLUMN IF NOT EXISTS sound_enabled boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS sound_volume integer NOT NULL DEFAULT 50 CHECK (sound_volume >= 0 AND sound_volume <= 100),
ADD COLUMN IF NOT EXISTS sound_theme text NOT NULL DEFAULT 'default';

-- Add comment for clarity
COMMENT ON COLUMN public.notification_preferences.sound_enabled IS 'Whether to play sounds for notifications';
COMMENT ON COLUMN public.notification_preferences.sound_volume IS 'Sound volume level from 0 to 100';
COMMENT ON COLUMN public.notification_preferences.sound_theme IS 'Sound theme: default, subtle, urgent, or muted';