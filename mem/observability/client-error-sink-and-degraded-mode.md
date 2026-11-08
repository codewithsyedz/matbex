---
name: Client error sink and degraded-mode banner
description: Frontend errors flow into public.client_errors via src/lib/errorReporter.ts (sampled, throttled). DegradedModeBanner polls a HEAD on public.tenants every 60s and surfaces backend outages so React Query retry/backoff doesn't look like infinite skeletons.
type: feature
---
- `src/lib/errorReporter.ts` is the only place we write to `public.client_errors`. Default sample 25%, force-sample boundaries at 1.0. Fingerprint cooldown 60s.
- `installGlobalErrorReporter()` is called once from `App.tsx` (window.error + unhandledrejection).
- `LazyLoadErrorBoundary.componentDidCatch` reports every catch (warning for chunk errors, fatal otherwise) before the auto-reload.
- `DegradedModeBanner` (mounted in `App.tsx` outside the router) polls `supabase.from('tenants').select('id', { count:'exact', head:true })` every 60s. Two consecutive failures → amber banner. PGRST* error codes count as "backend is up" (auth issue, not outage).
- RLS on `client_errors`: anon INSERT allowed (so pre-auth chunk failures still land); SELECT restricted to owners/managers via `user_roles` join scoped to the caller's `profiles.tenant_id`.