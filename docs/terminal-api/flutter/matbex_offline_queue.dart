// =====================================================================
// Matbex Terminal API - Flutter offline queue
// ---------------------------------------------------------------------
// Persists writes (sales, cash events, shift open/close, settlements)
// to a local SQLite store and replays them once connectivity returns.
// Each enqueued operation owns a stable Idempotency-Key, so replays
// are safe even if the network died mid-request.
//
// pubspec.yaml additions (on top of matbex_terminal_client.dart):
//   sqflite: ^2.3.0
//   path: ^1.9.0
//   path_provider: ^2.1.0
//   connectivity_plus: ^6.0.0
//   uuid: ^4.0.0
//
// Usage:
//   final queue = MatbexOfflineQueue(client: client);
//   await queue.init();
//   queue.start();                   // begins listening to connectivity
//   await queue.enqueueSale(...);    // returns immediately, replays later
//   queue.statusStream.listen(...);  // for UI badge
// =====================================================================

import 'dart:async';
import 'dart:convert';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

import 'matbex_terminal_client.dart';

enum QueueOpKind { sale, voidSale, cashEvent, openShift, closeShift, settlement }

enum QueueStatus { idle, syncing, offline, failed }

class QueueItem {
  final int? id;
  final String idempotencyKey;
  final QueueOpKind kind;
  final Map<String, dynamic> payload;
  final int attempts;
  final String? lastError;
  final DateTime createdAt;
  final DateTime? nextAttemptAt;

  QueueItem({
    this.id,
    required this.idempotencyKey,
    required this.kind,
    required this.payload,
    this.attempts = 0,
    this.lastError,
    required this.createdAt,
    this.nextAttemptAt,
  });

  Map<String, Object?> toRow() => {
        'id': id,
        'idempotency_key': idempotencyKey,
        'kind': kind.name,
        'payload': jsonEncode(payload),
        'attempts': attempts,
        'last_error': lastError,
        'created_at': createdAt.toIso8601String(),
        'next_attempt_at': nextAttemptAt?.toIso8601String(),
      };

  static QueueItem fromRow(Map<String, Object?> r) => QueueItem(
        id: r['id'] as int?,
        idempotencyKey: r['idempotency_key'] as String,
        kind: QueueOpKind.values.firstWhere((k) => k.name == r['kind']),
        payload: (jsonDecode(r['payload'] as String) as Map).cast<String, dynamic>(),
        attempts: (r['attempts'] as int?) ?? 0,
        lastError: r['last_error'] as String?,
        createdAt: DateTime.parse(r['created_at'] as String),
        nextAttemptAt: r['next_attempt_at'] == null
            ? null
            : DateTime.parse(r['next_attempt_at'] as String),
      );
}

class MatbexOfflineQueue {
  MatbexOfflineQueue({
    required this.client,
    this.maxAttempts = 8,
    this.baseBackoff = const Duration(seconds: 2),
    this.maxBackoff = const Duration(minutes: 5),
    String? dbFilename,
    String? dbPath,
    Stream<dynamic>? connectivityStream,
  })  : _dbFilename = dbFilename ?? 'matbex_offline_queue.db',
        _dbPathOverride = dbPath,
        _connectivityStreamOverride = connectivityStream;

  final MatbexTerminalClient client;
  final int maxAttempts;
  final Duration baseBackoff;
  final Duration maxBackoff;

  final String _dbFilename;
  final String? _dbPathOverride;
  final Stream<dynamic>? _connectivityStreamOverride;
  static const _uuid = Uuid();
  static const _kTable = 'queue_items';

  Database? _db;
  StreamSubscription? _connSub;
  Timer? _retryTimer;
  bool _draining = false;
  bool _simulatedOffline = false;

  /// When true, [drain] becomes a no-op and reports [QueueStatus.offline],
  /// regardless of real network state. Newly enqueued items still persist
  /// to SQLite, so flipping this back to false replays them in order.
  /// Useful for QA: testing queue replay, idempotency, and conflict
  /// handling without toggling airplane mode on a physical device.
  bool get simulatedOffline => _simulatedOffline;

  void setSimulatedOffline(bool value) {
    if (_simulatedOffline == value) return;
    _simulatedOffline = value;
    if (value) {
      _retryTimer?.cancel();
      _statusCtrl.add(QueueStatus.offline);
    } else {
      // Coming back "online" - drain immediately.
      drain();
    }
  }

  final _statusCtrl = StreamController<QueueStatus>.broadcast();
  Stream<QueueStatus> get statusStream => _statusCtrl.stream;

  final _eventCtrl = StreamController<QueueItem>.broadcast();
  /// Emits whenever an item successfully syncs.
  Stream<QueueItem> get syncedStream => _eventCtrl.stream;

  // ----------------------- lifecycle -----------------------

