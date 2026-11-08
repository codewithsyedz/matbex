// Test helpers: a recording Dio adapter and a mock secure storage.
//
// The recording adapter lets us assert headers, paths, and bodies on every
// request the MatbexTerminalClient sends, and queue scripted responses for
// the offline-queue retry tests.

import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

class RecordedRequest {
  final String method;
  final Uri uri;
  final Map<String, dynamic> headers;
  final dynamic body;
  RecordedRequest(this.method, this.uri, this.headers, this.body);

  String get path => uri.path;
  String? header(String key) {
    final v = headers[key] ?? headers[key.toLowerCase()];
    if (v is List) return v.isEmpty ? null : v.first.toString();
    return v?.toString();
  }
}

/// Scripted reply the adapter will return for the next matching request.
class _Reply {
  final int status;
  final dynamic body;
  final Object? throwError;
  _Reply({this.status = 200, this.body, this.throwError});
}

class RecordingAdapter implements HttpClientAdapter {
  final List<RecordedRequest> requests = [];
  final List<_Reply> _queue = [];

  /// Default reply when no scripted reply is available.
  _Reply defaultReply = _Reply(status: 200, body: {'data': {}});

  void enqueueOk({Map<String, dynamic>? body}) =>
      _queue.add(_Reply(status: 200, body: body ?? {'data': {}}));

  void enqueueStatus(int status, {Object? body}) =>
      _queue.add(_Reply(status: status, body: body ?? {'error': {'code': 'x', 'message': 'x'}}));

  void enqueueNetworkError() =>
      _queue.add(_Reply(throwError: DioException.connectionError(
        requestOptions: RequestOptions(path: ''),
        reason: 'connection failed',
      )));

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future? cancelFuture,
  ) async {
    dynamic body;
    if (requestStream != null) {
      final chunks = <int>[];
      await for (final c in requestStream) {
        chunks.addAll(c);
      }
      if (chunks.isNotEmpty) {
        try {
          body = jsonDecode(utf8.decode(chunks));
        } catch (_) {
          body = utf8.decode(chunks);
        }
      }
    }
    requests.add(RecordedRequest(
      options.method,
      options.uri,
      Map<String, dynamic>.from(options.headers),
      body,
    ));

    final reply = _queue.isNotEmpty ? _queue.removeAt(0) : defaultReply;
    if (reply.throwError != null) throw reply.throwError!;

    final encoded = utf8.encode(jsonEncode(reply.body ?? {}));
    return ResponseBody.fromBytes(
      encoded,
      reply.status,
      headers: {
        Headers.contentTypeHeader: ['application/json; charset=utf-8'],
      },
    );
  }
}

/// Mocks the flutter_secure_storage platform channel so the client can
/// read/write the device_key without touching the real Keychain / EncryptedSharedPreferences.
class FakeSecureStorage {
  final Map<String, String> store = {};

  void install() {
    const channel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      final args = (call.arguments as Map?)?.cast<String, dynamic>() ?? const {};
      final key = args['key'] as String?;
      switch (call.method) {
        case 'read':
          return store[key];
        case 'write':
          store[key!] = args['value'] as String;
          return null;
        case 'delete':
          store.remove(key);
          return null;
        case 'readAll':
          return Map<String, String>.from(store);
        case 'deleteAll':
          store.clear();
          return null;
        case 'containsKey':
          return store.containsKey(key);
      }
      return null;
    });
  }

  void uninstall() {
    const channel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  }
}
