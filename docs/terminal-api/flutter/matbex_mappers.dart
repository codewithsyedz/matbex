// =====================================================================
// Matbex Terminal API - domain → wire mappers
// ---------------------------------------------------------------------
// Bridges your in-app domain objects (cart lines, raw menu rows,
// settlement intents) to the typed request models in `matbex_models.dart`.
//
// Keeping this in one place means UI code never composes JSON by hand
// and the OpenAPI contract has a single Dart-side seam to update when
// the backend evolves.
// =====================================================================

import 'matbex_models.dart';
import 'matbex_terminal_client.dart' show SaleItem;

// ---------- read-side parsers ----------

/// Parse the `/menu` response into typed [MenuItem]s. Inactive rows are
/// filtered out so UIs do not need to guard against them.
List<MenuItem> parseMenu(List<dynamic> raw) => raw
    .whereType<Map>()
    .map((m) => MenuItem.fromJson(m.cast<String, dynamic>()))
    .where((m) => m.active)
    .toList(growable: false);

/// Parse the `/customers` search response.
List<Customer> parseCustomers(List<dynamic> raw) => raw
    .whereType<Map>()
    .map((m) => Customer.fromJson(m.cast<String, dynamic>()))
    .toList(growable: false);

/// Parse `/sales/today`.
List<SaleRecord> parseSalesToday(List<dynamic> raw) => raw
    .whereType<Map>()
    .map((m) => SaleRecord.fromJson(m.cast<String, dynamic>()))
    .toList(growable: false);

/// Parse `/shifts/current` - may be null when no shift is open.
Shift? parseCurrentShift(Map<String, dynamic>? raw) =>
    raw == null ? null : Shift.fromJson(raw);

// ---------- cart → sale ----------

/// A cart line as the UI tracks it. Generic enough to map any of the
/// local cart implementations (the example app's `CartLine`, your own
/// state-management layer, etc.).
class CartLineSpec {
  final String menuItemId;
  final num quantity;
  final num unitPrice;
  final String? variant;
  const CartLineSpec({
    required this.menuItemId,
    required this.quantity,
    required this.unitPrice,
    this.variant,
  });
}

/// Build a single typed [SaleItemModel] from a [MenuItem] + qty (+ variant).
SaleItemModel saleItemFromMenu(
  MenuItem item, {
  num quantity = 1,
  String? variant,
}) =>
    SaleItemModel(
      menuItemId: item.id,
      quantity: quantity,
      unitPrice: item.priceFor(variant),
      variant: variant,
    );

/// Convert any cart-line spec into the wire [SaleItemModel].
SaleItemModel saleItemFromCart(CartLineSpec line) => SaleItemModel(
      menuItemId: line.menuItemId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      variant: line.variant,
    );

/// Build a complete [SaleRequest] from a cart.
///
/// Throws [ArgumentError] when the cart is empty or the credit/customer
/// invariants are violated (`customer_credit` / `is_unpaid` require a
/// `customerId`).
SaleRequest buildSaleRequest({
  required String shiftId,
  required PaymentMethod paymentMethod,
  required Iterable<CartLineSpec> cart,
  bool isUnpaid = false,
  String? customerId,
}) {
  final items = cart.map(saleItemFromCart).toList(growable: false);
  if (items.isEmpty) {
    throw ArgumentError('Cannot build a SaleRequest from an empty cart.');
  }
  final needsCustomer =
      paymentMethod == PaymentMethod.customerCredit || isUnpaid;
  if (needsCustomer && (customerId == null || customerId.isEmpty)) {
    throw ArgumentError(
        'customer_credit / is_unpaid sales require a customerId.');
  }
  return SaleRequest(
    shiftId: shiftId,
    paymentMethod: paymentMethod,
    items: items,
    isUnpaid: isUnpaid,
    customerId: customerId,
  );
}

/// Bridge to the legacy [SaleItem] used by [MatbexTerminalClient.recordSale].
/// Lets you keep using the typed pipeline while the client signature
/// remains positional / loose.
List<SaleItem> toClientSaleItems(Iterable<SaleItemModel> items) => items
    .map((i) => SaleItem(
          menuItemId: i.menuItemId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          variant: i.variant,
        ))
    .toList(growable: false);

// ---------- shifts ----------

OpenShiftRequest buildOpenShift({required num openingFloat, String? notes}) =>
    OpenShiftRequest(openingFloat: openingFloat, notes: notes);

CloseShiftRequest buildCloseShift({
  required String shiftId,
  required num countedCash,
  num? countedCard,
  String? notes,
}) =>
    CloseShiftRequest(
      shiftId: shiftId,
      countedCash: countedCash,
      countedCard: countedCard,
      notes: notes,
    );

CashEventRequest buildCashEvent({
  required String shiftId,
  required CashEventType type,
  required num amount,
  String? description,
  CashEventPaymentMethod method = CashEventPaymentMethod.cash,
}) =>
    CashEventRequest(
      shiftId: shiftId,
      eventType: type,
      amount: amount,
      description: description,
      paymentMethod: method,
    );

// ---------- settlements ----------

/// Build a [SettlementRequest] from a customer payment intent.
/// `amount` must be > 0; the API rejects zero / negative settlements.
SettlementRequest buildSettlement({
  required String customerId,
  required num amount,
  required SettlementPaymentMethod paymentMethod,
  String? note,
}) {
  if (amount <= 0) {
    throw ArgumentError('Settlement amount must be greater than zero.');
  }
  return SettlementRequest(
    customerId: customerId,
    amount: amount,
    paymentMethod: paymentMethod,
    note: note,
  );
}

/// Convenience: settle the customer's full outstanding balance.
SettlementRequest buildFullSettlement({
  required Customer customer,
  required SettlementPaymentMethod paymentMethod,
  String? note,
}) {
  final amount = customer.balance ?? 0;
  return buildSettlement(
    customerId: customer.id,
    amount: amount,
    paymentMethod: paymentMethod,
    note: note ?? 'Full settlement',
  );
}
