// =====================================================================
// Matbex Terminal API - Flutter client (Android + iOS)
// ---------------------------------------------------------------------
// Hand-written, dependency-light client for the `terminal-api` edge
// function. Works on both platforms from a single Flutter codebase.
//
// pubspec.yaml:
//   dio: ^5.4.0
//   uuid: ^4.0.0
//   flutter_secure_storage: ^9.0.0
//
// Usage:
//   final client = MatbexTerminalClient(baseUrl: '...');
//   await client.loadDeviceKey();
//   client.setCashierJwt(supabase.auth.currentSession!.accessToken);
//   await client.pair(code: '482915', name: 'Counter 1');
//   final sale = await client.recordSale(...);
// =====================================================================

import 'dart:io' show Platform;
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

class MatbexApiException implements Exception {
  final int? status;
  final String code;
  final String message;
  MatbexApiException(this.status, this.code, this.message);
  @override
  String toString() => 'MatbexApiException($status $code): $message';
}

class SaleItem {
  final String menuItemId;
  final num quantity;
  final num unitPrice;
  final String? variant;
  SaleItem({
    required this.menuItemId,
    required this.quantity,
    required this.unitPrice,
    this.variant,
  });
  Map<String, dynamic> toJson() => {
        'menu_item_id': menuItemId,
        'quantity': quantity,
        'unit_price': unitPrice,
        if (variant != null) 'variant': variant,
      };
}

class MatbexTerminalClient {
  MatbexTerminalClient({
    required this.baseUrl,
    String appVersion = '1.0.0',
    Dio? dio,
    FlutterSecureStorage? storage,
  })  : _appVersion = appVersion,
        _storage = storage ?? const FlutterSecureStorage(),
        _dio = dio ??
            Dio(BaseOptions(
              connectTimeout: const Duration(seconds: 15),
              receiveTimeout: const Duration(seconds: 30),
            ));

  static const _kDeviceKeyStorage = 'matbex.terminal.device_key';
  static const _uuid = Uuid();

  final String baseUrl;
  final String _appVersion;
  final Dio _dio;
  final FlutterSecureStorage _storage;

  String? _deviceKey;
  String? _cashierJwt;

  // -------------------- credentials --------------------

  Future<void> loadDeviceKey() async {
    _deviceKey = await _storage.read(key: _kDeviceKeyStorage);
  }

  Future<void> _saveDeviceKey(String key) async {
    _deviceKey = key;
    await _storage.write(key: _kDeviceKeyStorage, value: key);
  }

  Future<void> clearDeviceKey() async {
    _deviceKey = null;
    await _storage.delete(key: _kDeviceKeyStorage);
  }

  void setCashierJwt(String? jwt) => _cashierJwt = jwt;

  bool get isPaired => _deviceKey != null;

  // -------------------- HTTP --------------------

  String get _platform => Platform.isIOS ? 'ios' : (Platform.isAndroid ? 'android' : 'other');

