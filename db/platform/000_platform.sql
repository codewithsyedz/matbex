-- =============================================================================
-- Matbex platform bootstrap for plain PostgreSQL (16+)
-- =============================================================================
-- The application schema (db/migrations) was originally written for a hosted
-- Supabase project. This file recreates the small set of platform objects
-- those migrations depend on, so they apply unchanged on a vanilla Postgres:
--
--   * roles:        anon / authenticated / service_role / authenticator
--   * schema auth:  users, sessions, refresh tokens, MFA factors, OTP tokens
--                   + auth.uid() / auth.role() / auth.email() / auth.jwt()
--   * schema storage: buckets / objects metadata (RLS still enforced, the
--                   Matbex API stores bytes in S3-compatible object storage)
--   * schema cron:  table-driven scheduler (executed by the API job runner)
--   * schema net:   http request queue (drained by the API job runner)
--   * publication supabase_realtime (name kept for migration compatibility;
--                   the API installs NOTIFY triggers for its tables)
--
-- Everything here is owned by us. No Supabase software is required.
-- Idempotent: safe to run on every deploy.
-- =============================================================================

-- ---------- Roles -------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    -- Password is set by the migration runner from AUTHENTICATOR_PASSWORD.
    CREATE ROLE authenticator LOGIN NOINHERIT;
  END IF;
  -- Legacy role names referenced by a few migrations / grants.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_user') THEN
    CREATE ROLE dashboard_user NOLOGIN;
  END IF;
END $$;

GRANT anon, authenticated, service_role TO authenticator;

-- ---------- Schemas & extensions ---------------------------------------------
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS cron;
CREATE SCHEMA IF NOT EXISTS net;
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE SCHEMA IF NOT EXISTS platform;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

GRANT USAGE ON SCHEMA public, extensions TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth, storage TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO service_role;

-- Same grant model as before: API roles get table privileges by default and
-- row-level security decides what each caller can actually see or change.
-- (Default privileges only affect objects created after this point, so
-- explicit REVOKEs in migrations are preserved.)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- Same search_path the hosted platform used, so unqualified gen_random_bytes(),
-- crypt(), uuid_generate_v4() keep resolving.
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path = "$user", public, extensions', current_database());
END $$;
SET search_path = "$user", public, extensions;

-- ---------- auth: tables -----------------------------------------------------
CREATE TABLE IF NOT EXISTS auth.users (
  instance_id          uuid,
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aud                  varchar(255) DEFAULT 'authenticated',
  role                 varchar(255) DEFAULT 'authenticated',
  email                varchar(255),
  encrypted_password   varchar(255),         -- bcrypt ($2a/$2b) — compatible with exported hashes
  email_confirmed_at   timestamptz,
  invited_at           timestamptz,
  confirmation_sent_at timestamptz,
  recovery_sent_at     timestamptz,
  email_change         varchar(255),
  last_sign_in_at      timestamptz,
  raw_app_meta_data    jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_user_meta_data   jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_super_admin       boolean,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  phone                text UNIQUE,
  phone_confirmed_at   timestamptz,
  confirmed_at         timestamptz GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
  banned_until         timestamptz,
  deleted_at           timestamptz,
  is_anonymous         boolean NOT NULL DEFAULT false,
  is_sso_user          boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON auth.users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth.sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  aal         text NOT NULL DEFAULT 'aal1',
  factor_id   uuid,
  user_agent  text,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  refreshed_at timestamptz,
  not_after   timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON auth.sessions(user_id);

CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
  id          bigserial PRIMARY KEY,
  token_hash  text NOT NULL UNIQUE,          -- sha256 of the opaque token
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id  uuid NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
  parent_id   bigint,
  revoked     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_session_idx ON auth.refresh_tokens(session_id);

CREATE TABLE IF NOT EXISTS auth.mfa_factors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friendly_name text,
  factor_type   text NOT NULL DEFAULT 'totp',
  status        text NOT NULL DEFAULT 'unverified',  -- unverified | verified
  secret        text NOT NULL,                       -- base32 TOTP secret
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_challenged_at timestamptz
);

CREATE TABLE IF NOT EXISTS auth.mfa_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factor_id   uuid NOT NULL REFERENCES auth.mfa_factors(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  ip_address  inet
);

-- recovery / invite / magic-link / email-change / signup confirmation tokens
CREATE TABLE IF NOT EXISTS auth.one_time_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_type  text NOT NULL,      -- recovery | invite | magiclink | signup | email_change
  token_hash  text NOT NULL UNIQUE,
  relates_to  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

CREATE TABLE IF NOT EXISTS auth.audit_log_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payload     jsonb,
  ip_address  varchar(64),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- auth: request-context helpers -----------------------------------
-- The API (and PostgREST) put the verified JWT claims in request.jwt.claims.
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  )
$$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      auth.jwt() ->> 'sub'
    ), ''
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    auth.jwt() ->> 'role'
  )
$$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    auth.jwt() ->> 'email'
  )
$$;

GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.email(), auth.jwt()
  TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO service_role;

