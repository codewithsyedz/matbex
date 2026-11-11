# Matbex Terminal API - Native POS Collections

Drop-in API collections for Android / iOS POS terminal apps integrating with the
`terminal-api` edge function.

## Files

| File | Format | Use with |
|------|--------|----------|
| `matbex-terminal-api.postman_collection.json` | Postman v2.1 | Postman, Insomnia, Bruno, Hoppscotch |
| `matbex-terminal-api.postman_environment.json` | Postman environment | Postman / Insomnia |
| `matbex-terminal-api.openapi.yaml` | OpenAPI 3.1 | Swagger UI, Stoplight, code generators (openapi-generator, swagger-codegen, Kiota) |

## Environment variables

| Variable | Example | Notes |
|----------|---------|-------|
| `baseUrl` | `https://api.matbex.com/functions/v1/terminal-api` | Function base URL |
| `anonKey` | `eyJhbGciOi...` | Supabase publishable key (safe in client) |
| `deviceKey` | `RAW_KEY_FROM_PAIR` | Returned **once** by `POST /pair` |
| `cashierJwt` | `eyJhbGciOi...` | Supabase Auth access token of the logged-in cashier |
| `pairingCode` | `482915` | 6-digit code from web app |
| `shiftId` | `uuid` | Active shift |
| `menuItemId` | `uuid` | For sample sale |
| `saleId` | `uuid` | For void/settlement |
| `customerId` | `uuid` | Optional |
| `idempotencyKey` | UUID v4 | Generated per write |

## Code generation

```bash
# Kotlin (Android)
npx @openapitools/openapi-generator-cli generate \
  -i docs/terminal-api/matbex-terminal-api.openapi.yaml \
  -g kotlin -o android/app/src/main/java/net/matbex/api \
  --additional-properties=library=jvm-retrofit2,serializationLibrary=kotlinx_serialization

# Swift (iOS)
npx @openapitools/openapi-generator-cli generate \
  -i docs/terminal-api/matbex-terminal-api.openapi.yaml \
  -g swift5 -o ios/MatbexTerminalAPI \
  --additional-properties=responseAs=AsyncAwait,projectName=MatbexTerminalAPI
```

## Flutter (Android + iOS)

Recommended: generate a typed `dart-dio` client from the OpenAPI spec - works
on both platforms from a single Flutter codebase.

```bash
# 1. Generate the SDK into packages/matbex_terminal_api
npx @openapitools/openapi-generator-cli generate \
  -i docs/terminal-api/matbex-terminal-api.openapi.yaml \
  -g dart-dio \
  -o packages/matbex_terminal_api \
  --additional-properties=pubName=matbex_terminal_api,pubAuthor=Matbex,nullableFields=true

# 2. Wire it up
cd packages/matbex_terminal_api && dart pub get && dart run build_runner build -d
```

Add to your Flutter app's `pubspec.yaml`:

```yaml
dependencies:
  matbex_terminal_api:
    path: packages/matbex_terminal_api
  dio: ^5.4.0
  flutter_secure_storage: ^9.0.0   # store deviceKey in Keychain / EncryptedSharedPreferences
  uuid: ^4.0.0                     # idempotency keys
  supabase_flutter: ^2.0.0         # cashier auth (provides JWT)
```

### Hand-written client (lighter alternative)

If you don't want the generator step, a ready-to-use Dart client is provided at
[`flutter/matbex_terminal_client.dart`](./flutter/matbex_terminal_client.dart).
It depends only on `dio`, `uuid`, and `flutter_secure_storage` and covers all
endpoints with idempotent retries and secure key storage.

### Offline queue

An offline-first replay queue is provided at
[`flutter/matbex_offline_queue.dart`](./flutter/matbex_offline_queue.dart).
It persists writes to SQLite (`sqflite`), assigns each operation a stable
`Idempotency-Key`, and drains the queue automatically when connectivity
returns (`connectivity_plus`). Safe for sales, voids, cash events, shift
open/close, and customer settlements.

Add to `pubspec.yaml`:

```yaml
dependencies:
  sqflite: ^2.3.0
  path: ^1.9.0
  path_provider: ^2.1.0
  connectivity_plus: ^6.0.0
```

```dart
final queue = MatbexOfflineQueue(client: client);
await queue.init();
queue.start();   // listens to connectivity, drains automatically

// UI badge
queue.statusStream.listen((s) => setState(() => _status = s));

// Record a sale - returns immediately even when offline
final idempotencyKey = await queue.enqueueSale(
  shiftId: shiftId,
  paymentMethod: 'cash',
  items: [SaleItem(menuItemId: id, quantity: 1, unitPrice: 25)],
);

// Inspect failed/parked items for manual review
final stuck = await queue.pendingItems();
```

Behaviour:

- **Idempotency** - every enqueued op has a UUID v4 key. The client sends the
  same key on every retry, so the server de-duplicates automatically.
- **Retry policy** - exponential backoff (2s → 4s → 8s … capped at 5 min),
  up to 8 attempts. 5xx, 408, 429, and network errors are retried. 4xx with
  a server error code (e.g. `terminal_revoked`, validation, fiscal lock) is
  parked with `last_error` for manual review instead of looping forever.
- **Ordering** - strict FIFO per device. Shift open is replayed before any
  sales recorded against it, etc.
