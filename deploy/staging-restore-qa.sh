#!/usr/bin/env bash
# Copy the QA Test Kitchen business (tenant, restaurant, branch, its 3 users) from database
# oldstaging (pre-refresh staging) into matbex. Triggers off (replica), generated columns skipped.
# Run on the staging server after a data refresh (docs/self-hosting/STAGING.md):
#   docker compose exec -T db psql -U postgres -c 'create database oldstaging'
#   docker compose exec -T db pg_restore -U postgres -d oldstaging --no-owner < ~/export/<pre-refresh>.dump
#   bash deploy/staging-restore-qa.sh
# auth.users rows (passwords unchanged) are copied first.
set -euo pipefail
cd ~/matbex
T=b8bcd192-9f78-431c-b94b-34633ef82f86
R=84e4459f-da04-4984-8a06-00175c31577e
B=9f1e72df-368e-49a4-a669-f4fbfb75585e

q() { docker compose exec -T db psql -U postgres -d "$1" -At -c "$2"; }

copy() { # schema table condition
  local cols n
  cols=$(q matbex "select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema='$1' and table_name='$2' and is_generated='NEVER'")
  n=$(q oldstaging "select count(*) from $1.$2 where $3")
  [ "$n" = 0 ] && return 0
  docker compose exec -T db psql -U postgres -d oldstaging -At -c "COPY (select $cols from $1.$2 where $3) TO STDOUT" \
    | docker compose exec -T -e PGOPTIONS="-c session_replication_role=replica" db \
        psql -U postgres -d matbex -v ON_ERROR_STOP=1 -q -c "COPY $1.$2 ($cols) FROM STDIN"
  echo "$1.$2 $n"
}

UIDS=$(q oldstaging "select string_agg(quote_literal(user_id::text), ',') from public.user_tenant_roles where tenant_id='$T'")
copy auth users "id::text in ($UIDS)"
if [ -n "$(q oldstaging "select 1 from information_schema.tables where table_schema='auth' and table_name='mfa_factors'")" ]; then
  copy auth mfa_factors "user_id::text in ($UIDS)"
fi
copy public tenants "id='$T'"
copy public restaurants "id='$R'"
copy public profiles "id::text in ($UIDS)"

TABLES=$(q oldstaging "select c.table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name) where c.table_schema='public' and t.table_type='BASE TABLE' and c.column_name in ('tenant_id','restaurant_id','branch_id','user_id') and c.table_name not in ('tenants','restaurants','profiles') group by c.table_name order by c.table_name")
for tbl in $TABLES; do
  cond=$(q oldstaging "select string_agg(case column_name when 'tenant_id' then 'tenant_id::text=''$T''' when 'restaurant_id' then 'restaurant_id::text=''$R''' when 'branch_id' then 'branch_id::text=''$B''' else 'user_id::text in (' || \$x\$$UIDS\$x\$ || ')' end, ' or ') from information_schema.columns where table_schema='public' and table_name='$tbl' and column_name in ('tenant_id','restaurant_id','branch_id','user_id')")
  copy public "$tbl" "$cond"
done
