# Platform (self-hosted, no Supabase / Lovable)
- Stack: React + Vite web app (src/) → Matbex API (server/, Fastify) → PostgreSQL 16. PostgREST runs privately behind the API for /rest/v1.
- The only browser/server API client is `@matbex/client` (packages/client). Import the app instance as `import { db } from "@/integrations/db/client"`. Never add @supabase/* or lovable packages.
- Security lives in Postgres RLS + `auth.uid()`; every new table needs RLS policies. Storage access is decided by RLS on storage.objects.
- New SQL functions are not callable by logged-out users (anon) by default; grant `EXECUTE ... TO anon` explicitly only for public flows, and make every SECURITY DEFINER function check the caller's tenant/restaurant access before touching tenant data (see docs/self-hosting/FUNCTION_ACCESS_REVIEW.md).
- Schema changes: `npm run db:new <name>` → write SQL in db/migrations → `npm run db:migrate` → `npm run db:types`. Never edit an applied migration.
- Server functions live in server/functions/<name>/index.ts and call `serve(handler)` from `_runtime/serve.ts`; read config with `env()` from `_runtime/env.ts`. Public (no-JWT) functions must be listed in functions.config.json and pass `npm run lint:edge-auth`.
- New backend features should prefer typed routes under /api/v1 in server/src (strangler target) over new direct table access from the browser.
- AI calls go through server/functions/_runtime/ai.ts (Anthropic). Email goes through server/src/email/send.ts (Resend). Twilio via _shared/twilio.ts.

# Architecture rules
- Subscription checkout and success verification use server-validated owner membership and allowlisted Stripe prices; only paid, active, tenant-bound subscriptions activate existing trials, independently of application registration.

- Apply Starter plan route restrictions only inside TenantRoute; LazyRoute renders public/auth/payment pages without plan checks so upgrades and account recovery stay accessible.

- ZATCA provider applications are separate records per submission; retain each record and its original document links for account history.
- Demo bookings are stored in contact_messages and linked to lead_attributions by lead_ref, so lead reports read actual booking details rather than copying them.
- Expense VAT reversals use the authorized expense correction RPC; amendments offset both original expense lines and retroactive VAT correction lines before reposting, preserving balanced immutable history.
- Accountant inventory creation is authorized at both navigation and database levels; creation respects the selected branch without granting inventory deletion.
- Accountant-only sessions render a lazy accountant dashboard at /dashboard; queries use real restaurant-scoped data, paginated totals, separate period metrics and all-date review backlog without admin privileges.
- Accountant pending-work emails use a dedicated authenticated function with fixed recipient/restaurant, caller-scoped reads and content-derived idempotency; dashboard refresh invokes it. Scheduled runs belong in server/src/jobs/schedules.ts (not new pg_cron migrations).