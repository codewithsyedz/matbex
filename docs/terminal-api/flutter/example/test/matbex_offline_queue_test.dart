// Integration tests for MatbexOfflineQueue:
//  - same Idempotency-Key is reused across retries
//  - retryable failures (5xx, network) are retried with backoff
//  - non-retryable 4xx errors are parked, not looped
//  - successful drains remove rows from the persistent queue

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';
import 'package:path/path.dart' as p;
import 'dart:io';

import '../lib/api/matbex_terminal_client.dart';
import '../lib/api/matbex_offline_queue.dart';
import '_helpers.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // sqflite_common_ffi for desktop test runner
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late RecordingAdapter adapter;
  late FakeSecureStorage storage;
  late MatbexTerminalClient client;
  late MatbexOfflineQueue queue;
  late Directory tmpDir;

  setUp(() async {
    storage = FakeSecureStorage()..install();
    storage.store['matbex.terminal.device_key'] = 'DEVICE_KEY_X';

    adapter = RecordingAdapter();
    final dio = Dio()..httpClientAdapter = adapter;
    client = MatbexTerminalClient(baseUrl: 'https://api.test/terminal-api', dio: dio);
    await client.loadDeviceKey();
    client.setCashierJwt('JWT_ABC');

    tmpDir = await Directory.systemTemp.createTemp('matbex_queue_test_');
    queue = MatbexOfflineQueue(
      client: client,
      dbPath: p.join(tmpDir.path, 'queue.db'),
      // Drive connectivity manually - never touches the real plugin
      connectivityStream: const Stream.empty(),
      baseBackoff: const Duration(milliseconds: 5),
      maxBackoff: const Duration(milliseconds: 50),
      maxAttempts: 4,
    );
    await queue.init();
  });

  tearDown(() async {
    await queue.dispose();
    await tmpDir.delete(recursive: true);
    storage.uninstall();
  });

  test('successful sale drains the queue and uses one idempotency key', () async {
    adapter.enqueueOk(body: {
      'data': {'sale': {'id': 'srv-1', 'total': 25}, 'receipt_number': 'T-1'}
    });

    final key = await queue.enqueueSale(
      shiftId: 's-1',
      paymentMethod: 'cash',
      items: [SaleItem(menuItemId: 'm-1', quantity: 1, unitPrice: 25)],
    );

    // wait for drain
    await queue.drain();

    expect(adapter.requests, hasLength(1));
    expect(adapter.requests.single.header('Idempotency-Key'), key);
    expect(adapter.requests.single.path, '/terminal-api/sales');
    expect(await queue.pendingCount(), 0);
  });

  test('retries network failure with same Idempotency-Key, eventually succeeds',
      () async {
    adapter.enqueueNetworkError(); // 1
    adapter.enqueueStatus(503, body: {
      'error': {'code': 'upstream', 'message': 'down'}
    }); // 2
    adapter.enqueueOk(body: {'data': {'id': 'ok'}}); // 3

    final key = await queue.enqueueCashEvent(
      shiftId: 's-1', eventType: 'drop', amount: 100);

    // Force successive drain attempts (timer would also do this, but explicit
    // calls keep the test deterministic).
    await queue.drain();
    await queue.drain();
    await queue.drain();

    expect(adapter.requests.length, 3);
    final keys =
        adapter.requests.map((r) => r.header('Idempotency-Key')).toSet();
    expect(keys, {key},
        reason: 'every retry must reuse the original idempotency key');
    expect(await queue.pendingCount(), 0);
  });

  test('non-retryable 4xx parks the item instead of looping forever', () async {
    adapter.enqueueStatus(403, body: {
      'error': {'code': 'terminal_revoked', 'message': 'revoked'}
    });

    await queue.enqueueCashEvent(
        shiftId: 's-1', eventType: 'drop', amount: 100);
    await queue.drain();

    expect(adapter.requests, hasLength(1),
        reason: 'must not retry a non-retryable 4xx');

    final stuck = await queue.pendingItems();
    expect(stuck, hasLength(1));
    expect(stuck.single.lastError, contains('terminal_revoked'));
    expect(stuck.single.attempts, 1);

    // Subsequent drain must NOT re-attempt the parked item
    await queue.drain();
    expect(adapter.requests, hasLength(1));
  });

  test('gives up after maxAttempts on persistent retryable failures', () async {
    for (var i = 0; i < 10; i++) {
      adapter.enqueueStatus(500, body: {
        'error': {'code': 'server_error', 'message': 'boom'}
      });
    }

    await queue.enqueueCashEvent(
        shiftId: 's-1', eventType: 'drop', amount: 1);

    for (var i = 0; i < queue.maxAttempts + 1; i++) {
      await queue.drain();
    }

    expect(adapter.requests.length, queue.maxAttempts);
    final stuck = await queue.pendingItems();
    expect(stuck, hasLength(1));
    expect(stuck.single.attempts, queue.maxAttempts);
  });

  test('FIFO order: open shift before sale recorded against it', () async {
    adapter.enqueueOk(); // open shift
    adapter.enqueueOk(); // sale

    await queue.enqueueOpenShift(openingFloat: 100);
    await queue.enqueueSale(
      shiftId: 's-1',
      paymentMethod: 'cash',
      items: [SaleItem(menuItemId: 'm-1', quantity: 1, unitPrice: 5)],
    );

    await queue.drain();

    expect(adapter.requests[0].path, '/terminal-api/shifts/open');
    expect(adapter.requests[1].path, '/terminal-api/sales');
  });
}
