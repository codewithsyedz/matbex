-- Sales are created, voided and corrected only through the API now:
--   POST /api/v1/pos/sales                      POS sales (every screen, offline replay)
--   POST /api/v1/pos/sales/summary              manual, end-of-day and backfill amounts
--   POST /api/v1/pos/sales/:id/void             voids (sales are never deleted)
--   PATCH/DELETE /api/v1/pos/sales/:id/lines/*  line corrections
-- Those run as the table owner. Browsers keep SELECT and, for now, UPDATE on
-- sales_transactions (customer settlements, ZATCA status, VAT corrections move next).
-- Server functions that use the service key (terminal-api, auto-shift-manager, pos-sync
-- refunds) are unaffected.
REVOKE INSERT, DELETE, TRUNCATE ON public.sales_transactions FROM anon, authenticated;
-- Line inserts were revoked in 20261110093956. A direct line update changed quantity or
-- price without moving stock, food cost or the sale's totals; a direct delete left the sale
-- total and the drawer unchanged.
REVOKE UPDATE, DELETE ON public.sales_items FROM anon, authenticated;
