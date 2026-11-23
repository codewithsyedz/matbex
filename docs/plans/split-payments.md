# Split payments — plan

Status: phase 1 built on custom-backend (2026-11-23): sale_payments + 'split', payments[] on
POST /api/v1/pos/sales, per-tender cash events and void refunds, Split on the quick-sale POS dialog
(SalesRecorder), offline replay, receipt PDFs, UBL PaymentMeans per tender, report functions.
Since then: Split on /record-sale (RecordSale.tsx, RecordSaleMobile) with one ZATCA PaymentMeans
per tender and printed tenders; cash/card readers (day-end, dashboard, analytics, reports, card
sales by branch, daily profit email) read tenders. Display-only screens show "split".

Phase 2a (split bill at checkout) built on custom-backend (2026-11-23, not yet on staging):
`sales_transactions.bill_group_id`; POST /api/v1/pos/sales/bill-split (+ /quote) records one sale
per guest in one transaction, parts must equal the cart, discount/surcharge spread by lines total
(last part takes the rounding); offline split bills replay as one request keeping each part's
receipt number; "Split bill" sheet (by item / evenly / by amount) on SalesRecorder, /record-sale
and RecordSaleMobile; "1 of N" badge on the Sales list. As built: by item, each guest pays with
one method (cash, card or other; split tender per guest is supported by the API, not the sheet),
and receipts print in guest order once the last guest has paid (all parts are saved together).
Each part gets its own kitchen ticket. Still to do: staging click-through as the QA cashier.

## Problem

A POS sale holds exactly one payment method (`sales_transactions.payment_method`:
`cash | card | other`). A guest paying 60 SAR cash + 40 SAR card, or two friends
each paying their half by card, cannot be recorded truthfully. Cashiers today
either ring it all as one method (cash/card totals and the drawer count are then
wrong) or split it into two sales (two ZATCA invoices for one meal).

Saudi competitors (Foodics, Marn) all support both:

1. **Split tender**: one sale (one receipt, one ZATCA invoice) paid by several
   methods.
2. **Split bill**: one table's order divided between guests (by item, by seat,
   or evenly), each part its own receipt and invoice.

Build split tender first (phase 1); split bill (phase 2) builds on it.

## What reads the payment method today (must stay correct)

Staging copy of production: 49,822 sales (33,604 cash, 16,200 card, 18 other).

- **Cash drawer / shift close**: `CloseShiftModal` totals `cash_events` by
  `payment_method`. One cash event is written per sale → write one per tender and
  shift close keeps working unchanged.
- **Ledger**: `post_daily_sales_to_ledger` posts from `daily_sales_summary`
  cash/card totals (cash → 1000, card → card clearing 1015). Those totals must be
  built from tenders.
- **Reports and screens reading `payment_method` on sales** (~25 client files):
  Sales, SalesAnalytics, Reports, SalesJournal (`get_sales_journal`),
  CashCardAnalysis (`get_cash_card_analysis_section`), CardSalesByBranch,
  DailySalesCard, daily closing report export, P&L hook, POS details dialog,
  receipt PDF, `posPaymentMapping`, `reconciledSales`, PosBackfill.
- **Server**: `POST /api/v1/pos/sales` (sales.service), sales-admin (void, edit),
  zatca.service and `generate-zatca-receipt` (payment means in the XML),
  `payments-refund` (Moyasar refunds), send-scheduled-reports,
  send-daily-profit-summary, auto-shift-manager, MCP server.
- **Card terminals**: one Hala/Moyasar approval per sale (`hala_*` columns,
  `cardTerminal` in the sale request).

## Phase 1 — split tender

### Database (one migration)

- New table `sale_payments`: `id, sale_id → sales_transactions, restaurant_id,
  branch_id, method payment_method, amount > 0, tendered (cash only),
  change_given (cash only), card_provider, card_status, card_reference,
  card_response, created_at`.
  RLS: read like `sales_transactions`; no browser insert/update/delete (written
  only by the API, like sales).
- Add `'split'` to the `payment_method` enum; a sale with more than one tender
  stores `payment_method = 'split'`. Readers not yet moved to tenders then show
  "split" rather than silently counting the whole sale as cash or card.
- Backfill one `sale_payments` row per existing sale (amount = total, card fields
  from `hala_*`), so every reader can switch to tenders with no special case for
  old sales.
- `daily_sales_summary` cash/card totals and `get_cash_card_analysis_section`,
  `get_sales_journal`, `branch_performance_summary`, `dashboard_sales_summary`
  read `sale_payments`.

### API (`POST /api/v1/pos/sales`)

- Accept `payments: [{ method, amount, tendered?, cardTerminal? }]`. Keep
  `paymentMethod` + `cardTerminal` working (old builds and the offline replay
  queue): the server turns them into one payment.
- Server rules: amounts sum to the server-priced total; only cash may be
  over-tendered (change = tendered − amount); every card tender needs its own
  approved terminal charge for exactly its amount (Moyasar intents checked
  server-side, as today); at most one `other`.