  Future<void> init() async {
    final path = _dbPathOverride ??
        p.join((await getApplicationDocumentsDirectory()).path, _dbFilename);
    _db = await openDatabase(
      path,
      version: 1,
      onCreate: (db, _) async {
        await db.execute('''
          CREATE TABLE $_kTable (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            idempotency_key TEXT NOT NULL UNIQUE,
            kind TEXT NOT NULL,
            payload TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            created_at TEXT NOT NULL,
            next_attempt_at TEXT
          )
        ''');
        await db.execute(
            'CREATE INDEX idx_${_kTable}_next ON $_kTable(next_attempt_at, id)');
      },
    );
  }

  void start() {
    final stream =
        _connectivityStreamOverride ?? Connectivity().onConnectivityChanged;
    _connSub ??= stream.listen((_) {
      drain();
    });
    drain();
  }

  Future<void> dispose() async {
    await _connSub?.cancel();
    _retryTimer?.cancel();
    await _db?.close();
    await _statusCtrl.close();
    await _eventCtrl.close();
  }

  // ----------------------- enqueue API -----------------------

  /// Enqueue a sale. Returns the idempotency key - store it on your
  /// receipt/order row so you can correlate the eventual server id.
  Future<String> enqueueSale({
    required String shiftId,
    required String paymentMethod,
    required List<SaleItem> items,
    bool isUnpaid = false,
    String? customerId,
  }) {
    return _enqueue(QueueOpKind.sale, {
      'shift_id': shiftId,
      'payment_method': paymentMethod,
      'is_unpaid': isUnpaid,
      if (customerId != null) 'customer_id': customerId,
      'items': items.map((i) => i.toJson()).toList(),
    });
  }

  Future<String> enqueueVoidSale(String saleId, {String? reason}) {
    return _enqueue(QueueOpKind.voidSale, {
      'sale_id': saleId,
      if (reason != null) 'reason': reason,
    });
  }

  Future<String> enqueueCashEvent({
    required String shiftId,
    required String eventType,
    required num amount,
    String? description,
    String paymentMethod = 'cash',
  }) {
    return _enqueue(QueueOpKind.cashEvent, {
      'shift_id': shiftId,
      'event_type': eventType,
      'amount': amount,
      'payment_method': paymentMethod,
      if (description != null) 'description': description,
    });
  }

  Future<String> enqueueOpenShift({required num openingFloat, String? notes}) {
    return _enqueue(QueueOpKind.openShift, {
      'opening_float': openingFloat,
      if (notes != null) 'notes': notes,
    });
  }

  Future<String> enqueueCloseShift({
    required String shiftId,
    required num countedCash,
    num? countedCard,
    String? notes,
  }) {
    return _enqueue(QueueOpKind.closeShift, {
      'shift_id': shiftId,
      'counted_cash': countedCash,
      if (countedCard != null) 'counted_card': countedCard,
      if (notes != null) 'notes': notes,
    });
  }

  Future<String> enqueueSettlement({
    required String customerId,
    required num amount,
    required String paymentMethod,
    String? note,
  }) {
    return _enqueue(QueueOpKind.settlement, {
      'customer_id': customerId,
      'amount': amount,
      'payment_method': paymentMethod,
      if (note != null) 'note': note,
    });
  }

  Future<String> _enqueue(QueueOpKind kind, Map<String, dynamic> payload) async {
    _ensureDb();
    final key = _uuid.v4();
    final item = QueueItem(
      idempotencyKey: key,
      kind: kind,
      payload: payload,
      createdAt: DateTime.now().toUtc(),
    );
    await _db!.insert(_kTable, item.toRow()..remove('id'));
    // Try immediately - if offline this is a no-op.
    drain();
    return key;
  }

  // ----------------------- inspection -----------------------

  Future<int> pendingCount() async {
    _ensureDb();
    final r = await _db!.rawQuery('SELECT COUNT(*) AS c FROM $_kTable');
    return (r.first['c'] as int?) ?? 0;
  }

  Future<List<QueueItem>> pendingItems({int limit = 100}) async {
    _ensureDb();
    final rows = await _db!.query(_kTable, orderBy: 'id ASC', limit: limit);
    return rows.map(QueueItem.fromRow).toList();
  }

  // ----------------------- drain loop -----------------------

  Future<void> drain() async {
    if (_draining) return;
    if (_simulatedOffline) {
      _statusCtrl.add(QueueStatus.offline);
      return;
    }
    _draining = true;
    _retryTimer?.cancel();
    _statusCtrl.add(QueueStatus.syncing);
    try {
      while (true) {
        final next = await _nextDue();
        if (next == null) {
          _statusCtrl.add(QueueStatus.idle);
          return;
        }
        final ok = await _attempt(next);
        if (!ok) {
          // schedule next retry
          final delay = _backoffFor(next.attempts + 1);
          _retryTimer = Timer(delay, drain);
          _statusCtrl.add(QueueStatus.offline);
          return;
        }
      }
    } finally {
      _draining = false;
    }
  }

