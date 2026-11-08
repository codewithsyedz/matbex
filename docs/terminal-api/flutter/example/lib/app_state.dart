import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import 'api/matbex_terminal_client.dart';
import 'api/matbex_offline_queue.dart';

class CartLine {
  final String menuItemId;
  final String name;
  final num unitPrice;
  int quantity;
  CartLine({
    required this.menuItemId,
    required this.name,
    required this.unitPrice,
    this.quantity = 1,
  });
  num get total => unitPrice * quantity;
}

class AppState extends ChangeNotifier {
  AppState({required this.client, required this.queue});

  final MatbexTerminalClient client;
  final MatbexOfflineQueue queue;

  // Shift
  Map<String, dynamic>? currentShift;
  String? get shiftId => currentShift?['id'] as String?;

  // Menu
  List<Map<String, dynamic>> menu = const [];

  // Cart
  final List<CartLine> cart = [];

  num get cartTotal => cart.fold<num>(0, (s, l) => s + l.total);

  void addToCart(Map<String, dynamic> item) {
    final id = item['id'] as String;
    final existing = cart.where((l) => l.menuItemId == id).toList();
    if (existing.isNotEmpty) {
      existing.first.quantity += 1;
    } else {
      cart.add(CartLine(
        menuItemId: id,
        name: (item['name'] as String?) ?? 'Item',
        unitPrice: (item['price'] as num?) ?? 0,
      ));
    }
    notifyListeners();
  }

  void removeLine(CartLine line) {
    cart.remove(line);
    notifyListeners();
  }

  void clearCart() {
    cart.clear();
    notifyListeners();
  }

  Future<void> refreshShift() async {
    currentShift = await client.currentShift();
    notifyListeners();
  }

  Future<void> refreshMenu() async {
    final raw = await client.getMenu();
    menu = raw.cast<Map>().map((m) => m.cast<String, dynamic>()).toList();
    notifyListeners();
  }
}

class AppStateScope extends InheritedNotifier<AppState> {
  const AppStateScope({super.key, required AppState state, required super.child})
      : super(notifier: state);

  static AppState of(BuildContext context) {
    final scope =
        context.dependOnInheritedWidgetOfExactType<AppStateScope>();
    assert(scope != null, 'AppStateScope missing in tree');
    return scope!.notifier!;
  }
}
