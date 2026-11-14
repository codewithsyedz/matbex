# Matbex Terminal API (v1)

Standalone REST API for Android / native POS terminals to record sales, manage shifts, sync menus, and settle customer balances. The web POS app continues to use Supabase directly; this API is for any **separate** terminal app.

Base URL:

```
https://api.matbex.com/functions/v1/terminal-api
```

## Authentication

Every request (except `/pair`) requires **two** headers:

| Header              | Value                          | Purpose                          |
|---------------------|--------------------------------|----------------------------------|
| `X-Terminal-Key`    | `<device key from /pair>`      | Identifies the terminal device   |
| `Authorization`     | `Bearer <cashier JWT>`         | Identifies the logged-in cashier |

Optional:

| Header             | Notes                                   |
|--------------------|-----------------------------------------|
| `Idempotency-Key`  | Recommended for all writes. Replays return the original response. |
| `X-App-Version`    | Recorded on the terminal row.           |
| `X-Platform`       | e.g. `android`, `ios`, `web`.           |

## Pairing flow

1. **Owner / manager** opens **Settings → POS Terminals → New pairing code** in the web app.
   A 6-digit code is generated, valid for 15 min.
2. **Terminal app** calls:

   ```http
   POST /pair
   Content-Type: application/json

   { "code": "482915", "name": "Counter 1", "platform": "android", "app_version": "1.0.0" }
   ```

   Response (200):
   ```json
   {
     "data": {
       "terminal_id": "uuid",
       "restaurant_id": "uuid",
       "name": "Counter 1",
       "device_key": "RAW_KEY_RETURNED_ONCE_STORE_SECURELY"
     }
   }
   ```

3. The terminal app stores `device_key` in **Capacitor Preferences / Android Keystore**.
   The server stores **only the SHA-256 hash** - the raw key cannot be recovered.
4. Cashier logs in via Supabase Auth on the device → obtains a JWT → app sends both headers.

## Endpoints

| Method | Path                 | Description                                          |
|--------|----------------------|------------------------------------------------------|
| POST   | `/pair`              | Exchange pairing code for a device key (one-time).   |
| GET    | `/health`            | Heartbeat. Updates `last_seen_at`.                   |
| GET    | `/menu`              | Active menu items, prices, variants, image URLs.     |
| GET    | `/customers?q=`      | Search customers by name / phone / email (limit 50). |
| GET    | `/shifts/current`    | The cashier's currently open shift, if any.          |
| POST   | `/shifts/open`       | Open a shift with `opening_float`.                   |
| POST   | `/shifts/close`      | Close a shift with `counted_cash`, `counted_card`.   |
| POST   | `/shifts/cash-event` | `drop` / `payout` / `pay-in` / `open` / `close`.     |
| POST   | `/sales`             | Record a sale (line items + payment_method).         |
| POST   | `/sales/:id/void`    | Void an existing sale.                               |
| GET    | `/sales/today`       | All of today's sales for the restaurant.             |
| POST   | `/settlements`       | Record a customer payment against outstanding sales. |

### Example: record a sale

```http
POST /sales
X-Terminal-Key: ...
Authorization: Bearer eyJ...
Idempotency-Key: 8e1f...
Content-Type: application/json

{
  "shift_id": "uuid",
  "payment_method": "cash",
  "is_unpaid": false,
  "items": [
    { "menu_item_id": "uuid", "quantity": 2, "unit_price": 25.0 },
    { "menu_item_id": "uuid", "quantity": 1, "unit_price": 12.5 }
  ]
}
```

Response:
```json
{
  "api_version": "1",
  "data": {
    "sale": { "id": "...", "total": 62.5, "receipt_number": "T-LX2K9P" },
    "receipt_number": "T-LX2K9P"
  }
}
```

## Error envelope

```json
{ "api_version": "1", "error": { "code": "invalid_terminal_key", "message": "Unknown terminal key" } }
```

| HTTP | code                          | Cause                                  |
|------|-------------------------------|----------------------------------------|
| 400  | `bad_request`                 | Validation error                       |
| 401  | `no_terminal_key` / `invalid_terminal_key` / `no_cashier_token` / `invalid_cashier_token` / `invalid_code` | Auth failure |
| 403  | `terminal_revoked` / `cashier_not_in_tenant` | Authz failure              |
| 404  | `not_found`                   | Unknown route                          |
| 500  | `server_error`                | Unhandled exception                    |

## Idempotency

Send a unique `Idempotency-Key` (UUID v4 recommended) for every write. The server stores
a snapshot of the response. Any subsequent retry with the same key returns the original
response with `"replayed": true` - safe for offline-first apps and flaky networks.

## Revocation

An owner / manager can revoke a terminal in **Settings → POS Terminals**. Revoked terminals
receive `403 terminal_revoked` on every request and must re-pair to obtain a new device key.