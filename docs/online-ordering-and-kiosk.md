# Online Ordering, Kiosk & Order Manager

This document covers the customer-facing ordering surfaces (public storefront and in-store kiosk), the staff-facing Order Manager (KDS), and the delivery economics that tie them together.

## 1. Public ordering storefront (`/order/<restaurant_id>`)

A hosted, branded ordering page for each restaurant. Customers can:

- Browse the live menu (categories, variants, modifiers, photos).
- Place a delivery or pickup order.
- See the prep time, minimum order amount, and the live delivery fee.

The storefront reads from `online_ordering_settings` and writes to `online_orders`. Items are pulled from the menu in real time — sold-out items are dimmed and disabled.

## 2. In-store kiosk (`/kiosk`)

Any tablet can be put into kiosk mode. The kiosk:

- Renders the same live menu as the storefront.
- Captures dine-in / takeaway intent.
- Submits orders into the same `online_orders` pipeline so they appear in the Order Manager alongside online orders.
- Stores full order details (line items, modifiers, totals) so staff have everything they need to fulfil.

## 3. Order Manager / Kitchen Display (`/order-manager`)

A staff-facing Kanban board that surfaces every incoming kiosk and online order. Lanes:

1. **Pending** — newly received, not yet acknowledged.
2. **Confirmed** — accepted by staff.
3. **Preparing** — kitchen has started.
4. **Ready** — handed to customer or rider.

Each card shows the order channel (kiosk / online), customer info, line items, modifiers, totals, and timestamps. Staff move cards forward as the order progresses.

## 4. Online Order Settings (`/online-order-settings`)

Single source of truth for the storefront. Key controls:

- **Accepting orders** — master toggle. When OFF, the storefront shows a custom message and disables checkout.
- **Storefront message** — shown when paused (e.g. "We're closed until 5pm").
- **Prep time (minutes)** — surfaced to customers at checkout.
- **Minimum order amount** — enforced before checkout.
- **Flat delivery fee** — used as a fallback when no tier matches.
- **Delivery fee tiers** — see below.
- **Rider commission %** — see below.

## 5. Tiered delivery fees

Define a table of subtotal ranges and the fee that applies in each range. Example:

| Subtotal range | Fee |
| -------------- | --- |
| 0 – 50         | 15  |
| 50 – 100       | 10  |
| 100+           | 0   |

Stored on `online_ordering_settings.delivery_fee_tiers` as a JSON array of `{ min_subtotal, max_subtotal, fee }`.

At checkout, `computeDeliveryFee(subtotal, tiers, fallbackFlat)` (in `src/lib/deliveryFee.ts`) sorts tiers by `min_subtotal` and picks the first tier where `subtotal >= min_subtotal && subtotal < max_subtotal`. If no tier matches, it falls back to the flat delivery fee.

Scope: **delivery orders only**. Pickup orders ignore tiers and fees entirely.

## 6. Rider commission (HungerStation / Jahez / Mrsool style)

`rider_commission_pct` on `online_ordering_settings` is an **internal** percentage of the delivery fee that represents the rider's payout.

- It does **not** increase the customer total.
- On every delivery order, `computeRiderCommission(deliveryFee, pct)` is computed and stored on `online_orders.rider_commission`.
- `delivery_fee − rider_commission = restaurant's net delivery revenue`, which is used for payout reconciliation and reporting.

## 7. Data model summary

- `online_ordering_settings`
  - `accepting_orders` (bool)
  - `storefront_message` (text)
  - `prep_time_minutes` (int)
  - `min_order_amount` (numeric)
  - `delivery_fee` (numeric, flat fallback)
  - `delivery_fee_tiers` (jsonb array)
  - `rider_commission_pct` (numeric)
- `online_orders`
  - line items, totals, channel (kiosk / online), status, customer info
  - `delivery_fee` (numeric)
  - `rider_commission` (numeric, internal)

## 8. Common operations

- **Pause ordering**: Settings → toggle off **Accepting orders** + set a storefront message.
- **Run a promo (free delivery above 100)**: add a tier `{ min: 100, max: null, fee: 0 }`.
- **Change rider cut**: update `rider_commission_pct`. Applies to all future orders; historical orders keep the value they were created with.
- **Reassign or cancel an order**: handled from `/order-manager` (cancellations void the corresponding entries; see the immutable ledger rules).