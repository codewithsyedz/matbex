ALTER TABLE public.pos_hardware_settings
  ADD COLUMN IF NOT EXISTS ext_pos_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ext_pos_provider_name text,
  ADD COLUMN IF NOT EXISTS ext_pos_base_url text,
  ADD COLUMN IF NOT EXISTS ext_pos_charge_path text,
  ADD COLUMN IF NOT EXISTS ext_pos_auth_type text NOT NULL DEFAULT 'api_key',
  ADD COLUMN IF NOT EXISTS ext_pos_api_key_header text DEFAULT 'X-API-Key',
  ADD COLUMN IF NOT EXISTS ext_pos_api_key text,
  ADD COLUMN IF NOT EXISTS ext_pos_bearer_token text,
  ADD COLUMN IF NOT EXISTS ext_pos_basic_username text,
  ADD COLUMN IF NOT EXISTS ext_pos_basic_password text,
  ADD COLUMN IF NOT EXISTS ext_pos_oauth_client_id text,
  ADD COLUMN IF NOT EXISTS ext_pos_oauth_client_secret text,
  ADD COLUMN IF NOT EXISTS ext_pos_oauth_token_url text,
  ADD COLUMN IF NOT EXISTS ext_pos_oauth_scope text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_hardware_settings_ext_pos_auth_type_check'
  ) THEN
    ALTER TABLE public.pos_hardware_settings
      ADD CONSTRAINT pos_hardware_settings_ext_pos_auth_type_check
      CHECK (ext_pos_auth_type IN ('api_key','bearer','basic','oauth2'));
  END IF;
END $$;