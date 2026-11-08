// =====================================================================
// Matbex Terminal API - typed Dart models
// ---------------------------------------------------------------------
// Hand-written, dependency-free (`dart:core` only) value types generated
// from `docs/terminal-api/matbex-terminal-api.openapi.yaml`. Every model
// has a `fromJson` factory and a `toJson()` that produces exactly the
// shape the edge function expects (snake_case keys, nullable fields
// omitted).
//
// These models are intentionally separate from `MatbexTerminalClient` so
// you can:
//   * use them stand-alone for local persistence / printing
//   * unit-test JSON shape without spinning up Dio
//   * swap the transport later without touching domain code
// =====================================================================

// ---------- enums ----------

enum PaymentMethod { cash, card, transfer, customerCredit }

extension PaymentMethodX on PaymentMethod {
  String get wire => switch (this) {
        PaymentMethod.cash => 'cash',
        PaymentMethod.card => 'card',
        PaymentMethod.transfer => 'transfer',
        PaymentMethod.customerCredit => 'customer_credit',
      };

  static PaymentMethod fromWire(String s) => switch (s) {
        'cash' => PaymentMethod.cash,
        'card' => PaymentMethod.card,
        'transfer' => PaymentMethod.transfer,
        'customer_credit' => PaymentMethod.customerCredit,
        _ => throw ArgumentError('Unknown payment_method: $s'),
      };
}

/// Subset of [PaymentMethod] accepted by /settlements (no customer_credit).
enum SettlementPaymentMethod { cash, card, transfer }

extension SettlementPaymentMethodX on SettlementPaymentMethod {
  String get wire => switch (this) {
        SettlementPaymentMethod.cash => 'cash',
        SettlementPaymentMethod.card => 'card',
        SettlementPaymentMethod.transfer => 'transfer',
      };

  static SettlementPaymentMethod fromWire(String s) => switch (s) {
        'cash' => SettlementPaymentMethod.cash,
        'card' => SettlementPaymentMethod.card,
        'transfer' => SettlementPaymentMethod.transfer,
        _ => throw ArgumentError('Unknown settlement payment_method: $s'),
      };
}

enum CashEventPaymentMethod { cash, card }

extension CashEventPaymentMethodX on CashEventPaymentMethod {
  String get wire => name; // 'cash' | 'card'
  static CashEventPaymentMethod fromWire(String s) =>
      s == 'card' ? CashEventPaymentMethod.card : CashEventPaymentMethod.cash;
}

enum CashEventType { drop, payout, payIn, open, close }

extension CashEventTypeX on CashEventType {
  String get wire => switch (this) {
        CashEventType.drop => 'drop',
        CashEventType.payout => 'payout',
        CashEventType.payIn => 'pay-in',
        CashEventType.open => 'open',
        CashEventType.close => 'close',
      };

  static CashEventType fromWire(String s) => switch (s) {
        'drop' => CashEventType.drop,
        'payout' => CashEventType.payout,
        'pay-in' => CashEventType.payIn,
        'open' => CashEventType.open,
        'close' => CashEventType.close,
        _ => throw ArgumentError('Unknown cash event_type: $s'),
      };
}

enum DevicePlatform { android, ios, web }

extension DevicePlatformX on DevicePlatform {
  String get wire => name;
  static DevicePlatform fromWire(String s) => switch (s) {
        'android' => DevicePlatform.android,
        'ios' => DevicePlatform.ios,
        _ => DevicePlatform.web,
      };
}

// ---------- helpers ----------

num _num(dynamic v, {num fallback = 0}) {
  if (v is num) return v;
  if (v is String) return num.tryParse(v) ?? fallback;
  return fallback;
}

String? _str(dynamic v) => v == null ? null : v.toString();

// ---------- requests ----------

class PairRequest {
  final String code;
  final String? name;
  final DevicePlatform? platform;
  final String? appVersion;
  const PairRequest({
    required this.code,
    this.name,
    this.platform,
    this.appVersion,
  });
  Map<String, dynamic> toJson() => {
        'code': code,
        if (name != null) 'name': name,
        if (platform != null) 'platform': platform!.wire,
        if (appVersion != null) 'app_version': appVersion,
      };
}

