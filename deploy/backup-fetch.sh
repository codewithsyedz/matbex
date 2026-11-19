#!/usr/bin/env bash
# Streams one backup object from R2 to stdout, or lists them. Runs on the server (it holds the
# R2 keys); the object is still encrypted, decrypt it on a machine with the private key
# (deploy/restore-backup.sh).
#
#   ssh matbex-staging 'bash ~/matbex/deploy/backup-fetch.sh list'
#   ssh matbex-staging 'bash ~/matbex/deploy/backup-fetch.sh latest-db' > db.bak
#   ssh matbex-staging 'bash ~/matbex/deploy/backup-fetch.sh daily/2026-11-11T2157Z-db.bak' > db.bak
set -euo pipefail
APP=~/matbex
envval() { grep -E "^$1=" "$APP/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"; }
BUCKET=$(envval R2_BACKUP_BUCKET)
r2() {
  docker run --rm -i \
    -e RCLONE_CONFIG_R2_TYPE=s3 -e RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
    -e RCLONE_CONFIG_R2_ACCESS_KEY_ID="$(envval R2_ACCESS_KEY_ID)" -e RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$(envval R2_SECRET_ACCESS_KEY)" \
    -e RCLONE_CONFIG_R2_ENDPOINT="$(envval R2_ENDPOINT)" -e RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true \
    rclone/rclone:1.68.2 -q "$@"
}
what=${1:?list | latest-db | latest-files | <path in bucket>}
case "$what" in
  list) r2 lsl "r2:$BUCKET/" ;;
  latest-db|latest-files)
    kind=${what#latest-}
    name=$(r2 lsf "r2:$BUCKET/daily/" --include "*-$kind.bak" | sort | tail -1)
    [ -n "$name" ] || { echo "no $kind backup found" >&2; exit 1; }
    echo "fetching daily/$name" >&2
    r2 cat "r2:$BUCKET/daily/$name" ;;
  *) r2 cat "r2:$BUCKET/$what" ;;
esac
