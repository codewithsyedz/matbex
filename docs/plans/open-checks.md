# Open checks (running tabs) — plan

Status: 2b.1 (core) on staging and tested (2026-11-25); 2b.2 (service) built on
custom-backend (2026-11-25), not yet on staging. Owner decisions 1, 3, 4, 5 taken; 2 (who
voids sent items) built as proposed: a manager/owner, or anyone with the admin PIN, with a
reason. Phase 2b of docs/plans/split-payments.md.

Built in 2b.1: `pos_checks`, `pos_check_lines`, `pos_check_rounds`,
`sales_transactions.check_id`, check counter; /api/v1/pos/checks (list, get, open, add,
edit/remove unsent lines, send, void, pay by payments or split bill, with versions and an
idempotent pay); one kitchen ticket per round and none for the paying sale; table status
follows the check; "Open checks" sheet and "Send to kitchen" on /record-sale and the mobile
POS; the floor plan opens a table's check.

Built in 2b.2: voiding sent items (all or some units; manager or admin PIN, reason) cancels
the kitchen item (struck through on the KDS) and records recipe waste (waste_records +
'waste' stock movement + ledger, `check_line_id` links); voiding a whole check with sent
items does the same per item; branch service charge (`branches.service_charge_percent`,
set in branch settings), waivable by a manager/PIN, charged as the sale's document
surcharge and stored in `sales_transactions.service_charge`; move to another table; merge
checks (rounds renumbered); pre-bill (receipt printer on /record-sale, else browser print;
table → billing); day end refuses to close with checks open (`validate_day_close`);
checks report for owners/managers (open now, paid, service charge, voids and waste).
Not built: a separate waiter page (the mobile POS has the same sheet); service charge on
ordinary (non-check) sales.

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
an invoice.

**Voided items that were already sent are recorded as waste** (owner decision): the
food was made and thrown away. In the void's transaction the API expands the item's
recipe (`recipe_ingredients`, combos into their components) into one `waste_records`
row per ingredient (quantity × recipe amount, unit cost from the inventory item,
`waste_reason = 'voided_order'`, notes with check number and void reason), writes a
`stock_movements` row of type `waste` and lowers `current_stock`, all atomically.
`trg_auto_post_waste_to_ledger` posts the waste expense as it does for waste entered by
hand. Items with no recipe produce no waste rows (nothing to deduct); the void is still
listed. Unsent voided lines were never made: no waste. Voiding a whole check with sent
rounds does the same for each of its sent lines.

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

### Service charge (per branch)

Owner decision: a separate setting per branch, not a manual surcharge.

- Branch settings: `service_charge_percent` (0 = off) and `service_charge_scope`
  (`dine_in_checks` default, or `all_sales`). Owners/managers set it in branch
  settings; the API reads it, the browser never sends the amount.
- On a check it's computed on the lines total after any discount, shown as its own
  line on the check, pre-bill and receipt ("Service charge 10%"), and charged
  through the sale's document surcharge, so totals, VAT and ZATCA work as they do now.
  KSA VAT applies to service charges, so it goes into the VAT base.
- A manager can waive it on a check (with a reason), like a discount.
- Split bill spreads it over the parts like any surcharge (already built).
- Reports: service charge collected per day/branch (sales with a service charge
  store it in a new `sales_transactions.service_charge` column, also counted in
  `document_surcharge`).

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
2. **2b.2 service:** void sent lines (manager or admin PIN) with waste records,
   branch service charge, move, merge, pre-bill print, Waiter page on phones,
   day-end guard, open-checks report (value, age, server, voids and waste).
3. **2b.3 guests:** QR orders into checks; reservations seat a table.

## Tests

- Server: one open check per table; lines priced on add and charged at that price
  on pay; `price_changed` on add; unsent-only edits; void rules by role; send makes
  one ticket per round and never resends lines; pay with one sale, split payment
  and split bill records `check_id` and closes the check in one transaction;
  pay retried with the same key records once; `version` conflicts; move/merge keep
  every line; voided sent line cancels the ticket item and records waste per recipe
  ingredient (stock lowered once, ledger posted), an unsent void records none; service
  charge from the branch setting, in the VAT base, waivable by a manager, spread over
  split-bill parts; a sale with `check_id` makes no extra kitchen ticket.
- Staging (rolled back): open → send two rounds → pay by split bill → two sales,
  two kitchen tickets (not four), table `dirty`, stock deducted once.
- Click-through on staging as the QA waiter and cashier on two terminals at once.

## Decisions for the owner

1. **Who can pay a check:** decided 2026-11-24: waiters can pay, like any sale
   today (owner, manager, cashier, waiter). A per-restaurant "cashiers only" setting
   can come later if an owner asks.
2. **Voiding a sent item:** undecided. Proposed: a manager/owner, or a cashier or
   waiter with the admin PIN (AdminPinDialog, as other protected POS actions) and a
   reason; every void listed in the open-checks report.
3. **Stock for voided sent items:** decided 2026-11-24: recorded as waste (see
   "Stock, COGS, ledger, ZATCA").
4. **Service charge:** decided 2026-11-24: a separate setting per branch (see
   "Service charge").
5. **Is dine-in a priority now?** decided 2026-11-24: yes, even though no
   production customer uses tables yet.
