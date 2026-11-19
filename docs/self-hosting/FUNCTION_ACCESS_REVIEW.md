# Database function access review (2026-11-09)

Who can call which SQL function through `/rest/v1/rpc/<name>`. It started from the
`current_cron_token()` leak (anyone could read the scheduler secret) and covers every
function in schema `public`.

## Result

| | Before | After |
| --- | ---: | ---: |
| Functions logged-out callers (`anon`) can execute | 436 | **44** |
| …of them `SECURITY DEFINER` (bypass RLS) | 396 | 41 (each reviewed, see below) |
| Functions logged-in users (`authenticated`) can execute | 451 | 393 |
| Definer functions logged-in users can aim at another tenant's data | 119 | 0 beyond the public, token-checked ones and RLS policy helpers (see below) |
| New functions executable by `anon` by default | yes | **no**: needs an explicit `GRANT … TO anon` |

Migrations:

* `20261109104352_revoke_anon_execute_on_internal_functions.sql`: revokes `anon` and `PUBLIC`
  from 392 functions, explicitly grants the 44 that logged-out code needs, and changes the
  default privileges so new functions are not public.
* `20261109111908_revoke_authenticated_execute_on_unchecked_internal_writers.sql`: revokes
  `authenticated` from 28 data-changing `SECURITY DEFINER` functions that never check the caller
  and are not called by the app as a user.
* `20261109120650_add_tenant_checks_to_definer_writers.sql`: tenant/restaurant access checks in the
  16 data-changing functions logged-in pages call, plus the `assert_restaurant_access` /
  `assert_tenant_access` helpers.
* `20261109121304_seed_cash_over_short_for_new_tenants.sql`: account 6999 for tenants created
  after May 2026, which day-end posting needs (found while testing the checks).
* `20261109122216_add_tenant_checks_to_definer_readers.sql`: the same checks in the 13 read-only
  functions logged-in pages call. It also revokes `authenticated` from 32 internal or server-only
  readers, and fixes `compliance_branch_score`, which errored for restaurants without compliance
  settings.

All of them are idempotent and skip signatures that do not exist, so they are safe to run on the
hosted Supabase project as well as on the new stack.

## Examples of what was open

* **Anyone, logged out:** `current_cron_token()` (scheduler secret, fixed earlier), and
  `ensure_standard_coa_accounts(tenant)`, which renames any tenant's accounts. Also `expire_trials()`,
  `sync_branch_seats_for_tenant(tenant)`, every `post_*_to_ledger(id)` and 150+ trigger functions.
* **Any logged-in user, against any tenant:** the same posting and seeding functions, plus
  `claim_promotion_slot`, `run_daily_reconciliation` and `purge_edge_function_metrics`. The
  data-changing ones the app does not need are revoked by the second migration.

## Method

1. Listed every function in `public` that `anon` could execute (`has_function_privilege`).
2. Found every RPC call site (`.rpc("…")`, including multi-line calls and `(db.rpc as any)("…")`, plus raw
   `rest/v1/rpc/…` URLs) in `src/`, `server/functions`, `server/src`, `packages/`, the Android overlay
   and the print agent.
3. Built the import graph from the app shell (`App.tsx`, `main.tsx`) and the 86 public routes (the
   `LazyRoute` pages in `AnimatedRoutes.tsx`). This gives 300 files that can run while logged out.