- Write one `cash_events` row per tender.
- Void (`/:id/void`) mirrors every tender as negative; `payments-refund` refunds
  only the card tender(s) through Moyasar.

### POS screen

- Payment step gets "Split": add tenders until the remaining balance is 0;
  quick buttons "rest in cash" / "rest by card"; cash change shown per cash tender.
- Each card tender starts the terminal (Hala or Moyasar) for that amount; a
  declined card leaves the sale open with the remaining balance.
- Offline: cash and terminal-approved card tenders queue like today's sales.

### Receipts and ZATCA

- Receipt and receipt PDF list each tender (and change).
- ZATCA XML: one `cac:PaymentMeans` per tender (10 cash, 48 card).

### Tests

- Server: sum mismatch refused; card tender without approval refused; cash
  change; legacy single-method request still works; void mirrors tenders.
- Staging (rolled back): cash + card sale → two cash events, shift close
  expected cash/card correct, day-end summary and ledger posting split 1000/1015.
- Click-through on staging POS as the QA cashier.

## Phase 2 — split bill between guests

### What exists today (checked 2026-11-23)

Matbex has **no open table orders**. Every sale is rung up and paid in one go:

- `PosTables` / `Waiter` manage tables, QR codes and *guest QR orders*
  (`pos_table_orders`, items as JSON). Marking one "paid" only sets its status;
  it records no sale. The Waiter page's comment about cart and send-to-kitchen
  is wrong: PosTables has neither.
- `/record-sale` can be opened with a table id (`tableId` on the sale), and has an
  order-type picker (dine-in, takeaway, delivery, **held**). The picker is
  cosmetic: "held" doesn't hold anything.
- Staging copy of production: 0 sales with a table, 1 table, 0 guest QR orders.

So "split the bill" can only happen at checkout, on the cart the cashier has in
front of them. Running tabs (order now, send rounds to the kitchen, pay later)
are a separate, larger feature; see below.

### 2a — split at checkout (build this)

In the payment step, next to "Split" (several payment methods), add
**"Split bill"** with three ways to split:

1. **By item:** the cashier assigns cart lines (or units of a line) to guests
   1..N. Each guest's part becomes **its own sale**: its own receipt number,
   receipt and ZATCA simplified invoice, priced and VAT-split on the server like
   any sale. Each part can be paid by any method, including split tender.
2. **Evenly into N:** one sale, one invoice, paid by N equal payments (phase 1
   split tender, amounts rounded so they add up to the total, the last one taking
   the remainder). Each guest gets a payment slip showing their share. Splitting
   item lines into fractions would make invoice lines meaningless, so evenly
   never creates separate invoices.
3. **By amount:** the same as evenly, with amounts typed in, for when guests pay
   unequal shares.

Server (by item):

- `POST /api/v1/pos/sales/bill-split`: the cart plus `parts: [{ lines,
  payments }]`. It prices everything, checks that the parts together are exactly
  the cart (same items, same quantities), then records every part in **one
  transaction** with one idempotency key. Either all parts are saved or none.
  It reuses `createSale` internals; it doesn't call the endpoint N times from
  the browser.
- New column `sales_transactions.bill_group_id` (uuid, nullable) shared by the
  parts, so reports, receipts ("1 of 3") and voids can find the siblings.
- Document discount or surcharge: spread over the parts in proportion to their
  subtotal, rounding on the last part.
- Card parts: each needs its own approved terminal or Moyasar charge (as in
  phase 1). If a card is declined part-way, nothing is recorded yet; the parts
  already paid by card keep their approval, and the cashier retries or changes
  the declined part. This is the same rule as phase 1's split tender.
- Void: voiding one part voids only that part (it's its own sale); the Sales page
  shows its siblings.
- Offline: an offline by-item split queues as one bill-split request and replays
  through the same endpoint (keeps the printed receipt numbers).

POS screen: a "Split bill" sheet with guest columns. The cashier taps a line to
move it to a guest; "Split evenly" and "By amount" are tabs. Each guest pays in
turn, and their receipt prints as they pay.

Reports: no change for by-item parts (they're ordinary sales). The sales list
gets a small "1 of 3" badge from `bill_group_id`.

Tests: the parts must add up to the cart (missing, extra or changed lines are
refused); all parts are saved or none (a failure on part 3 saves nothing);
discount spreading; evenly-split rounding; offline replay; one void doesn't
touch the siblings. Then a staging click-through as the QA cashier.

### 2b — open checks / running tabs (separate feature, plan later)

Order now, send rounds to the kitchen, add items, move or merge tables, pay at the
end (then split with 2a). This needs a new "open check" record (draft lines held
on the server, kitchen tickets per round, table status), and it changes the
waiter and kitchen flow. It's the bigger dine-in gap and deserves its own plan.
2a doesn't depend on it, and works on an open check later without changes.

## Out of scope for phase 1

On-account (customer credit) as one of the tenders, tips per tender, gift cards
as a tender (gift cards don't exist yet).