  Map<String, String> _headers({bool authed = true, bool write = false}) {
    final h = <String, String>{
      'Accept': 'application/json',
      'X-App-Version': _appVersion,
      'X-Platform': _platform,
    };
    if (authed) {
      if (_deviceKey == null) {
        throw MatbexApiException(null, 'not_paired', 'Device is not paired. Call pair() first.');
      }
      if (_cashierJwt == null) {
        throw MatbexApiException(null, 'no_cashier', 'No cashier JWT set. Call setCashierJwt().');
      }
      h['X-Terminal-Key'] = _deviceKey!;
      h['Authorization'] = 'Bearer $_cashierJwt';
    }
    if (write) {
      h['Content-Type'] = 'application/json';
      h['Idempotency-Key'] = _uuid.v4();
    }
    return h;
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Object? body,
    Map<String, dynamic>? query,
    bool authed = true,
    String? idempotencyKey,
  }) async {
    final headers = _headers(authed: authed, write: body != null);
    if (idempotencyKey != null) headers['Idempotency-Key'] = idempotencyKey;

    try {
      final res = await _dio.request<Map<String, dynamic>>(
        '$baseUrl$path',
        data: body,
        queryParameters: query,
        options: Options(method: method, headers: headers, responseType: ResponseType.json),
      );
      return res.data ?? const {};
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      final data = e.response?.data;
      if (data is Map && data['error'] is Map) {
        final err = data['error'] as Map;
        throw MatbexApiException(status, '${err['code']}', '${err['message']}');
      }
      throw MatbexApiException(status, 'network_error', e.message ?? 'Request failed');
    }
  }

  // -------------------- endpoints --------------------

  /// One-time device pairing. Persists the returned device_key in secure storage.
  Future<Map<String, dynamic>> pair({
    required String code,
    String? name,
  }) async {
    final res = await _request('POST', '/pair',
        authed: false,
        body: {
          'code': code,
          'name': name ?? 'Terminal',
          'platform': _platform,
          'app_version': _appVersion,
        });
    final data = (res['data'] as Map).cast<String, dynamic>();
    await _saveDeviceKey(data['device_key'] as String);
    return data;
  }

  Future<void> heartbeat() => _request('GET', '/health').then((_) {});

  Future<List<dynamic>> getMenu() async {
    final r = await _request('GET', '/menu');
    return (r['data'] as List?) ?? const [];
  }

  Future<List<dynamic>> searchCustomers(String q) async {
    final r = await _request('GET', '/customers', query: {'q': q});
    return (r['data'] as List?) ?? const [];
  }

  Future<Map<String, dynamic>?> currentShift() async {
    final r = await _request('GET', '/shifts/current');
    return r['data'] as Map<String, dynamic>?;
  }

  Future<Map<String, dynamic>> openShift({required num openingFloat, String? notes}) async {
    final r = await _request('POST', '/shifts/open',
        body: {'opening_float': openingFloat, if (notes != null) 'notes': notes});
    return (r['data'] as Map).cast<String, dynamic>();
  }

  Future<Map<String, dynamic>> closeShift({
    required String shiftId,
    required num countedCash,
    num? countedCard,
    String? notes,
  }) async {
    final r = await _request('POST', '/shifts/close', body: {
      'shift_id': shiftId,
      'counted_cash': countedCash,
      if (countedCard != null) 'counted_card': countedCard,
      if (notes != null) 'notes': notes,
    });
    return (r['data'] as Map).cast<String, dynamic>();
  }

  Future<Map<String, dynamic>> cashEvent({
    required String shiftId,
    required String eventType, // drop | payout | pay-in | open | close
    required num amount,
    String? description,
    String paymentMethod = 'cash',
  }) async {
    final r = await _request('POST', '/shifts/cash-event', body: {
      'shift_id': shiftId,
      'event_type': eventType,
      'amount': amount,
      'payment_method': paymentMethod,
      if (description != null) 'description': description,
    });
    return (r['data'] as Map).cast<String, dynamic>();
  }

  /// Record a sale. Pass [idempotencyKey] explicitly to safely retry the same
  /// sale across network failures (re-use the same UUID until you get a
  /// non-network response).
  Future<Map<String, dynamic>> recordSale({
    required String shiftId,
    required String paymentMethod,
    required List<SaleItem> items,
    bool isUnpaid = false,
    String? customerId,
    String? idempotencyKey,
  }) async {
    final r = await _request('POST', '/sales',
        idempotencyKey: idempotencyKey,
        body: {
          'shift_id': shiftId,
          'payment_method': paymentMethod,
          'is_unpaid': isUnpaid,
          if (customerId != null) 'customer_id': customerId,
          'items': items.map((i) => i.toJson()).toList(),
        });
    return (r['data'] as Map).cast<String, dynamic>();
  }

  Future<void> voidSale(String saleId, {String? reason}) =>
      _request('POST', '/sales/$saleId/void',
          body: {if (reason != null) 'reason': reason}).then((_) {});

  Future<List<dynamic>> salesToday() async {
    final r = await _request('GET', '/sales/today');
    return (r['data'] as List?) ?? const [];
  }

  Future<Map<String, dynamic>> recordSettlement({
    required String customerId,
    required num amount,
    required String paymentMethod,
    String? note,
  }) async {
    final r = await _request('POST', '/settlements', body: {
      'customer_id': customerId,
      'amount': amount,
      'payment_method': paymentMethod,
      if (note != null) 'note': note,
    });
    return (r['data'] as Map).cast<String, dynamic>();
  }
}
