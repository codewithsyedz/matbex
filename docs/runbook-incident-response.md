# Incident Response Runbook

For Matbex on-call: backup, restore, and common recovery procedures.
Keep this file synced with reality — drift kills recovery time.

## Severity matrix

| Sev | Definition | Page | Comms |
|---|---|---|---|
| Sev-1 | Platform-wide outage, billing failure, or PII exposure | Immediately | Status page + tenant email within 30 min |
| Sev-2 | Single-tenant data corruption, mass mis-delete | Within 1 h | Direct tenant call within 4 h |
| Sev-3 | Degraded perf, non-blocking bug | Next business day | Internal only |

## 1. Tenant data corruption (Sev-2)

Symptoms: tenant reports missing rows, wrong balances, or duplicated journal entries.

1. **Freeze writes for that tenant.** Set `tenants.write_locked = true` (RLS
   policy blocks all non-SuperAdmin writes when this is on).
2. **Snapshot current state.** `pg_dump --schema=public --data-only
   --where="tenant_id='<uuid>'" > /tmp/tenant-<uuid>-<ts>.sql`.
3. **Identify divergence point.** Cross-check `audit_logs` and
   `superadmin_audit_logs` for entries around the report time. Feature-flag
   triggers (#12) log all `plans` / `tenant_features` / `tenant_addons` deltas.
4. **Restore.** Two options:
   - **Surgical:** apply inverse of the offending writes (re-INSERT voided
     ledger rows from `old_data` JSONB in audit_logs). Preferred — preserves
     other tenants' subsequent writes.
   - **PITR (Supabase):** Project → Database → Backups → Point-in-Time
     Restore. Restores entire DB. Only for catastrophic corruption.
5. **Unfreeze.** `tenants.write_locked = false`.
6. **Post-mortem.** Required for any Sev-2.

## 2. Accidental mass delete via soft-delete bypass

The project enforces `deleted_at` for soft delete; raw `DELETE` should only
come from SuperAdmin migrations.

1. **Confirm scope.** `SELECT count(*) FROM <table> WHERE deleted_at IS NOT NULL
   AND deleted_at > now() - interval '1 hour';`
2. **Bulk restore.** `UPDATE <table> SET deleted_at = NULL WHERE deleted_at
   BETWEEN '<window>'::timestamptz AND '<window>'::timestamptz AND tenant_id
   = '<uuid>';` — wrap in a transaction and run from a migration so the
   change is auditable.
3. **If hard-deleted:** PITR (above). There is no other recovery for hard
   deletes outside the 7-day backup window.
4. **Patch the bypass.** Find the call site that issued the raw DELETE and
   route it through the soft-delete helper. Add a contract test.

## 3. Stripe webhook replay

If `payments-reconciler` falls behind or webhooks were missed (Stripe outage,
deploy gap, secret rotation):

1. **Confirm gap.** Stripe Dashboard → Developers → Webhooks → endpoint
   logs. Note the timestamp range of unprocessed events.
2. **Replay in Stripe.** Each failed event has a "Resend" button. For bulk:
   `stripe events resend <evt_id>` per event, or use the Stripe API
   `POST /v1/events/<id>/resend`.
3. **Verify idempotency.** Our webhook handler uses
   `stripe_event_id` as a uniqueness key — duplicate deliveries are safe.
4. **Reconcile manually.** Run `payments-reconciler` once with a wider
   window: `curl -X POST $SUPABASE_URL/functions/v1/payments-reconciler -d
   '{"since":"<iso-ts>"}'` (SuperAdmin auth).
5. **Confirm.** `SELECT * FROM subscriptions WHERE tenant_id = '<uuid>'`
   matches Stripe Customer subscription status.

## 4. Auth degraded / login storm

1. Set `degraded_mode` flag in `system_health` table → `DegradedModeBanner`
   surfaces in the app, login UI shows reassurance copy.
2. Confirm Supabase Auth status (Supabase Dashboard → Project Health).
3. If JWTs are still valid: no user impact yet. Buy time by extending
   `staleTime` on critical queries via a deploy.
4. Once resolved, clear the flag.

## 5. Edge function spiking errors

Watch `/admin/edge-health` — error rate > 1% or p95 > 1500 ms on a hot path
is the threshold.

1. `bun supabase functions logs <name>` (or use the Supabase tool) to find
   the error pattern.
2. If it's an upstream outage (Stripe, Upstash, Resend): flip the relevant
   tenant_feature flag off (e.g. `feature_redis_cache = false`) and let the
   fallback path take over.
3. If it's a code regression: revert the function deploy. Edge functions
   are immutable per deploy, so the previous deploy can be redeployed
   verbatim.

## Backup posture (current)

- **Daily logical backups:** Supabase managed, 7-day retention.
- **PITR:** Supabase managed, 7-day window, minute granularity (Pro plan).
- **Storage buckets (press-assets, branding, receipts):** versioning ON;
  manual restore via Supabase Storage UI.
- **Audit logs:** never deleted, no UPDATE allowed, append-only by RLS.

## Contacts

| Role | Who | When |
|---|---|---|
| On-call SuperAdmin | rotation list in 1Password | 24/7 |
| Supabase support (Pro) | dashboard support ticket | <2 h SLA |
| Stripe support | dashboard | <4 h SLA |
| Upstash support | console | best effort |