-- ---------- storage ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS storage.buckets (
  id                 text PRIMARY KEY,
  name               text NOT NULL UNIQUE,
  owner              uuid,
  owner_id           text,
  public             boolean NOT NULL DEFAULT false,
  avif_autodetection boolean DEFAULT false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id        text REFERENCES storage.buckets(id),
  name             text,
  owner            uuid,
  owner_id         text,
  metadata         jsonb,
  path_tokens      text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED,
  version          text,
  user_metadata    jsonb,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  UNIQUE (bucket_id, name)
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
CREATE OR REPLACE FUNCTION storage.filename(name text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;
CREATE OR REPLACE FUNCTION storage.extension(name text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT reverse(split_part(reverse(storage.filename(name)), '.', 1))
$$;

GRANT ALL ON storage.objects, storage.buckets TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA storage TO anon, authenticated, service_role;

-- ---------- cron (table-driven; executed by the API job runner) --------------
CREATE TABLE IF NOT EXISTS cron.job (
  jobid    bigserial PRIMARY KEY,
  schedule text NOT NULL,
  command  text NOT NULL,
  nodename text NOT NULL DEFAULT 'localhost',
  nodeport int  NOT NULL DEFAULT 5432,
  database text NOT NULL DEFAULT current_database(),
  username text NOT NULL DEFAULT current_user,
  active   boolean NOT NULL DEFAULT true,
  jobname  text UNIQUE
);
CREATE TABLE IF NOT EXISTS cron.job_run_details (
  runid          bigserial PRIMARY KEY,
  jobid          bigint,
  status         text,
  return_message text,
  start_time     timestamptz,
  end_time       timestamptz
);

CREATE OR REPLACE FUNCTION cron.schedule(job_name text, schedule text, command text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO cron.job (jobname, schedule, command)
  VALUES (job_name, schedule, command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command, active = true
  RETURNING jobid INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION cron.schedule(schedule text, command text)
RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (schedule, command) VALUES (schedule, command) RETURNING jobid
$$;

CREATE OR REPLACE FUNCTION cron.unschedule(job_name text)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = job_name;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION cron.unschedule(job_id bigint)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM cron.job WHERE jobid = job_id;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION cron.alter_job(
  job_id bigint,
  schedule text DEFAULT NULL,
  command text DEFAULT NULL,
  database text DEFAULT NULL,
  username text DEFAULT NULL,
  active boolean DEFAULT NULL
) RETURNS void LANGUAGE sql AS $$
  UPDATE cron.job SET
    schedule = coalesce(alter_job.schedule, job.schedule),
    command  = coalesce(alter_job.command,  job.command),
    database = coalesce(alter_job.database, job.database),
    username = coalesce(alter_job.username, job.username),
    active   = coalesce(alter_job.active,   job.active)
  WHERE job.jobid = alter_job.job_id
$$;

-- ---------- net (async HTTP queue; drained by the API job runner) -----------
CREATE TABLE IF NOT EXISTS net.http_request_queue (
  id          bigserial PRIMARY KEY,
  method      text NOT NULL,
  url         text NOT NULL,
  headers     jsonb NOT NULL DEFAULT '{}'::jsonb,
  body        jsonb,
  timeout_ms  int NOT NULL DEFAULT 5000,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  status_code int,
  error       text
);

CREATE OR REPLACE FUNCTION net.http_post(
  url text,
  body jsonb DEFAULT '{}'::jsonb,
  params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds int DEFAULT 5000
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = net, public AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO net.http_request_queue (method, url, headers, body, timeout_ms)
  VALUES ('POST', url, coalesce(headers, '{}'::jsonb), body, timeout_milliseconds)
  RETURNING id INTO v_id;
  PERFORM pg_notify('net_http_request', v_id::text);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION net.http_get(
  url text,
  params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds int DEFAULT 5000
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = net, public AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO net.http_request_queue (method, url, headers, timeout_ms)
  VALUES ('GET', url, coalesce(headers, '{}'::jsonb), timeout_milliseconds)
  RETURNING id INTO v_id;
  PERFORM pg_notify('net_http_request', v_id::text);
  RETURN v_id;
END $$;

GRANT USAGE ON SCHEMA net, cron TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA net TO authenticated, service_role;

-- ---------- realtime ---------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- Generic change notifier. Payload carries the primary key + small record;
-- the API re-reads the row under each subscriber's JWT so RLS is enforced.
CREATE OR REPLACE FUNCTION realtime.notify_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_old jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_payload jsonb;
BEGIN
  v_payload := jsonb_build_object(
    'schema', TG_TABLE_SCHEMA,
    'table',  TG_TABLE_NAME,
    'type',   TG_OP,
    'id',     coalesce(v_new ->> 'id', v_old ->> 'id'),
    'commit_timestamp', now()
  );
  -- pg_notify payloads are capped at 8000 bytes: only inline small rows.
  IF octet_length(coalesce(v_new, v_old)::text) < 6000 THEN
    v_payload := v_payload || jsonb_build_object('record', v_new, 'old_record', v_old);
  ELSE
    v_payload := v_payload || jsonb_build_object('truncated', true,
      'old_record', CASE WHEN v_old IS NULL THEN NULL ELSE jsonb_build_object('id', v_old ->> 'id') END);
  END IF;
  PERFORM pg_notify('realtime_changes', v_payload::text);
  RETURN NULL;
END $$;

-- Install/remove notify triggers to match the publication membership.
CREATE OR REPLACE FUNCTION realtime.sync_triggers() RETURNS int
LANGUAGE plpgsql AS $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_realtime_notify ON %I.%I', r.schemaname, r.tablename);
    EXECUTE format(
      'CREATE TRIGGER zz_realtime_notify AFTER INSERT OR UPDATE OR DELETE ON %I.%I
         FOR EACH ROW EXECUTE FUNCTION realtime.notify_change()', r.schemaname, r.tablename);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- ---------- platform bookkeeping --------------------------------------------
CREATE TABLE IF NOT EXISTS platform.schema_migrations (
  name       text PRIMARY KEY,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Settings legacy SQL reads via current_setting('app.settings.*') /
-- ('supabase.*'). The runner writes them as database-level GUCs.
