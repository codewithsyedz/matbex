#!/usr/bin/env bash
# Deploy the code already copied to ~/matbex on the staging server (see
# .github/workflows/deploy-staging.yml and docs/self-hosting/STAGING.md):
# build images, apply migrations, restart, then run the smoke test against the new API.
#   ssh matbex-staging 'bash ~/matbex/deploy/staging-deploy.sh'
# Exits non-zero (and leaves the previous containers running if the build fails) on any error.
set -euo pipefail
cd ~/matbex
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.observability.yml)

echo "== deploying $(cat .deployed-commit 2>/dev/null || echo unknown)"
# migrate is its own image (same Dockerfile): rebuild it too, or it runs the migrations baked in at its first build.
"${COMPOSE[@]}" build api worker web migrate
"${COMPOSE[@]}" run --rm migrate
"${COMPOSE[@]}" up -d --remove-orphans

echo "== waiting for the API"
for _ in $(seq 1 60); do
  if docker compose exec -T api node -e "fetch('http://127.0.0.1:8000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    break
  fi
  sleep 2
done

echo "== smoke test"
docker run --rm --network matbex_default --env-file .env -e API_URL=http://api:8000 -v "$PWD":/src:ro node:22-alpine sh -c \
  "mkdir /work && cd /src && tar --exclude=./.env --exclude=./server/node_modules --exclude=./node_modules --exclude=./android -cf - . | tar -xf - -C /work && cd /work/server && npm ci --no-audit --no-fund >/dev/null 2>&1 && npx tsx scripts/smoke-test.ts"

docker image prune -f >/dev/null
echo "== done"