class PairResponseData {
  final String terminalId;
  final String restaurantId;
  final String name;
  final String deviceKey;
  const PairResponseData({
    required this.terminalId,
    required this.restaurantId,
    required this.name,
    required this.deviceKey,
  });
  factory PairResponseData.fromJson(Map<String, dynamic> j) => PairResponseData(
        terminalId: j['terminal_id'] as String,
        restaurantId: j['restaurant_id'] as String,
        name: (j['name'] as String?) ?? 'Terminal',
        deviceKey: j['device_key'] as String,
      );
}

class SaleItemModel {
  final String menuItemId;
  final num quantity;
  final num unitPrice;
  final String? variant;
  const SaleItemModel({
    required this.menuItemId,
    required this.quantity,
    required this.unitPrice,
    this.variant,
  });
  factory SaleItemModel.fromJson(Map<String, dynamic> j) => SaleItemModel(
        menuItemId: j['menu_item_id'] as String,
        quantity: _num(j['quantity']),
        unitPrice: _num(j['unit_price']),
        variant: _str(j['variant']),
      );
  Map<String, dynamic> toJson() => {
        'menu_item_id': menuItemId,
        'quantity': quantity,
        'unit_price': unitPrice,
        if (variant != null) 'variant': variant,
      };
  num get lineTotal => quantity * unitPrice;
}

class SaleRequest {
  final String shiftId;
  final PaymentMethod paymentMethod;
  final bool isUnpaid;
  final String? customerId;
  final List<SaleItemModel> items;
  const SaleRequest({
    required this.shiftId,
    required this.paymentMethod,
    required this.items,
    this.isUnpaid = false,
    this.customerId,
  });
  Map<String, dynamic> toJson() => {
        'shift_id': shiftId,
        'payment_method': paymentMethod.wire,
        'is_unpaid': isUnpaid,
        if (customerId != null) 'customer_id': customerId,
        'items': items.map((i) => i.toJson()).toList(),
      };
  num get total => items.fold<num>(0, (s, i) => s + i.lineTotal);
}

class SaleResponseData {
  final String saleId;
  final num total;
  final String receiptNumber;
  const SaleResponseData({
    required this.saleId,
    required this.total,
    required this.receiptNumber,
  });
  factory SaleResponseData.fromJson(Map<String, dynamic> j) {
    final sale = (j['sale'] as Map?)?.cast<String, dynamic>() ?? const {};
    return SaleResponseData(
      saleId: (sale['id'] as String?) ?? (j['id'] as String? ?? ''),
      total: _num(sale['total'] ?? j['total']),
      receiptNumber: (sale['receipt_number'] ??
              j['receipt_number'] ??
              '')
          .toString(),
    );
  }
}

class OpenShiftRequest {
  final num openingFloat;
  final String? notes;
  const OpenShiftRequest({required this.openingFloat, this.notes});
  Map<String, dynamic> toJson() => {
        'opening_float': openingFloat,
        if (notes != null) 'notes': notes,
      };
}

class CloseShiftRequest {
  final String shiftId;
  final num countedCash;
  final num? countedCard;
  final String? notes;
  const CloseShiftRequest({
    required this.shiftId,
    required this.countedCash,
    this.countedCard,
    this.notes,
  });
  Map<String, dynamic> toJson() => {
        'shift_id': shiftId,
        'counted_cash': countedCash,
        if (countedCard != null) 'counted_card': countedCard,
        if (notes != null) 'notes': notes,
      };
}

class CashEventRequest {
  final String shiftId;
  final CashEventType eventType;
  final num amount;
  final String? description;
  final CashEventPaymentMethod paymentMethod;
  const CashEventRequest({
    required this.shiftId,
    required this.eventType,
    required this.amount,
    this.description,
    this.paymentMethod = CashEventPaymentMethod.cash,
  });
  Map<String, dynamic> toJson() => {
        'shift_id': shiftId,
        'event_type': eventType.wire,
        'amount': amount,
        'payment_method': paymentMethod.wire,
        if (description != null) 'description': description,
      };
}

class SettlementRequest {
  final String customerId;
  final num amount;
  final SettlementPaymentMethod paymentMethod;
  final String? note;
  const SettlementRequest({
    required this.customerId,
    required this.amount,
    required this.paymentMethod,
    this.note,
  });
  Map<String, dynamic> toJson() => {
        'customer_id': customerId,
        'amount': amount,
        'payment_method': paymentMethod.wire,
        if (note != null) 'note': note,
      };
}

class VoidRequest {
  final String? reason;
  const VoidRequest({this.reason});
  Map<String, dynamic> toJson() =>
      {if (reason != null) 'reason': reason};
}

// ---------- responses / read models ----------

