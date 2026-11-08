---
name: Receipt Templates (CRUD)
description: Per-tenant receipt template CRUD with 5 presets + auto-pick by ZATCA subtype, bilingual EN/AR rendered by print-agent
type: feature
---
- Table: `public.receipt_templates` (tenant_id scoped RLS; only owner/manager/superadmin can mutate).
- Presets: `simple`, `tax_invoice`, `detailed`, `saudi_bilingual` (bilingual EN/AR like Jamaan Al-Dosari reference receipt), `zatca_standard` (B2B with buyer block).
- Each template carries `language` (en/ar/bilingual), `paper_width` (58/80), `options` jsonb toggles (showLogo, showCashier, showCustomer, showOrderType, showItemNotes, showQR, showVat, showBranchName, showBuyerBlock), and EN/AR header+footer notes.
- Defaults: `is_default_simplified` / `is_default_standard`. `pickTemplateForInvoice(templates, subtype)` is the canonical lookup, used in `RecordSale.tsx`.
- UI: `src/components/settings/ReceiptTemplatesManager.tsx` (CRUD + live preview), mounted inside `POSHardwareSettings.tsx` replacing the old inline 3-preset card.
- Hook: `src/hooks/useReceiptTemplates.ts` (CRUD + setDefault; soft-deletes via `deleted_at`).
- Print agent: `print-agent/src/render.js` honors `templateConfig` (language, paperWidth, options, notes, buyer); `renderBilingualReceipt()` handles `saudi_bilingual` and `zatca_standard`.
- Auto-pick: `RecordSale.tsx` passes `template` + `templateConfig` to `handlePOSPrint` using `pickTemplateForInvoice(receiptTemplates, invoiceSubtype)`. When no custom templates exist, falls back to legacy `pos_hardware_settings.receipt_template`.