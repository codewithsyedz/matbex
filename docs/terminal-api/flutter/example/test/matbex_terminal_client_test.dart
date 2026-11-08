// Integration tests for MatbexTerminalClient - verifies that every request
// carries the correct headers (X-Terminal-Key, Authorization, Idempotency-Key,
// Content-Type, X-Platform, X-App-Version) and that pair() persists the
// device key to secure storage.

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/api/matbex_terminal_client.dart';
import '_helpers.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late RecordingAdapter adapter;
  late FakeSecureStorage storage;
  late Dio dio;
  late MatbexTerminalClient client;

  setUp(() {
    storage = FakeSecureStorage()..install();
    adapter = RecordingAdapter();
    dio = Dio()..httpClientAdapter = adapter;
    client = MatbexTerminalClient(
      baseUrl: 'https://api.test/terminal-api',
      dio: dio,
    );
  });

  tearDown(() => storage.uninstall());

  group('pair', () {
    test('does NOT send terminal key or cashier JWT, persists device_key', () async {
      adapter.enqueueOk(body: {
        'data': {
          'terminal_id': 't-1',
          'restaurant_id': 'r-1',
          'name': 'Counter 1',
          'device_key': 'RAW_KEY_123',
        }
      });

      await client.pair(code: '482915', name: 'Counter 1');

      expect(adapter.requests, hasLength(1));
      final r = adapter.requests.single;
      expect(r.method, 'POST');
      expect(r.path, '/terminal-api/pair');
      expect(r.header('X-Terminal-Key'), isNull,
          reason: 'pair() must be unauthenticated');
      expect(r.header('Authorization'), isNull);
      expect(r.body['code'], '482915');

      expect(client.isPaired, isTrue);
      expect(storage.store['matbex.terminal.device_key'], 'RAW_KEY_123');
    });
  });

  group('authenticated requests', () {
    setUp(() async {
      // Pre-pair via storage + load
      storage.store['matbex.terminal.device_key'] = 'DEVICE_KEY_X';
      await client.loadDeviceKey();
      client.setCashierJwt('JWT_ABC');
    });

    test('attach X-Terminal-Key, Bearer JWT, X-Platform, X-App-Version', () async {
      adapter.enqueueOk(body: {'data': []});
      await client.getMenu();

      final r = adapter.requests.single;
      expect(r.method, 'GET');
      expect(r.path, '/terminal-api/menu');
      expect(r.header('X-Terminal-Key'), 'DEVICE_KEY_X');
      expect(r.header('Authorization'), 'Bearer JWT_ABC');
      expect(r.header('X-App-Version'), '1.0.0');
      expect(r.header('X-Platform'), isNotNull);
    });

    test('writes generate a fresh Idempotency-Key per request', () async {
      adapter.enqueueOk();
      adapter.enqueueOk();

      await client.cashEvent(
          shiftId: 's-1', eventType: 'drop', amount: 50);
      await client.cashEvent(
          shiftId: 's-1', eventType: 'drop', amount: 50);

      final keys = adapter.requests
          .map((r) => r.header('Idempotency-Key'))
          .toList();
      expect(keys, hasLength(2));
      expect(keys[0], isNotNull);
      expect(keys[1], isNotNull);
      expect(keys[0], isNot(keys[1]),
          reason: 'each direct call must mint its own UUID');
      expect(adapter.requests.first.header('Content-Type'),
          contains('application/json'));
    });

    test('caller-supplied idempotencyKey is honoured (offline replay)', () async {
      adapter.enqueueOk();
      await client.recordSale(
        shiftId: 's-1',
        paymentMethod: 'cash',
        items: [SaleItem(menuItemId: 'm-1', quantity: 1, unitPrice: 10)],
        idempotencyKey: 'fixed-key-xyz',
      );
      expect(adapter.requests.single.header('Idempotency-Key'), 'fixed-key-xyz');
    });

    test('throws MatbexApiException for not_paired before pair()', () async {
      // Reset storage and reload
      storage.store.clear();
      await client.loadDeviceKey();
      expect(
        () => client.heartbeat(),
        throwsA(isA<MatbexApiException>()
            .having((e) => e.code, 'code', 'not_paired')),
      );
    });

    test('parses server error envelope into MatbexApiException', () async {
      adapter.enqueueStatus(403, body: {
        'api_version': '1',
        'error': {'code': 'terminal_revoked', 'message': 'gone'}
      });
      expect(
        () => client.heartbeat(),
        throwsA(isA<MatbexApiException>()
            .having((e) => e.status, 'status', 403)
            .having((e) => e.code, 'code', 'terminal_revoked')),
      );
    });
  });
}
