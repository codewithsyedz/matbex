#!/usr/bin/env bash
# Decrypts a backup made by deploy/backup.sh. Runs where the PRIVATE key is (not the server).
#
#   ssh matbex-staging 'bash ~/matbex/deploy/backup-fetch.sh latest-db' > db.bak
#   deploy/restore-backup.sh db.bak db.dump          # -> pg_dump custom-format file
#   deploy/restore-backup.sh files.bak files.tar.gz  # -> tar.gz of the objects volume
#
# Key: BACKUP_PRIVATE_KEY (default ~/.matbex/backup-private.pem). Checks the SHA-256 recorded
# at backup time. Restore a dump with pg_restore (see docs/self-hosting/BACKUPS.md).
set -euo pipefail
in=${1:?encrypted .bak}; out=${2:?output file}
key=${BACKUP_PRIVATE_KEY:-$HOME/.matbex/backup-private.pem}
[ -r "$key" ] || { echo "private key not found: $key" >&2; exit 2; }
d=$(mktemp -d); trap 'rm -rf "$d"' EXIT
tar -C "$d" -xf "$in" data.enc key.enc sha256
openssl pkeyutl -decrypt -inkey "$key" -pkeyopt rsa_padding_mode:oaep -in "$d/key.enc" -out "$d/key"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -in "$d/data.enc" -out "$out" -pass "file:$d/key"
want=$(cat "$d/sha256")
got=$( (sha256sum "$out" 2>/dev/null || shasum -a 256 "$out") | cut -d' ' -f1)
[ "$want" = "$got" ] || { echo "checksum mismatch: backup is damaged" >&2; rm -f "$out"; exit 1; }
echo "decrypted $out ($(du -h "$out" | cut -f1)), checksum ok"
