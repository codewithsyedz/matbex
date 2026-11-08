# Balady / Municipality Compliance & Fines Module

A branch-scoped compliance system covering municipality inspections, internal SOP violations, corrective actions, photo evidence, daily checklists, and a compliance dashboard — kept strictly separate from payroll deductions.

## Core principle: three separate concepts

```text
A. Municipality fine   -> company liability -> Accounting (expense / AP)
B. Internal SOP breach -> HR record         -> Corrective action workflow
C. Payroll deduction   -> only via the existing Employee Fines module, manual + approved
```
A never auto-converts into C. Linking a compliance violation to a payroll deduction is an explicit manual action that hands off to the existing fine approval flow.

## What gets built

### 1. Configuration
- Violation categories (Cleanliness & Hygiene, Food Safety, Employee Compliance, Restaurant SOP) — editable per restaurant, optionally per branch.
- Violation types under each category, seeded with the full list from the request, each with severity, default corrective-action window, and whether evidence is required.
- Escalation rules table: occurrence count -> action label (Warning / Supervisor Review / Management Review / Corrective Action Plan). Fully configurable, no hard-coded discipline.
- Checklist templates (Opening / During-shift / Closing) with editable items per branch.

### 2. Violation record
Form with: branch, date, time, shift, category, type, source (Balady inspection, internal inspection, supervisor, customer complaint, food-safety inspection, management audit, other), description, responsible employee, supervisor, fine amount, municipality reference, inspector name, inspection date, corrective action required + due date, status, created/approved by.
A record is flagged `is_municipality_fine` only when the source is an official inspection and a reference number exists.

### 3. Evidence
Private storage bucket `compliance-evidence`, branch/restaurant-scoped RLS. Before and after photos, each row storing uploader and timestamp.

### 4. Corrective action workflow
`identified -> assigned -> action_required -> completed -> verified -> closed`, with an `overdue` flag applied by a scheduled job when the due date passes, plus a notification to the branch manager.

### 5. Repeat detection
A view/function counting occurrences of the same violation type at the same branch inside a configurable lookback window; the violation screen surfaces a repeat banner with previous occurrence count, last occurrence, and the configured recommended action.

### 6. Daily checklists
Per-branch, per-day, per-shift checklist runs with item-level completion (employee), then supervisor review and manager approval capturing name, timestamp, typed confirmation signature, and comments.

### 7. Municipality fines register
Dedicated tab tracking reference, branch, inspection date, violation, amount, status (received / under review / appeal submitted / confirmed / paid / closed), payment date and reference, supporting document, appeal status and reference, notes.
"Post to expenses" action creates an expense in the existing expense flow under a Government/Regulatory Fines category, branch-scoped, so it follows the existing AP/ledger path. No auto-posting without user action.

### 8. Dashboard and reports
- Compliance dashboard: per-branch score (weighted cleanliness / food safety / employee SOP / checklist completion), open violations, overdue actions, municipality fines total, repeats.
- Branch compliance report, employee SOP report, financial fines report — each with CSV export and branch + period filters.

### 9. Notifications
Reuses the existing in-app notification and preference tables: new municipality violation, new SOP violation, corrective action assigned, overdue, repeated violation, fine received, payment due, checklist incomplete, approval pending — toggleable per branch and role.

## Technical details

New tables (all `restaurant_id` + `branch_id` scoped, RLS via `can_access_restaurant` / `can_access_branch`, GRANTs to `authenticated` + `service_role`, soft delete via `deleted_at`):
`compliance_violation_categories`, `compliance_violation_types`, `compliance_violations`, `compliance_violation_evidence`, `compliance_corrective_actions`, `compliance_escalation_rules`, `municipality_fines`, `compliance_checklist_templates`, `compliance_checklist_items`, `compliance_checklist_runs`, `compliance_checklist_run_items`, `compliance_settings`.

Database functions: `compliance_repeat_count()`, `compliance_branch_score()`, `mark_overdue_corrective_actions()` (pg_cron daily), `post_municipality_fine_to_expense()` (explicit call only).

Frontend: routes under `/compliance` — Dashboard, Violations, Municipality Fines, Checklists, Configuration, Reports. Hooks `useCompliance*`, components under `src/components/compliance/`. Sidebar group "Compliance" gated by a `compliance` feature key. Branch filtering follows `activeBranchId`, dates via `getRestaurantDayBoundsUTC`.

Audit: every status change writes to `audit_logs`; posted municipality fines and verified checklists become immutable via triggers.

## Delivery order
1. Migration: tables, RLS, GRANTs, seed categories/types, functions.
2. Storage bucket + policies.
3. Hooks and violation/corrective-action UI with evidence.
4. Municipality fines register + expense posting handoff.
5. Checklists + verification chain.
6. Dashboard, reports, notifications, cron.

## Notes on regulation
Fine amounts, escalation steps, and corrective windows are configuration, not code. The UI will not assert that any deduction is legally permissible; payroll impact only ever happens through the existing approval workflow.
