---
name: Installment VAT mismatch alerts
description: DB watcher raises alerts + in-app notifications when a BNPL plan's recoverable VAT stops matching input VAT posted to its ledger batch
type: feature
---
- Table `installment_vat_mismatch_alerts` (open/resolved, per plan, unique open alert per plan).
- `detect_installment_vat_mismatch(plan_id)` compares plan `vat_amount + finance_vat_amount` against non-voided debits on input VAT accounts (1180-1182 / "input vat" / "vat recoverable") in the plan's batch. Tolerance 0.02.
- Triggers: installment_plans insert/update (vat, batch, status, branch) and account_transactions insert/update (debit, credit, is_voided, account_id, batch_id).
- Matched or cancelled plans auto-resolve the alert; new mismatches notify all owners/managers/accountants via `in_app_notifications` (action_type `vat_mismatch`).
- UI: `InstallmentVatAlertsPanel` on /reports/vat-audit, branch-scoped, owners/accountants can dismiss.