  Future<QueueItem?> _nextDue() async {
    _ensureDb();
    final nowIso = DateTime.now().toUtc().toIso8601String();
    final rows = await _db!.query(
      _kTable,
      where: 'next_attempt_at IS NULL OR next_attempt_at <= ?',
      whereArgs: [nowIso],
      orderBy: 'id ASC',
      limit: 1,
    );
    return rows.isEmpty ? null : QueueItem.fromRow(rows.first);
  }

  Future<bool> _attempt(QueueItem item) async {
    try {
      await _execute(item);
      await _db!.delete(_kTable, where: 'id = ?', whereArgs: [item.id]);
      _eventCtrl.add(item);
      return true;
    } on MatbexApiException catch (e) {
      // Permanent (4xx - but NOT auth/network) failures: drop with last_error
      // so the UI can surface them. Auth/network failures are retryable.
      final retryable = _isRetryable(e);
      final attempts = item.attempts + 1;
      if (!retryable || attempts >= maxAttempts) {
        await _db!.update(
          _kTable,
          {
            'attempts': attempts,
            'last_error': e.toString(),
            // Park the item far in the future so it doesn't burn retries,
            // but is still visible in pendingItems() for manual review.
            'next_attempt_at':
                DateTime.now().toUtc().add(const Duration(days: 365)).toIso8601String(),
          },
          where: 'id = ?',
          whereArgs: [item.id],
        );
        _statusCtrl.add(QueueStatus.failed);
        return true; // continue draining other items
      }
      await _db!.update(
        _kTable,
        {
          'attempts': attempts,
          'last_error': e.toString(),
          'next_attempt_at':
              DateTime.now().toUtc().add(_backoffFor(attempts)).toIso8601String(),
        },
        where: 'id = ?',
        whereArgs: [item.id],
      );
      return false;
    } catch (e) {
      // Unknown error - treat as retryable network blip
      final attempts = item.attempts + 1;
      await _db!.update(
        _kTable,
        {
          'attempts': attempts,
          'last_error': e.toString(),
          'next_attempt_at':
              DateTime.now().toUtc().add(_backoffFor(attempts)).toIso8601String(),
        },
        where: 'id = ?',
        whereArgs: [item.id],
      );
      return false;
    }
  }

  bool _isRetryable(MatbexApiException e) {
    // Network / 5xx / 408 / 429 / auth-not-yet-loaded -> retry
    if (e.status == null) return true;
    if (e.status! >= 500) return true;
    if (e.status == 408 || e.status == 429) return true;
    if (e.code == 'no_cashier' || e.code == 'network_error') return true;
    // 4xx with a real server error code -> not retryable (e.g. validation,
    // terminal_revoked, fiscal period locked). Park it for manual review.
    return false;
  }

  Duration _backoffFor(int attempt) {
    final ms = baseBackoff.inMilliseconds * (1 << (attempt - 1).clamp(0, 10));
    return Duration(milliseconds: ms.clamp(0, maxBackoff.inMilliseconds));
  }

  Future<void> _execute(QueueItem item) async {
    final key = item.idempotencyKey;
    final p = item.payload;
    switch (item.kind) {
      case QueueOpKind.sale:
        await client.recordSale(
          shiftId: p['shift_id'] as String,
          paymentMethod: p['payment_method'] as String,
          isUnpaid: (p['is_unpaid'] as bool?) ?? false,
          customerId: p['customer_id'] as String?,
          items: ((p['items'] as List).cast<Map>())
              .map((m) => SaleItem(
                    menuItemId: m['menu_item_id'] as String,
                    quantity: m['quantity'] as num,
                    unitPrice: m['unit_price'] as num,
                    variant: m['variant'] as String?,
                  ))
              .toList(),
          idempotencyKey: key,
        );
        break;
      case QueueOpKind.voidSale:
        // voidSale doesn't currently take an idempotency key arg in the
        // hand-written client; rely on server-side de-dup of the sale id.
        await client.voidSale(p['sale_id'] as String, reason: p['reason'] as String?);
        break;
      case QueueOpKind.cashEvent:
        await client.cashEvent(
          shiftId: p['shift_id'] as String,
          eventType: p['event_type'] as String,
          amount: p['amount'] as num,
          description: p['description'] as String?,
          paymentMethod: (p['payment_method'] as String?) ?? 'cash',
        );
        break;
      case QueueOpKind.openShift:
        await client.openShift(
            openingFloat: p['opening_float'] as num, notes: p['notes'] as String?);
        break;
      case QueueOpKind.closeShift:
        await client.closeShift(
          shiftId: p['shift_id'] as String,
          countedCash: p['counted_cash'] as num,
          countedCard: p['counted_card'] as num?,
          notes: p['notes'] as String?,
        );
        break;
      case QueueOpKind.settlement:
        await client.recordSettlement(
          customerId: p['customer_id'] as String,
          amount: p['amount'] as num,
          paymentMethod: p['payment_method'] as String,
          note: p['note'] as String?,
        );
        break;
    }
  }

  void _ensureDb() {
    if (_db == null) {
      throw StateError('MatbexOfflineQueue.init() must be called before use.');
    }
  }
}
