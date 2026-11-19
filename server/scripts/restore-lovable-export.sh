#!/usr/bin/env bash
# Restore a Lovable Cloud database export (pg_dump custom format, "Export data" in
# More → Database → Manage → Settings) into a throwaway Postgres 17 container, so that
# migrate-from-supabase.mjs can read it as SOURCE_DATABASE_URL.
#
#   server/scripts/restore-lovable-export.sh <export.backup> [docker-network]
#
# Creates container `prodcopy` (no published ports) on the network (default matbex_default)
# with a random password in <dir of export>/.prodcopy-pw (mode 600), and prints the
# SOURCE_DATABASE_URL to use from another container on that network. Remove it afterwards:
#   docker rm -f prodcopy && rm <export> <dir>/.prodcopy-pw
#
# Expected restore errors (Supabase-only pieces plain Postgres cannot create): extensions
# pg_cron, pg_net, pgmq, supabase_vault and their objects. Any "COPY failed" for a table in
# public, auth or storage is a real problem: the script stops and shows it.
set -euo pipefail

EXPORT="${1:?usage: $0 <export.backup> [docker-network]}"
NETWORK="${2:-matbex_default}"
DIR="$(cd "$(dirname "$EXPORT")" && pwd)"
FILE="$(basename "$EXPORT")"
PW_FILE="$DIR/.prodcopy-pw"

[ -f "$PW_FILE" ] || (umask 077; openssl rand -hex 24 > "$PW_FILE")
docker rm -f prodcopy >/dev/null 2>&1 || true
docker run -d --name prodcopy --network "$NETWORK" -e POSTGRES_PASSWORD="$(cat "$PW_FILE")" \
  -v "$DIR":/x:ro postgres:17-alpine >/dev/null
until docker exec prodcopy pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2
docker exec prodcopy psql -U postgres -qc "create database prod"

# Roles the dump's grants and policies refer to, and the extensions schema Supabase uses.
docker exec -i prodcopy psql -U postgres -d prod -q -v ON_ERROR_STOP=1 <<'SQL'
do $$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role','supabase_admin','supabase_auth_admin',
                           'supabase_storage_admin','authenticator','dashboard_user'] loop
    if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if;
  end loop; end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
SQL

LOG="$DIR/restore.log"
docker exec prodcopy pg_restore -U postgres -d prod --no-owner --no-privileges "/x/$FILE" >"$LOG" 2>&1 || true
if grep -E 'COPY failed for table' "$LOG" | grep -vE 'table "(subscription|messages[_0-9a-z]*)"' >/dev/null; then
  echo "Data load failed for some tables (see $LOG):" >&2
  grep -E 'COPY failed for table' "$LOG" >&2
  exit 1
fi
echo "restore finished; $(grep -c 'pg_restore: error' "$LOG" || true) expected errors (Supabase-only extensions), log: $LOG"

# pg_cron is not available here: load the scheduled jobs into a plain table of the same shape
# (the data move's `cron` step reads it).
docker exec -i prodcopy psql -U postgres -d prod -q -v ON_ERROR_STOP=1 <<'SQL'
create schema if not exists cron;
create table if not exists cron.job (jobid bigint primary key, schedule text, command text, nodename text,
  nodeport int, database text, username text, active boolean, jobname text);
SQL
docker exec prodcopy pg_restore -U postgres -d prod --data-only -n cron -t job "/x/$FILE" >/dev/null 2>&1 || true

docker exec -i prodcopy psql -U postgres -d prod -At <<'SQL'
select 'users ' || count(*) from auth.users;
select 'sales ' || count(*) from public.sales_transactions;
select 'storage objects ' || count(*) from storage.objects;
select 'cron jobs ' || count(*) from cron.job;
SQL
echo "SOURCE_DATABASE_URL=postgres://postgres:<password in $PW_FILE>@prodcopy:5432/prod (from network $NETWORK)"
