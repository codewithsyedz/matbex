# Split payments — plan

Status: phase 1 built on custom-backend (2026-11-23): sale_payments + 'split', payments[] on
POST /api/v1/pos/sales, per-tender cash events and void refunds, Split on the quick-sale POS dialog
(SalesRecorder), offline replay, receipt PDFs, UBL PaymentMeans per tender, report functions.
Not yet: Split on the full /record-sale page (RecordSale.tsx / RecordSaleMobile), and the other
client screens that still read sales_transactions.payment_method (they show "split").

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

For table orders (PosTables / Waiter): split by item, by seat, or evenly into N
parts. Each part becomes its own sale with its own receipt and ZATCA invoice, and
each can use split tender. Needs a look at how open table orders are held before
sales are written; plan separately once phase 1 is live.

## Out of scope for phase 1

On-account (customer credit) as one of the tenders, tips per tender, gift cards
as a tender (gift cards don't exist yet).