- **Crash safety** - items are persisted before `enqueue*` returns; an app
  kill mid-flight resumes on next launch via `init()` + `start()`.
- **Debug toggle** - `queue.setSimulatedOffline(true)` forces the drain loop
  into an offline state without touching airplane mode. Newly enqueued
  writes still persist to SQLite; flipping it back to `false` replays them
  in FIFO order, so QA can verify replay and conflict handling on a real
  device. The example app exposes this as a cloud icon in the home screen
  app bar.

### Runnable demo app

A complete minimal cashier app (pair → login → open shift → browse menu →
queue sale → close shift) lives in [`flutter/example/`](./flutter/example/).

```bash
cd docs/terminal-api/flutter/example
mkdir -p lib/api
cp ../matbex_terminal_client.dart lib/api/
cp ../matbex_offline_queue.dart   lib/api/
flutter pub get
flutter run                # iOS simulator or Android emulator auto-detected
```

The demo wires the offline queue to a connectivity badge in the app bar
(green = online, orange = offline with pending count, blue = syncing) and
routes every `Charge` tap through `queue.enqueueSale(...)` so you can
toggle airplane mode and watch sales replay on reconnect.

### Typed models + mappers

Hand-written, dependency-free Dart models matching the OpenAPI schemas
live in [`flutter/matbex_models.dart`](./flutter/matbex_models.dart).
Domain → wire conversion helpers (cart → `SaleRequest`, customer →
`SettlementRequest`, raw rows → `MenuItem`/`Customer`/`Shift`/`SaleRecord`)
live in [`flutter/matbex_mappers.dart`](./flutter/matbex_mappers.dart).

Both files are pure Dart (no Flutter imports) so they can be reused in
isolates, tests, or a CLI without pulling in Dio or `flutter_secure_storage`.
Copy them next to the client when wiring the example app:

```bash
cp ../matbex_models.dart  lib/api/
cp ../matbex_mappers.dart lib/api/
```

Typical usage:

```dart
import 'api/matbex_models.dart';
import 'api/matbex_mappers.dart';

// 1. Read side - turn raw responses into typed objects
final menu      = parseMenu(await client.getMenu());
final shift     = parseCurrentShift(await client.currentShift());
final customers = parseCustomers(await client.searchCustomers('ali'));
final today     = parseSalesToday(await client.salesToday());

// 2. Write side - build a SaleRequest from your cart
final req = buildSaleRequest(
  shiftId:       shift!.id,
  paymentMethod: PaymentMethod.cash,
  cart: cart.map((l) => CartLineSpec(
        menuItemId: l.menuItemId,
        quantity:   l.quantity,
        unitPrice:  l.unitPrice,
      )),
);

// 3. Hand off to the queue (or client.recordSale) - same wire shape
await queue.enqueueSale(
  shiftId:       req.shiftId,
  paymentMethod: req.paymentMethod.wire,
  items:         toClientSaleItems(req.items),
  isUnpaid:      req.isUnpaid,
  customerId:    req.customerId,
);

// 4. Settlements
final settlement = buildFullSettlement(
  customer:      selectedCustomer,
  paymentMethod: SettlementPaymentMethod.cash,
);
await client.recordSettlement(
  customerId:    settlement.customerId,
  amount:        settlement.amount,
  paymentMethod: settlement.paymentMethod.wire,
  note:          'Full settlement',
);
```

Validation invariants enforced by `buildSaleRequest` /
`buildSettlement` mirror the server: empty carts, missing customers on
`customer_credit` / `is_unpaid` sales, and non-positive settlement
amounts all throw before a request leaves the device.

```dart
final client = MatbexTerminalClient(
  baseUrl: 'https://api.matbex.com/functions/v1/terminal-api',
);
await client.loadDeviceKey();              // from secure storage if previously paired
client.setCashierJwt(supabase.auth.currentSession!.accessToken);

// Pair (one-time)
final paired = await client.pair(code: '482915', name: 'Counter 1');
// device_key auto-stored in Keychain / EncryptedSharedPreferences

// Record a sale
final sale = await client.recordSale(
  shiftId: shiftId,
  paymentMethod: 'cash',
  items: [SaleItem(menuItemId: id, quantity: 2, unitPrice: 25.0)],
);
```

### Platform notes

- **iOS** - add to `ios/Runner/Info.plist` if your environment uses HTTP for
  development: nothing needed for production HTTPS. Enable Keychain sharing if
  you embed multiple targets.
- **Android** - `flutter_secure_storage` requires `minSdkVersion 18+`. Add
  `<uses-permission android:name="android.permission.INTERNET"/>` to
  `android/app/src/main/AndroidManifest.xml` (Flutter adds it by default in
  debug builds).
- **Background sync** - wrap `MatbexTerminalClient` calls in your offline queue
  (e.g. `workmanager` on Android, `background_fetch` on iOS) and reuse the same
  `Idempotency-Key` across retries.

## Auth recap

Every request except `POST /pair` requires **both** headers:

```
X-Terminal-Key: {{deviceKey}}
Authorization: Bearer {{cashierJwt}}
```

All POST/PUT requests should send a unique `Idempotency-Key` (UUID v4).
Replays return the original response - safe for offline-first apps.

See [`docs/terminal-api.md`](../terminal-api.md) for the full protocol reference.