---
name: ZATCA Credit Notes & Schema Validation
description: Credit note (CreditNoteTypeCode 381) pipeline reusing device chain, plus pre-flight UBL schema validation
type: feature
---
**Credit Notes:** `zatca_credit_notes` table tracks refund documents linked to original sales. Edge function `zatca-issue-credit-note` builds CreditNote UBL (with `cac:BillingReference` to original UUID), validates schema, advances same device chain (next ICV/PIH), invokes `zatca-sign-invoice`, then submits to Fatoora `/invoices/reporting/single` (or simulates). Reason codes: RETURN_OF_GOODS, CORRECTION_OF_AMOUNTS, CHANGE_OF_BUYER, CANCELLATION, OTHER. UI: `CreditNoteDialog` triggered from `ZatcaClearanceStatus` row "Credit" button (only shown for CLEARED/REPORTED/CLEARED_SIM sales). List view: `ZatcaCreditNotes` panel in Settings.

**Schema validation:** `validateUblXml` in `src/lib/zatca/ubl.ts` (and inlined in edge functions) checks required elements (cbc:ID, UUID, IssueDate, AccountingSupplierParty, LegalMonetaryTotal, TaxTotal), VAT number format (15 digits), VAT category code (S/Z/E/O), ICV/PIH refs, and BillingReference for credit notes. `zatca-sign-invoice` runs validation pre-flight; on failure, sale gets `SCHEMA_INVALID` status and `zatca_schema_errors` jsonb populated - never round-trips to Fatoora.

**Status enum (sales_transactions.zatca_clearance_status):** PENDING, CLEARED, REPORTED, CLEARED_SIM, REJECTED, SCHEMA_INVALID, NOT_APPLICABLE.
