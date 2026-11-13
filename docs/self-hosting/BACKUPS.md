# Backups

Nightly, encrypted, off the server, in Cloudflare R2. Set up on staging on 2026-11-12; production
gets the same at cutover.

## What runs

`deploy/backup.sh`, from the `deploy` user's crontab at 23:30 UTC (02:30 Riyadh):

```
30 23 * * * bash $HOME/matbex/deploy/backup.sh >> $HOME/backup/backup.log 2>&1 || date -u +"\%FT\%TZ backup FAILED" >> $HOME/backup/failures.log
```

1. `pg_dump -Fc` of the database (checked with `pg_restore -l`) and a tar.gz of the stored files:
   with `STORAGE_DRIVER=s3` (staging since 2026-11-13, production) a full copy of the files bucket,
   read with the app's `S3_*` keys and checked file by file; with `fs` the `matbex_objects` volume.
   Same layout either way (`<bucket_id>/<name>`), so restores do not depend on where files live.
2. Each is encrypted with a fresh random key (AES-256-CBC, PBKDF2); that key is encrypted with the
   backup **public** key (`~/backup/backup-public.pem`, RSA-4096 OAEP). The SHA-256 of the plain file
   goes along so a restore can prove nothing changed.
3. Uploaded to `r2:matbex-backups/daily/` (and `monthly/` on the 1st), then compared with R2.
   Retention: daily 31 days, monthly 370 days.
4. Success writes `~/backup/last-success`; a failure exits non-zero and lands in
   `~/backup/failures.log`. (Alerting on these comes with monitoring.)

Size on 2026-11-12: database 31 MB, files 364 MB per night, about 12 GB at full retention once files
are kept 31 days; R2's free tier is 10 GB-month, so expect well under 1 USD/month. Files on R2 are still
backed up the same way (encrypted, 31 days), because a bucket alone has no history: a deleted or
overwritten file would otherwise be gone.

Settings in `~/matbex/.env`: `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BACKUP_BUCKET` (an Account API token limited to the bucket, Object Read & Write). Set them
without showing them: `pbpaste | ssh matbex-staging "bash ~/set-env.sh NAME"`.

## The private key

Only the private key decrypts a backup, and it is **not on the server**: it was created on the
owner's Mac at `~/.matbex/backup-private.pem`. Keep a copy in a password manager or another safe
place: if it is lost, every backup is unreadable. If it leaks, make a new pair, put the new public key
on the server, and treat older backups as readable by whoever has the old key.

## Restore

From a machine with the private key:

```sh
ssh matbex-staging 'bash ~/matbex/deploy/backup-fetch.sh list'
ssh matbex-staging 'bash ~/matbex/deploy/backup-fetch.sh latest-db' > db.bak
deploy/restore-backup.sh db.bak db.dump            # checks the SHA-256
ssh matbex-staging 'bash ~/matbex/deploy/backup-fetch.sh latest-files' > files.bak
deploy/restore-backup.sh files.bak files.tar.gz
```

Into a database: create the roles first (`anon authenticated service_role authenticator
supabase_admin supabase_auth_admin dashboard_user`), then
`pg_restore --no-owner -d <db> db.dump`; restore files with
`docker run --rm -i -v matbex_objects:/data alpine tar -C /data -xzf - < files.tar.gz` (`fs`), or for
`s3` unpack it to a folder and upload with rclone: `rclone copy <folder> files:<S3_BUCKET>` (remote `files`
set up as in `deploy/backup.sh`).

**Tested 2026-11-12:** the first backup was fetched from R2, decrypted on the Mac and restored into a
fresh PostgreSQL 16: all 337 tables matched staging row for row (630,815 rows). The only restore
errors were three login-table foreign keys, caused by orphaned sessions the production import had
brought in (it loads with key checks off); those rows were removed on staging. Run the same test
after any change to the backup script, and at least once a quarter.
