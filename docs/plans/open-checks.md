# Open checks (running tabs) — plan

Status: proposed (2026-11-24). Nothing built. Phase 2b of docs/plans/split-payments.md.

## Problem

Every Matbex sale is rung up and paid in one step. A dine-in table can't order now,
send rounds to the kitchen, add dessert later and pay at the end. Foodics and Marn
both do this ("open orders" / "tables"), and it's the biggest dine-in gap left.

Today a waiter can only:

- ring up a sale and take payment straight away (each round is its own sale,
  receipt and ZATCA invoice); or
- use the floor plan's "Start order" / "Add to order", which opens /record-sale
  for that table, and so also creates and pays a new sale each time.

## What exists today (checked 2026-11-24)

| Piece | Where | State |
|---|---|---|
| Tables with a layout | `pos_tables` (+ `pos_floor_plans`), FloorPlan, PosTables | Status `free / seated / ordered / billing / dirty`, `server_id`, `guest_count`, `seated_at`; every change logged in `pos_table_status_events`. Status is set by hand from the floor plan. |
| Kitchen tickets | `pos_kds_tickets`, `pos_kds_ticket_items`, `pos_kds_stations`, KitchenDisplay | One ticket per sale, made by a deferred trigger on `sales_transactions` (`fn_kds_create_ticket_from_pos_sale`); marked served when the sale is paid. 44,367 POS tickets in production. |
| Guest QR orders | `pos_table_orders` (items as JSON), GuestOrder, PosTables | A guest orders from the table QR; a trigger makes a kitchen ticket. "Paid" only sets a status; no sale is recorded. |
| Split at checkout | POST /api/v1/pos/sales, /sales/bill-split | Built (phase 1, 2a). |
| Reservations | `table_reservations`, Reservations | Not linked to tables. |

Production copy (staging): 1 table, 0 floor plans, 0 guest QR orders, 0 reservations,
0 kitchen stations. **No customer runs table service in Matbex yet**, so this is a bet
on winning dine-in restaurants, not a fix for current users. Nothing has to be migrated.

## Goals

1. A waiter or cashier opens a **check** on a table (or with no table: bar tab,
   named takeaway), adds items, and **sends** them to the kitchen in rounds.
2. Anyone with access sees the open checks of the branch, live, on the floor plan
   and on the POS, and can add to them.
3. Paying closes the check through the existing sale endpoints: one sale, split
   payment (phase 1) or split bill (phase 2a). ZATCA, stock, cash events and
   reports stay exactly as today, because the result is ordinary sales.
4. Table status follows the check (seated → ordered → billing → dirty)
   instead of being set by hand.

Not goals for the first version: course firing (hold/fire), seat-level ordering,
modifiers beyond a free-text note, tips, offline open checks, reservations ↔ tables.

## Design

### Data (one migration, RLS on every table)

- `pos_checks`: `id, restaurant_id, branch_id, table_id (nullable), check_number`
  (per branch per day, like receipts: `CHK-YYYYMMDD-NNN`), `name` (optional, for bar
  tabs), `status open | paid | void | merged`, `guest_count, server_id, customer_id,
  document_discount, document_surcharge, opened_by, opened_at, closed_at, closed_by,
  merged_into (uuid), version (int, optimistic lock), notes`.
  At most one open check per table (partial unique index on `table_id where status = 'open'`).
- `pos_check_lines`: `id, check_id, restaurant_id, menu_item_id | combo_id, size,
  quantity, unit_price` (the price when added, see "Prices"), `note, round_id
  (null = not sent yet), status active | voided, void_reason, voided_by, added_by,
  created_at`.
- `pos_check_rounds`: `id, check_id, restaurant_id, number, sent_by, sent_at,
  kds_ticket_id`.
- `sales_transactions.check_id` (uuid, nullable, indexed): the sale(s) that paid
  the check.

RLS: staff of the restaurant read; **no browser writes**. Everything goes through
the API (as POS sales do), so the rules below hold no matter which screen calls.

### API: `server/src/modules/pos/checks.*` (schema → routes → service → repository)

All behind `requireRestaurantRole(owner, manager, cashier, waiter)`, scoped by
`restaurant_id`, each write in one transaction with `platform.emit_event('pos', 'pos.check.*')`.

