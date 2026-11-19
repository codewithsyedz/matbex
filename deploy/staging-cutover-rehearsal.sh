#!/usr/bin/env bash
# Full cutover rehearsal on the staging server, into a throwaway database named "rehearsal".
# The staging database, API and worker are not touched. Source: a Lovable export restored into
# the `prodcopy` container with server/scripts/restore-lovable-export.sh ~/export/<file>.backup
# (it writes ~/export/.prodcopy-pw). See docs/self-hosting/STAGING.md, "Cutover rehearsal".
#
#   staging-cutover-rehearsal.sh setup              # (re)create the rehearsal database, run all migrations
#   staging-cutover-rehearsal.sh move [args...]     # data move into it; dry run unless --yes
#   staging-cutover-rehearsal.sh smoke              # API + PostgREST on it, smoke test, then remove both
#   staging-cutover-rehearsal.sh cleanup            # remove containers, prodcopy and the rehearsal database
#
# The report goes to ~/export/rehearsal-report.json. Afterwards delete the export and .prodcopy-pw.
set -euo pipefail
cd ~/matbex
envval() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
DATABASE_URL=$(envval DATABASE_URL); AUTHENTICATOR_PASSWORD=$(envval AUTHENTICATOR_PASSWORD); JWT_SECRET=$(envval JWT_SECRET)
REH_URL="${DATABASE_URL%/*}/rehearsal"
COPY_SRC='mkdir /work && cd /src && tar --exclude=./.env --exclude=./server/node_modules --exclude=./node_modules --exclude=./android -cf - . | tar -xf - -C /work && cd /work/server && npm ci --no-audit --no-fund >/dev/null 2>&1'

case "${1:?usage: $0 setup|move|smoke|cleanup}" in
setup)
  docker compose exec -T db psql -U postgres -qc "drop database if exists rehearsal" -c "create database rehearsal"
  docker run --rm --network matbex_default --env-file .env -e DATABASE_URL="$REH_URL" matbex-api:latest \
    node db/migrate.mjs 2>&1 | tail -5
  ;;
move)
  shift
  PW=$(cat ~/export/.prodcopy-pw)
  docker run --rm --network matbex_default --env-file .env -e DATABASE_URL="$REH_URL" -e API_URL=http://rehearsal-api:8000 \
    -e STORAGE_DRIVER=fs -e STORAGE_FS_ROOT=/tmp/files \
    -e SOURCE_DATABASE_URL="postgres://postgres:${PW}@prodcopy:5432/prod" \
    -v "$PWD":/src:ro -v ~/export:/out node:22-alpine sh -c \
    "$COPY_SRC && node scripts/migrate-from-supabase.mjs --report /out/rehearsal-report.json --state /out/rehearsal-state.json $*"
  ;;
smoke)
  trap 'docker rm -f rehearsal-api rehearsal-pgrst >/dev/null 2>&1 || true' EXIT
  docker rm -f rehearsal-api rehearsal-pgrst >/dev/null 2>&1 || true
  docker run -d --name rehearsal-pgrst --network matbex_default \
    -e PGRST_DB_URI="postgres://authenticator:${AUTHENTICATOR_PASSWORD}@db:5432/rehearsal" \
    -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$JWT_SECRET" \
    postgrest/postgrest:v12.2.3 >/dev/null
  # API_URL must point at this API: functions that act as the caller call back into it, and
  # staging's .env value would send them to the real staging API (smoke then fails with 401/404).
  # Jobs off and no Redis: nothing scheduled runs and nothing is sent.
  docker run -d --name rehearsal-api --network matbex_default --env-file .env \
    -e ROLE=api -e API_URL=http://rehearsal-api:8000 -e PORT=8000 -e NODE_ENV=production \
    -e DATABASE_URL="$REH_URL" -e POSTGREST_URL=http://rehearsal-pgrst:3000 \
    -e STORAGE_DRIVER=fs -e STORAGE_FS_ROOT=/tmp/files -e JOBS_ENABLED=false -e REDIS_URL= \
    matbex-api:latest >/dev/null
  for _ in $(seq 1 60); do
    docker run --rm --network matbex_default curlimages/curl:8.10.1 -sf http://rehearsal-api:8000/health >/dev/null 2>&1 && break
    sleep 2
  done
  docker run --rm --network matbex_default --env-file .env -e API_URL=http://rehearsal-api:8000 \
    -v "$PWD":/src:ro node:22-alpine sh -c "$COPY_SRC && npx tsx scripts/smoke-test.ts"
  ;;
cleanup)
  docker rm -f rehearsal-api rehearsal-pgrst prodcopy >/dev/null 2>&1 || true
  docker compose exec -T db psql -U postgres -qc "drop database if exists rehearsal"
  ;;
esac
