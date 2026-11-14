-- Read-only checks to run on a COPY of production (or read-only against Supabase) before
-- cutover. Each answers a "check production" question from the defects found during the
-- migration (docs/self-hosting/ARCHITECTURE.md). Nothing here writes.
--
--   psql "$SOURCE_DATABASE_URL" -f docs/self-hosting/production-checks.sql
--
-- Customer balances that will change at cutover: docs/self-hosting/customer-balance-review.sql

\echo '1. Branches that price WITHOUT VAT. Their sales were stored at the pre-VAT amount by the'
\echo '   normalize_vat_inclusive_sale_from_items trigger (sales and output VAT understated).'
SELECT r.name AS restaurant, b.name AS branch, b.vat_rate,
       (SELECT count(*) FROM public.sales_transactions st WHERE st.branch_id = b.id) AS sales,
       (SELECT count(*) FROM public.sales_transactions st
         WHERE st.branch_id = b.id
           AND st.total = (SELECT round(sum(si.total_price), 2) FROM public.sales_items si WHERE si.transaction_id = st.id)
       ) AS sales_stored_without_vat_on_top
  FROM public.branches b JOIN public.restaurants r ON r.id = b.restaurant_id
 WHERE b.prices_vat_inclusive = false;

\echo '2. Shifts: closing failed for everyone since 20260423 (lock_shift_inventory_on_close).'
SELECT status::text, count(*), max(closed_at) AS last_closed, max(opened_at) AS last_opened
  FROM public.shifts GROUP BY 1 ORDER BY 1;

\echo '3. ZATCA status of sales (status updates failed: pgcrypto not on the search_path).'
SELECT coalesce(zatca_clearance_status, '(none)') AS status, count(*),
       count(*) FILTER (WHERE zatca_uuid IS NOT NULL) AS with_uuid,
       max(created_at) AS latest
  FROM public.sales_transactions GROUP BY 1 ORDER BY 2 DESC;

\echo '4. ZATCA QR VAT: sales whose frozen QR says 0 VAT although the sale has VAT.'
SELECT count(*) AS qr_with_zero_vat
  FROM public.sales_transactions
 WHERE zatca_generated_at IS NOT NULL AND coalesce(zatca_vat_total, 0) = 0 AND tax > 0;

\echo '5. ZATCA device chain gaps: ICV allocated on the device but carried by no sale/credit note.'
SELECT d.name, d.icv_counter,
       (SELECT count(*) FROM public.sales_transactions st WHERE st.zatca_device_id = d.id AND st.zatca_icv IS NOT NULL)
     + (SELECT count(*) FROM public.zatca_credit_notes cn WHERE cn.device_id = d.id AND cn.icv IS NOT NULL) AS stamped,
       d.icv_counter
     - (SELECT count(*) FROM public.sales_transactions st WHERE st.zatca_device_id = d.id AND st.zatca_icv IS NOT NULL)
     - (SELECT count(*) FROM public.zatca_credit_notes cn WHERE cn.device_id = d.id AND cn.icv IS NOT NULL) AS gaps
  FROM public.zatca_devices d ORDER BY gaps DESC;

\echo '6. ZATCA credit notes (none could be issued before the fix).'
SELECT document_type, clearance_status, count(*) FROM public.zatca_credit_notes GROUP BY 1, 2;

\echo '7. Devices whose private key / CSID secrets were readable by every tenant user.'
SELECT count(*) FILTER (WHERE private_key_pem IS NOT NULL) AS with_private_key,
       count(*) FILTER (WHERE production_csid_secret IS NOT NULL) AS with_production_secret
  FROM public.zatca_devices;
\echo '   If any: treat those keys/secrets as exposed; re-onboard the devices after cutover.'

\echo '8. Sales whose lines were deleted while the sale stayed (Sales page "delete" bug):'
\echo '   no lines left, but the kitchen ticket shows the sale had items.'
SELECT count(*) AS sales_that_lost_their_lines
  FROM public.sales_transactions st
 WHERE NOT EXISTS (SELECT 1 FROM public.sales_items si WHERE si.transaction_id = st.id)
   AND EXISTS (SELECT 1 FROM public.pos_kds_tickets k JOIN public.pos_kds_ticket_items ki ON ki.ticket_id = k.id
                WHERE k.source_order_id = st.id);

\echo '9. Cash drawer: sale cash events recorded at the pre-VAT amount (desktop POS bug).'
SELECT count(*) AS cash_events_below_sale_total
  FROM public.cash_events ce JOIN public.sales_transactions st ON st.id = ce.reference_id
 WHERE ce.event_type = 'sale' AND ce.reference_type = 'sales_transaction' AND ce.amount < st.total - 0.01;

\echo '10. Combo packages on sale (they could never be recorded: foreign key to menu_items).'
SELECT count(*) AS active_combos FROM public.combo_packages WHERE is_active;
