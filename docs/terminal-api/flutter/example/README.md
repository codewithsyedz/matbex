# Matbex POS - Flutter demo (Android + iOS)

Minimal cashier app showing how to wire up the Matbex Terminal API:

1. **Pair** - enter a 6-digit code from Settings → POS Terminals.
2. **Login** - cashier logs in via Supabase Auth.
3. **Open shift** - set opening float.
4. **Browse menu** + **record sale** - taps build a cart, payment method
   selectable, queued offline if no network.
5. **Close shift** - count cash and submit.

## Run

```bash
cd docs/terminal-api/flutter/example
cp -r ../matbex_terminal_client.dart lib/api/
cp -r ../matbex_offline_queue.dart   lib/api/
flutter pub get
flutter run            # auto-detects iOS simulator or Android emulator
```

The app uses the production Matbex backend by default. Override via
`--dart-define`:

```bash
flutter run \
  --dart-define=MATBEX_API_BASE=https://api.matbex.com/functions/v1/terminal-api \
  --dart-define=SUPABASE_URL=https://api.matbex.com \
  --dart-define=SUPABASE_ANON_KEY=eyJ...
```

## Platform setup

**iOS** - `ios/Runner/Info.plist` already permits HTTPS. For Keychain
access add the *Keychain Sharing* capability in Xcode if you embed
multiple targets.

**Android** - `android/app/build.gradle` must have `minSdkVersion 21+`
(required by `flutter_secure_storage` and `sqflite`). Internet permission
is included by default.

## Tests

Integration tests for the API client and offline queue live in `test/`:

```bash
flutter test
```

They run against a recording HTTP adapter (no real network) and an in-memory
SQLite database (`sqflite_common_ffi`), and cover:

- `pair()` is unauthenticated and persists `device_key` to secure storage
- every authenticated request carries `X-Terminal-Key`, `Authorization: Bearer <jwt>`,
  `X-Platform`, and `X-App-Version`
- writes generate fresh `Idempotency-Key` UUIDs; caller-supplied keys are honoured
- offline queue retries network errors and 5xx with the **same** idempotency key
- non-retryable 4xx (e.g. `terminal_revoked`) is parked, not looped
- FIFO ordering is preserved (shift open before sales)
