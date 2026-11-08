---
name: RLS cross-tenant and branch-pin contract tests
description: Skeleton vitest suites in src/lib/__tests__/rlsTenantIsolation.contract.test.ts and rlsBranchPinIsolation.contract.test.ts run in CI when RLS_TEST_* env vars are set. Add new tenant-private tables to TENANT_PRIVATE_TABLES and new branch-scoped tables to BRANCH_SCOPED_TABLES whenever a migration introduces them.
type: constraint
---
- Tests skip when env vars are absent so they don't block local dev.
- Required CI env vars: `RLS_TEST_TENANT_A_EMAIL`, `RLS_TEST_TENANT_A_PASSWORD`, `RLS_TEST_TENANT_B_ID`, `RLS_TEST_BRANCH_CASHIER_EMAIL`, `RLS_TEST_BRANCH_CASHIER_PASSWORD`, `RLS_TEST_FORBIDDEN_BRANCH_ID`.
- When you add a new table scoped by `tenant_id`, append it to `TENANT_PRIVATE_TABLES`. When you add `branch_id` + the branch-pin RESTRICTIVE policy, append it to `BRANCH_SCOPED_TABLES`. Otherwise a missing-filter regression is invisible.
- An empty result OR a PostgREST permission error both count as "no leak"; a non-empty `data` array fails the test.