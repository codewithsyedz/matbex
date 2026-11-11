#!/usr/bin/env bash
# Nightly encrypted backup of the database and stored files to Cloudflare R2.
#
#   bash ~/matbex/deploy/backup.sh            # cron: see docs/self-hosting/BACKUPS.md
#
# 1. pg_dump (custom format) of the database, checked with pg_restore -l;
#    tar.gz of the `objects` volume (STORAGE_DRIVER=fs files).
# 2. Each is encrypted with a fresh random 256-bit key (AES-256-CBC, PBKDF2); that key is
#    encrypted with the backup PUBLIC key (RSA-OAEP, ~/backup/backup-public.pem). The private
#    key never lives on this server, so neither the server nor the R2 keys can read a backup.
# 3. Uploaded as one .bak (tar) per item to r2:<bucket>/daily/, and on the 1st of the month
#    also to monthly/. Retention: daily 31 days, monthly 370 days.
# 4. On success writes ~/backup/last-success (UTC time + sizes); exits non-zero on any failure.
#
# Needs in ~/matbex/.env: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BACKUP_BUCKET.
set -euo pipefail

APP=~/matbex
STATE=~/backup
PUBKEY="$STATE/backup-public.pem"
RCLONE_IMAGE=rclone/rclone:1.68.2
ALPINE_IMAGE=alpine:3.20
DB=matbex

envval() { grep -E "^$1=" "$APP/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"; }
R2_ENDPOINT=$(envval R2_ENDPOINT); R2_ACCESS_KEY_ID=$(envval R2_ACCESS_KEY_ID)
R2_SECRET_ACCESS_KEY=$(envval R2_SECRET_ACCESS_KEY); BUCKET=$(envval R2_BACKUP_BUCKET)
for v in R2_ENDPOINT R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY BUCKET; do
  [ -n "${!v}" ] || { echo "missing $v in $APP/.env"; exit 2; }
done
[ -s "$PUBKEY" ] || { echo "missing $PUBKEY"; exit 2; }

rclone() {
  docker run --rm -i -v "$WORK:/work" \
    -e RCLONE_CONFIG_R2_TYPE=s3 -e RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
    -e RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" -e RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    -e RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT" -e RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true \
    "$RCLONE_IMAGE" "$@"
}

# Encrypt $1 into $2 (.bak = tar of data.enc, key.enc, sha256).
seal() {
  local src=$1 out=$2 d
  d=$(mktemp -d "$WORK/seal.XXXX")
  openssl rand -out "$d/key" 32
  openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -in "$src" -out "$d/data.enc" -pass "file:$d/key"
  openssl pkeyutl -encrypt -pubin -inkey "$PUBKEY" -pkeyopt rsa_padding_mode:oaep -in "$d/key" -out "$d/key.enc"
  sha256sum "$src" | cut -d' ' -f1 > "$d/sha256"
  rm -f "$d/key"
  tar -C "$d" -cf "$out" data.enc key.enc sha256
  rm -rf "$d"
}

mkdir -p "$STATE"
WORK=$(mktemp -d "$STATE/work.XXXX")
trap 'rm -rf "$WORK"' EXIT
STAMP=$(date -u +%Y-%m-%dT%H%MZ)
cd "$APP"

echo "== $STAMP database"
docker compose exec -T db pg_dump -U postgres -Fc -d "$DB" > "$WORK/db.dump"
[ -s "$WORK/db.dump" ] || { echo "empty database dump"; exit 1; }
docker compose exec -T db pg_restore -l < "$WORK/db.dump" > /dev/null   # readable archive
seal "$WORK/db.dump" "$WORK/out-$STAMP-db.bak"; rm -f "$WORK/db.dump"

echo "== $STAMP files"
docker run --rm -v matbex_objects:/data:ro "$ALPINE_IMAGE" tar -C /data -czf - . > "$WORK/files.tar.gz"
seal "$WORK/files.tar.gz" "$WORK/out-$STAMP-files.bak"; rm -f "$WORK/files.tar.gz"

mkdir -p "$WORK/up"
mv "$WORK/out-$STAMP-db.bak" "$WORK/up/$STAMP-db.bak"
mv "$WORK/out-$STAMP-files.bak" "$WORK/up/$STAMP-files.bak"

echo "== upload"
rclone copy /work/up "r2:$BUCKET/daily/"
if [ "$(date -u +%d)" = "01" ]; then rclone copy /work/up "r2:$BUCKET/monthly/"; fi
rclone check /work/up "r2:$BUCKET/daily/" --one-way

echo "== retention"
rclone delete "r2:$BUCKET/daily/" --min-age 31d
rclone delete "r2:$BUCKET/monthly/" --min-age 370d

sizes=$(du -h "$WORK/up/"* | awk '{printf "%s %s; ", $1, $2}' | sed "s#$WORK/up/##g")
echo "$STAMP $sizes" > "$STATE/last-success"
echo "== done: $sizes"
