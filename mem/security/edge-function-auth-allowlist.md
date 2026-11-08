---
name: Edge function auth allowlist
description: Every edge function with verify_jwt = false MUST either call requireUser()/getClaims()/verifyWebhookSignature OR be explicitly listed in scripts/.edge-auth-allowlist.json with a reason. Enforced by scripts/check-edge-function-auth.cjs (npm run lint:edge-auth).
type: constraint
---
- Adding a new `verify_jwt = false` function without auth in code OR an allowlist entry breaks `npm run lint:edge-auth`.
- Allowlist categories that are acceptable: signature-validated webhooks, pre-auth registration/OTP flows, pg_cron-only workers, OAuth callbacks, signed-URL PDF rendering, device-JWT (terminal) flows.
- Never silence the check by adding a function to the allowlist without a real `reason` string — reviewers should reject empty/lazy reasons.
- The check parses `supabase/config.toml` for the source of truth. Inline `_doc` keys in the allowlist are ignored except as documentation.