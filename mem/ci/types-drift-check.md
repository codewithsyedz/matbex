---
name: Supabase types drift CI check
description: CI guard that regenerates Supabase types and fails on diff against committed src/integrations/supabase/types.ts
type: preference
---

Every migration must be accompanied by a regenerated `src/integrations/supabase/types.ts`. CI runs `npm run lint:types-drift` which calls `scripts/check-types-drift.cjs`:

- Requires `SUPABASE_ACCESS_TOKEN` env. Skips with a notice when absent (local dev safe).
- Calls `supabase gen types typescript --project-id <ref> --schema public` and diffs against the committed file.
- Exits 1 on drift, 0 on match.

**Why:** Without this guard, a migration can land, the schema changes, but the generated `types.ts` stays stale. TS compiles green, runtime queries fail with "column does not exist".

**How to apply:** When writing any migration, also regenerate types before opening the PR. The Lovable agent regenerates types automatically after applying migrations — humans must do it manually.

**Project ref:** tlkyubkbbqwmzjaogavb (default in script).