# Accounting data dictionary

## AI-assisted income journals

### `daily_sales_summary.ai_revenue_account_id`

The active, tenant-owned, branch-visible revenue account selected by AI for the standard non-delivery portion of a closed sales day. Amounts, payment debits, VAT, delivery receivables, branch routing, balancing, locking, and posting remain deterministic.

### `ai_income_journal_audit`

Immutable operational evidence for AI-assisted income classification and deterministic customer-receipt posting.

| Column | Meaning |
| --- | --- |
| `source_type` | `daily_sales` for AI revenue classification or `customer_receipt` for deterministic A/R clearance. |
| `source_id` | The source sales-day or settlement-payment UUID. |
| `selected_account_id` | Revenue account selected for sales, or A/R account used for receipt clearance. |
| `confidence` | AI confidence from 0 to 1; omitted for deterministic receipts. |
| `classification` | Short classification label. |
| `rationale` | Human-readable explanation of the accounting decision. |
| `model` / `prompt_version` | Reproducibility metadata. |
| `outcome` | `posted`, `blocked`, or `failed`. |
| `ledger_batch_id` | Balanced journal batch created by deterministic database code. |

Customer receipts never recognize revenue again. They post debit Cash/Bank and credit Accounts Receivable.