| Route | Does |
|---|---|
| `POST /pos/checks` | Open a check (table optional). Refused if the table already has one. Table → `seated`. |
| `GET /pos/checks?branchId&status=open` | Open checks with totals, table, server, age. |
| `GET /pos/checks/:id` | Check, lines, rounds, live totals (server-priced, same VAT code as sales). |
| `POST /pos/checks/:id/lines` | Add lines (priced on the server now; `unitPrice` from the terminal checked like a sale: 409 `price_changed`). |
| `PATCH /pos/checks/:id/lines/:lineId` | Change quantity / note of a line **not yet sent**. |
| `POST /pos/checks/:id/lines/:lineId/void` | Remove a line. Not sent: anyone. Sent: manager/owner, with a reason; its kitchen item is cancelled. |
| `POST /pos/checks/:id/send` | Send every unsent line as a new round: one kitchen ticket (`source = 'check'`). Table → `ordered`. |
| `POST /pos/checks/:id/prebill` | Returns the guest bill to print ("not a tax invoice"); table → `billing`. Optional discount/surcharge set here. |
| `POST /pos/checks/:id/move` | Move to another free table (both tables' status follow). |
| `POST /pos/checks/:id/merge` | Merge another open check into this one (its lines move; it becomes `merged`). |
| `POST /pos/checks/:id/pay` | Pay: `payments` (one sale, any number of tenders) **or** `parts` (split bill). Calls `recordSale` / `recordBillSplit` in the same transaction, sets `check_id` on the sale(s), closes the check, table → `dirty`. Idempotency key like sales. Unsent lines are sent first (so the kitchen never misses an item). |
| `POST /pos/checks/:id/void` | Void a check with nothing sent (anyone) or with sent rounds (manager/owner, reason; kitchen tickets cancelled). |

Every write takes `version` and fails with 409 `check_changed` when another
terminal changed the check in between, so two waiters can't send the same lines
or pay twice.

### Prices

A line is priced when it's added and keeps that price: the guest ordered at it.
Paying charges the check's line prices, not the price list at payment time (the
same rule as offline replays, which charge what the terminal showed). `recordSale`
gets a `priceLocked` context flag for this instead of `offline`.

### Kitchen

- Sending a round makes one ticket per round (`source = 'check'`, `source_order_id`
  = round id, `table_label` = table + check number), items from the round's lines.
- `fn_kds_create_ticket_from_pos_sale` skips sales with `check_id`: the check's
  rounds already went to the kitchen.
- A voided sent line cancels its ticket item (KDS shows it struck through).
- `fn_kds_mark_served_on_payment` also marks the check's round tickets served.

### Stock, COGS, ledger, ZATCA

Unchanged: they happen when the check is paid, through the sale (sales_items
trigger, cash events, receipt, ZATCA invoice). An open check is not a sale and not
an invoice. Items voided after being sent don't deduct stock. Recording them as
waste is a later option, with a reason report for now.

### Screens

- **POS (/record-sale, RecordSaleMobile):** an "Open checks" panel (list +
  search by table / name / number). The cart can be "Send to kitchen" (open a check
  or add to the selected one) or "Pay" (today's flow). Opening a check loads its
  lines: sent lines are locked (void only), new lines can be edited until sent.
  "Pay" on a check uses the existing payment step, including Split and Split bill.
- **Floor plan:** table colour from its check (seated / ordered with age /
  billing); tapping a table opens its check; move and merge from the table sheet.
  Manual status buttons stay for `dirty → free` only.
- **Waiter page:** the floor plan plus the open check, built for phones.
- **Kitchen display:** no change beyond the struck-through voided items and the
  check number in the label.
- **Live updates:** `subscribeEvents()` on `pos.check.*`, so every terminal sees
  new checks, rounds and payments.

### Offline

Open checks live on the server, so a terminal offline can't open, add to or pay a
check. It shows them read-only from its last copy and says why. Quick sales keep
queuing offline as today. Offline open checks (local check + replay of
add/send/pay events) is a separate, later step if restaurants ask for it.

### Day end and shifts

- Day-end (DayEndStatusMatrix) lists open checks and blocks closing the day
  until each one is paid, moved to the next day (kept open) or voided.
- Closing a shift is not blocked (checks belong to the branch, not to a drawer).
  The shift close screen shows how many checks are still open.

### Guest QR orders (later phase)

A guest's QR order for a table becomes a pending round on the table's open check
(opening one if needed), which a waiter confirms before it's sent. This replaces
the separate `pos_table_orders` flow and its "paid without a sale" gap.

## Phases

1. **2b.1 core:** migration; checks API (open, list, get, add/edit/void unsent
   lines, send, pay, void); kitchen tickets per round; table status from the
   check; POS "Open checks" panel and "Send to kitchen"; floor plan opens checks.
2. **2b.2 service:** void sent lines (manager), move, merge, pre-bill print with
   discount/surcharge, Waiter page on phones, day-end guard, open-checks report
   (value, age, server).
3. **2b.3 guests:** QR orders into checks; reservations seat a table.

## Tests

- Server: one open check per table; lines priced on add and charged at that price
  on pay; `price_changed` on add; unsent-only edits; void rules by role; send makes
  one ticket per round and never resends lines; pay with one sale, split payment
  and split bill records `check_id` and closes the check in one transaction;
  pay retried with the same key records once; `version` conflicts; move/merge keep
  every line; voided sent line cancels the ticket item; a sale with `check_id`
  makes no extra kitchen ticket.
- Staging (rolled back): open → send two rounds → pay by split bill → two sales,
  two kitchen tickets (not four), table `dirty`, stock deducted once.
- Click-through on staging as the QA waiter and cashier on two terminals at once.

## Decisions for the owner

1. **Who can pay a check:** waiters too (today waiters can ring up sales), or
   cashiers/managers only?
2. **Voiding a sent item:** manager only (proposed), or cashier with a reason?
3. **Stock for voided sent items:** count nothing (proposed for 2b.1), or record
   as waste?
4. **Service charge:** many Riyadh restaurants add one; use the document surcharge
   on the check (proposed), or a separate service-charge setting per branch?
5. **Is dine-in a priority now?** No production customer uses tables yet. If the
   next customers are quick-service or delivery, other gaps may matter more.
