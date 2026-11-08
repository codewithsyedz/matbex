---
name: ZATCA Phase 2 Advanced
description: Standard B2B invoice routing, VAT category matrix, compliance dashboard, tamper-evident audit trail
type: feature
---
- `sales_transactions.zatca_invoice_subtype` = 'SIMPLIFIED' (B2C, code 0200000) or 'STANDARD' (B2B, code 0100000). Trigger validates buyer name + 15-digit VAT for STANDARD.
- `zatca-submit-clearance` auto-routes by subtype: STANDARD → `/invoices/clearance/single`, SIMPLIFIED → `/invoices/reporting/single`.
- `menu_items.vat_category` ∈ {S,Z,E,O}. UBL emits per-line `cac:ClassifiedTaxCategory` and aggregates `cac:TaxSubtotal` per bucket.
- Exemption: `vat_exemption_reason_code` (e.g. VATEX-SA-29) required for E/O.
- `zatca_audit_trail`: append-only, no UPDATE/DELETE policies. Trigger `trg_audit_sales_clearance` writes a SHA-256 hash-chained row on every clearance status change.
- Compliance dashboard: `/zatca-compliance` (page `src/pages/ZatcaCompliance.tsx`) shows success rate, latency, pending/failed counts, device CSID expiry, and audit chain viewer.