/// Tolerant menu item model - server returns the row as-is from the
/// `menu_items` table. We keep a permissive map but expose typed
/// accessors for the fields the POS actually needs.
class MenuItem {
  final String id;
  final String name;
  final num price;
  final String? category;
  final String? imageUrl;
  final bool active;
  /// Optional half / quarter prices when present on the row.
  final num? halfPrice;
  final num? quarterPrice;
  final Map<String, dynamic> raw;

  const MenuItem({
    required this.id,
    required this.name,
    required this.price,
    this.category,
    this.imageUrl,
    this.active = true,
    this.halfPrice,
    this.quarterPrice,
    this.raw = const {},
  });

  factory MenuItem.fromJson(Map<String, dynamic> j) => MenuItem(
        id: j['id'] as String,
        name: (j['name'] as String?) ?? 'Item',
        price: _num(j['price'] ?? j['full_price']),
        category: _str(j['category'] ?? j['category_name']),
        imageUrl: _str(j['image_url']),
        active: (j['active'] as bool?) ?? (j['is_active'] as bool?) ?? true,
        halfPrice: j['half_price'] == null ? null : _num(j['half_price']),
        quarterPrice:
            j['quarter_price'] == null ? null : _num(j['quarter_price']),
        raw: j,
      );

  /// Resolve the unit price for a [variant] string (`'half'`, `'quarter'`,
  /// or null/`'full'`). Falls back to [price] when the variant is absent.
  num priceFor(String? variant) {
    switch (variant) {
      case 'half':
        return halfPrice ?? price;
      case 'quarter':
        return quarterPrice ?? price;
      default:
        return price;
    }
  }
}

class Customer {
  final String id;
  final String name;
  final String? phone;
  final num? balance;
  final Map<String, dynamic> raw;
  const Customer({
    required this.id,
    required this.name,
    this.phone,
    this.balance,
    this.raw = const {},
  });
  factory Customer.fromJson(Map<String, dynamic> j) => Customer(
        id: j['id'] as String,
        name: (j['name'] as String?) ?? '',
        phone: _str(j['phone']),
        balance: j['balance'] == null ? null : _num(j['balance']),
        raw: j,
      );
}

class Shift {
  final String id;
  final num openingFloat;
  final DateTime? openedAt;
  final DateTime? closedAt;
  final String status; // open | closed
  final Map<String, dynamic> raw;
  const Shift({
    required this.id,
    required this.openingFloat,
    this.openedAt,
    this.closedAt,
    this.status = 'open',
    this.raw = const {},
  });
  factory Shift.fromJson(Map<String, dynamic> j) => Shift(
        id: j['id'] as String,
        openingFloat: _num(j['opening_float']),
        openedAt: DateTime.tryParse((j['opened_at'] ?? '').toString()),
        closedAt: DateTime.tryParse((j['closed_at'] ?? '').toString()),
        status: (j['status'] as String?) ?? 'open',
        raw: j,
      );
  bool get isOpen => closedAt == null && status == 'open';
}

class SaleRecord {
  final String id;
  final String? receiptNumber;
  final num total;
  final PaymentMethod paymentMethod;
  final bool isUnpaid;
  final DateTime? createdAt;
  final Map<String, dynamic> raw;
  const SaleRecord({
    required this.id,
    required this.total,
    required this.paymentMethod,
    this.receiptNumber,
    this.isUnpaid = false,
    this.createdAt,
    this.raw = const {},
  });
  factory SaleRecord.fromJson(Map<String, dynamic> j) => SaleRecord(
        id: j['id'] as String,
        receiptNumber: _str(j['receipt_number']),
        total: _num(j['total']),
        paymentMethod: PaymentMethodX.fromWire(
            (j['payment_method'] as String?) ?? 'cash'),
        isUnpaid: (j['is_unpaid'] as bool?) ?? false,
        createdAt: DateTime.tryParse((j['created_at'] ?? '').toString()),
        raw: j,
      );
}

/// Standard error envelope returned by the edge function.
class ApiErrorBody {
  final String code;
  final String message;
  const ApiErrorBody({required this.code, required this.message});
  factory ApiErrorBody.fromJson(Map<String, dynamic> j) {
    final err = (j['error'] as Map?)?.cast<String, dynamic>() ?? const {};
    return ApiErrorBody(
      code: (err['code'] ?? 'unknown').toString(),
      message: (err['message'] ?? '').toString(),
    );
  }
}