4. Kept `anon` on a function if any of these is true:
   * it is called from one of those files;
   * it is referenced by an RLS policy that applies to `anon`/`public` (otherwise the policy errors
     instead of filtering);
   * it is called by a `SECURITY INVOKER` trigger function (those run with the caller's rights).
5. Checked the remaining paths a role can reach a function without an RPC: column defaults and CHECK
   constraints on tables `anon` can insert into, and views `anon` can read. None depended on a revoked
   function.
6. Checked server functions that use the anon key. All of them forward the caller's JWT, so they
   run as `authenticated` and are unaffected.
7. Verified locally:
   * the API smoke test (25/25);
   * direct probes as `anon`: revoked functions return `42501`, kept ones answer normally;
   * a browser sweep logged out (landing page, registration, online ordering, QR table ordering, sign-in)
     and logged in as an owner (dashboard, POS sale, expenses, inventory, reports), with no 401 or 403
     from any RPC;
   * that tenant creation still seeds the chart of accounts through the restricted functions.

Limits: this is static analysis of this repository. A function called with a name built at runtime,
or only by a client outside this repo, would be missed. None were found, but watch the API log for
`42501 permission denied for function` after deploying. Functions created by hand in the Supabase
dashboard are not in the migrations; on production, compare
`select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and has_function_privilege('anon', oid, 'EXECUTE')`
with the list below after applying.

## Functions logged-out callers can still execute (44)

| Why | Functions |
| --- | --- |
| Public ordering, booking, tracking | `guest_lookup_table`, `guest_create_order`, `public_create_online_order`, `public_get_online_order`, `public_get_online_order_items`, `public_top_selling_items` |
| Driver link (rider token) | `driver_get_state`, `driver_ping_location`, `driver_update_assignment` |
| Customer-facing display (restaurant + pair code) | `cfd_get_session`, `cfd_heartbeat`, `get_cfd_promos`, `get_cfd_idle_settings` |
| Signup, ZATCA report verification, subdomains | `submit_tenant_application`, `get_zatca_certification_snapshot` (token), `resolve_subdomain` |
| App shell code that also runs while logged out (each checks `auth.uid()` itself or through `can_access_restaurant`) | `dashboard_sales_summary` ×2, `dashboard_expense_summary` ×2, `get_feature_flags_for_tenant`, `approve_journal_entry`, `reject_journal_entry`, `validate_active_impersonation`, `heartbeat_impersonation`, `touch_device_presence`, `append_failed_sync_attempt`, `get_primary_branch_id` |
| Used by RLS policies that apply to `anon`/`public` | `is_superadmin`, `has_role` ×2, `has_tenant_role`, `tenant_has_role`, `user_belongs_to_tenant`, `user_belongs_to_restaurant`, `get_user_tenant_id`, `can_access_restaurant`, `can_access_journal_branch`, `restaurant_exists`, `restaurant_has_public_storefront` |
| Called by `SECURITY INVOKER` trigger functions | `user_can_access_branch`, `user_pinned_branch_id`, `classify_dlq_error`, `is_partner_funding_account` |

Notes: `cfd_get_session` returns a till's live cart to anyone who knows the restaurant id and pair
code, so check that pair codes are long and random. `public_top_selling_items` returns any
restaurant's best sellers by id; this is low risk but could be limited to restaurants with a public
storefront.

## Logged-in users acting on other tenants' data

120 `SECURITY DEFINER` functions are executable by every logged-in user and contain no caller check,
neither direct (`auth.uid()`, JWT) nor through a helper that has one. 50 of them change data:

* **28 not called by the app as a user:** `authenticated` is revoked (`20261109111908`).
* **6 public by design and token-checked** (guest/online ordering, driver and display links, signup):
  unchanged.
* **16 called from logged-in pages:** now start with an access check
  (`20261109120650_add_tenant_checks_to_definer_writers.sql`). Two new helpers do the work:
  `assert_restaurant_access(restaurant)` and `assert_tenant_access(tenant)`. They raise `42501`
  unless the caller belongs to that restaurant's or tenant's organisation (or is a superadmin), and
  they allow calls with no user (service role, cron, other `SECURITY DEFINER` functions). The rest of
  each body is unchanged.

| Function | Checked against |
| --- | --- |
| `apply_fines_to_payroll`, `post_payroll_to_ledger` | the payroll record's restaurant |
| `deduct_advance_from_payroll` | the advance's restaurant and the payroll record's restaurant |
| `post_staff_advance_to_ledger` | the advance's restaurant |
| `delete_staff_advance_repayment` | the repayment's tenant |
| `post_day_end_adjustment_to_ledger` | the adjustment's tenant and restaurant |
| `post_night_summary_to_ledger` | the summary's restaurant |
| `post_overhead_payment_to_ledger` | the payment's restaurant |
| `post_weekly_cogs_to_ledger` | the stocktake's restaurant; `p_posted_by` must be the caller |
| `ensure_fixed_asset_accounts`, `ensure_project_accounts`, `increment_usage`, `provision_tenant_subdomain` | the tenant argument |
| `ensure_partner_funding_accounts` | the partner's tenant |
| `seed_sample_inventory_items` | the restaurant argument |
| `log_superadmin_event` | `_actor_id` must be the caller (it used to trust a caller-supplied id, so any user could log events as a real superadmin) |

Verified locally with a second tenant:
* Calls against another tenant's tenant id, restaurant id or day-end row return `42501`.
* Own-tenant calls succeed: the usage counter increments and a day-end adjustment posts Dr 1000 / Cr 6999.
* A missing row still gives the function's own "not found" error.
* Forging an audit event as the superadmin is refused, while the real superadmin can log one.
* The smoke test passes and a logged-in browser sweep shows no RPC errors.

### Read-only functions

69 unchecked `SECURITY DEFINER` functions only read data
(`20261109122216_add_tenant_checks_to_definer_readers.sql`):

* **13 called from logged-in pages** now check access. For example, `get_tenant_owner_emails` listed
  any tenant's owner email addresses, and `sales_price_variance`, `get_weekly_cogs_items`,
  `scan_sale_posting_vat_integrity`, `get_overdue_installments` and `compliance_branch_score`
  returned another restaurant's sales, costs and postings:

  | Function | Checked against |
  | --- | --- |
  | `check_quota`, `get_overdue_installments`, `get_tenant_owner_emails`, `scan_sale_posting_vat_integrity` | the tenant argument |
  | `compliance_branch_score`, `get_weekly_cogs_items`, `sales_price_variance` | the restaurant argument |
  | `classify_unposted_expense` | the expense's restaurant |
  | `compliance_repeat_info` | the violation's restaurant |
  | `get_branch_menu_prices` | the branch's restaurant |
  | `get_employee_fine_capacity` | the staff member's restaurant |
  | `preview_payroll_deduction_allocation` | the payroll record's restaurant |
  | `resolve_branch_account` | the parent account's tenant |

* **32 not called by any page as a user** lose `authenticated`. These are helpers used inside other
  definer functions, cron jobs, and server functions that use the service-role key. They include
  `verify_terminal_key` and `verify_cron_token`, which let any logged-in user test guessed secrets,
  plus `get_staff_monthly_wage` and `get_deduction_settings`.
* **14 RLS policy helpers stay** (`is_superadmin`, `has_role`, `user_belongs_to_tenant`, …): policies
  need them. They take a user id and answer yes or no about that user's membership. That is a small
  information leak, but removing it would break the policies.
* **10 public, token-checked functions stay**: ordering, the driver and display links, ZATCA
  verification and subdomains.

Verified locally with a second tenant: every checked reader returns `42501` for the other tenant
and answers normally for the caller's own tenant. The revoked readers return `42501` for logged-in
users. The smoke test passes, and a logged-in browser sweep shows no RPC errors.

### Found along the way

* **Day-end needed an account new tenants lack.** Day-end adjustments post to 6999 "Cash Over/Short",
  which was only backfilled once (`20260506231755`). Tenants created later could not post day-end
  adjustments. `20261109121304_seed_cash_over_short_for_new_tenants.sql` adds 6999 to the per-tenant
  seeding and backfills it. No other account code was seeded this way.
* **Compliance score page errored for restaurants without compliance settings (fixed).**
  `compliance_branch_score` fell back to `row(25,25,25,25)`, which has no field names, so it failed
  with `42703 record "w" has no field "wc"`. It now selects the default weights into named fields.
* **`delete_staff_advance_repayment` deletes too much (not changed).** Its ledger delete ends in
  `AND (id = v_rep.ledger_transaction_id OR v_rep.ledger_transaction_id IS NULL OR true)`. The `OR true`
  makes the id filter a no-op, so deleting one repayment also deletes every other ledger row for the same
  advance with the same date and amount. The likely fix is to drop `OR true`. That changes what gets
  deleted from the ledger, so confirm with whoever owns staff advances first.

## Rule for new functions

New functions in `public` are executable by `authenticated` and `service_role` only. If a function
must work for logged-out visitors (public ordering, links with tokens), grant it explicitly in the
same migration and validate its token or input inside:

```sql
GRANT EXECUTE ON FUNCTION public.my_public_fn(uuid) TO anon;
```

`SECURITY DEFINER` functions must check the caller (`auth.uid()` plus tenant or restaurant access)
before touching tenant data, because they bypass RLS.
