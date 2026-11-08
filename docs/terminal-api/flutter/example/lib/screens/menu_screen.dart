import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../app_state.dart';
import '../api/matbex_terminal_client.dart';

class MenuScreen extends StatefulWidget {
  const MenuScreen({super.key});
  @override
  State<MenuScreen> createState() => _MenuScreenState();
}

class _MenuScreenState extends State<MenuScreen> {
  String _payment = 'cash';
  bool _busy = false;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final state = AppStateScope.of(context);
    try {
      await state.refreshMenu();
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = AppStateScope.of(context);
    final money = NumberFormat.currency(symbol: '﷼ ', decimalDigits: 2);

    return AnimatedBuilder(
      animation: state,
      builder: (_, __) {
        return Scaffold(
          appBar: AppBar(title: const Text('Menu')),
          body: _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
                  ? Center(child: Text(_error!))
                  : Row(
                      children: [
                        Expanded(
                          flex: 3,
                          child: GridView.builder(
                            padding: const EdgeInsets.all(12),
                            gridDelegate:
                                const SliverGridDelegateWithMaxCrossAxisExtent(
                              maxCrossAxisExtent: 180,
                              mainAxisSpacing: 8,
                              crossAxisSpacing: 8,
                              childAspectRatio: 1,
                            ),
                            itemCount: state.menu.length,
                            itemBuilder: (_, i) {
                              final item = state.menu[i];
                              return InkWell(
                                onTap: () => state.addToCart(item),
                                child: Card(
                                  child: Padding(
                                    padding: const EdgeInsets.all(8),
                                    child: Column(
                                      mainAxisAlignment:
                                          MainAxisAlignment.spaceBetween,
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          (item['name'] as String?) ?? '—',
                                          maxLines: 2,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(
                                              fontWeight: FontWeight.w500),
                                        ),
                                        Text(money.format(
                                            (item['price'] as num?) ?? 0)),
                                      ],
                                    ),
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
                        const VerticalDivider(width: 1),
                        Expanded(
                          flex: 2,
                          child: Column(
                            children: [
                              Expanded(
                                child: ListView.separated(
                                  itemCount: state.cart.length,
                                  separatorBuilder: (_, __) =>
                                      const Divider(height: 1),
                                  itemBuilder: (_, i) {
                                    final l = state.cart[i];
                                    return ListTile(
                                      title: Text(l.name),
                                      subtitle:
                                          Text('${l.quantity} × ${money.format(l.unitPrice)}'),
                                      trailing: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          Text(money.format(l.total)),
                                          IconButton(
                                            icon: const Icon(Icons.close),
                                            onPressed: () => state.removeLine(l),
                                          ),
                                        ],
                                      ),
                                    );
                                  },
                                ),
                              ),
                              const Divider(height: 1),
                              Padding(
                                padding: const EdgeInsets.all(12),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.stretch,
                                  children: [
                                    Row(
                                      mainAxisAlignment:
                                          MainAxisAlignment.spaceBetween,
                                      children: [
                                        const Text('Total'),
                                        Text(money.format(state.cartTotal),
                                            style: const TextStyle(
                                                fontSize: 20,
                                                fontWeight: FontWeight.w600)),
                                      ],
                                    ),
                                    const SizedBox(height: 12),
                                    SegmentedButton<String>(
                                      segments: const [
                                        ButtonSegment(
                                            value: 'cash', label: Text('Cash')),
                                        ButtonSegment(
                                            value: 'card', label: Text('Card')),
                                        ButtonSegment(
                                            value: 'transfer',
                                            label: Text('Transfer')),
                                      ],
                                      selected: {_payment},
                                      onSelectionChanged: (s) =>
                                          setState(() => _payment = s.first),
                                    ),
                                    const SizedBox(height: 12),
                                    FilledButton(
                                      onPressed: state.cart.isEmpty || _busy
                                          ? null
                                          : () => _checkout(state),
                                      child: _busy
                                          ? const SizedBox(
                                              height: 18,
                                              width: 18,
                                              child: CircularProgressIndicator(
                                                  strokeWidth: 2),
                                            )
                                          : const Text('Charge'),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
        );
      },
    );
  }

  Future<void> _checkout(AppState state) async {
    if (state.shiftId == null) return;
    setState(() => _busy = true);
    try {
      final items = state.cart
          .map((l) => SaleItem(
                menuItemId: l.menuItemId,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
              ))
          .toList();

      // Always go through the offline queue - instant UI, safe replay.
      await state.queue.enqueueSale(
        shiftId: state.shiftId!,
        paymentMethod: _payment,
        items: items,
      );

      state.clearCart();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Sale queued')),
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed: $e')),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}
