import 'dart:async';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../api/matbex_offline_queue.dart';
import '../app_state.dart';
import 'menu_screen.dart';
import 'open_shift_screen.dart';
import 'close_shift_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  QueueStatus _status = QueueStatus.idle;
  int _pending = 0;
  StreamSubscription? _statusSub;
  StreamSubscription? _syncedSub;

  @override
  void initState() {
    super.initState();
    final state = AppStateScope.of(context);
    state.refreshShift();
    _statusSub = state.queue.statusStream.listen((s) async {
      final p = await state.queue.pendingCount();
      if (!mounted) return;
      setState(() {
        _status = s;
        _pending = p;
      });
    });
    _syncedSub = state.queue.syncedStream.listen((_) async {
      final p = await state.queue.pendingCount();
      if (!mounted) return;
      setState(() => _pending = p);
    });
  }

  @override
  void dispose() {
    _statusSub?.cancel();
    _syncedSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = AppStateScope.of(context);
    final hasShift = state.currentShift != null;

    return AnimatedBuilder(
      animation: state,
      builder: (_, __) {
        return Scaffold(
          appBar: AppBar(
            title: const Text('Matbex POS'),
            actions: [
              _QueueBadge(status: _status, pending: _pending),
              _OfflineSimToggle(queue: state.queue),
              IconButton(
                icon: const Icon(Icons.logout),
                onPressed: () => Supabase.instance.client.auth.signOut(),
              ),
            ],
          ),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      Icon(hasShift ? Icons.lock_open : Icons.lock_outline,
                          color: hasShift
                              ? const Color(0xFF00A859)
                              : Colors.grey),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(hasShift
                            ? 'Shift open · float ${state.currentShift!['opening_float'] ?? 0}'
                            : 'No open shift'),
                      ),
                      hasShift
                          ? OutlinedButton(
                              onPressed: () => Navigator.push(
                                context,
                                MaterialPageRoute(
                                    builder: (_) => const CloseShiftScreen()),
                              ),
                              child: const Text('Close'),
                            )
                          : FilledButton(
                              onPressed: () => Navigator.push(
                                context,
                                MaterialPageRoute(
                                    builder: (_) => const OpenShiftScreen()),
                              ),
                              child: const Text('Open shift'),
                            ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                icon: const Icon(Icons.point_of_sale),
                onPressed: hasShift
                    ? () => Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => const MenuScreen()),
                        )
                    : null,
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(56),
                ),
                label: const Text('Browse menu & record sale'),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _QueueBadge extends StatelessWidget {
  const _QueueBadge({required this.status, required this.pending});
  final QueueStatus status;
  final int pending;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      QueueStatus.idle => const Color(0xFF00A859),
      QueueStatus.syncing => Colors.blue,
      QueueStatus.offline => Colors.orange,
      QueueStatus.failed => Colors.red,
    };
    final label = switch (status) {
      QueueStatus.idle => 'Online',
      QueueStatus.syncing => 'Syncing',
      QueueStatus.offline => 'Offline',
      QueueStatus.failed => 'Failed',
    };
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text('$label${pending > 0 ? " · $pending" : ""}',
              style: const TextStyle(fontSize: 12)),
        ],
      ),
    );
  }
}

/// Debug-only toggle: forces the offline queue into a simulated offline
/// state so QA can verify replay + conflict handling without touching
/// airplane mode on the device.
class _OfflineSimToggle extends StatefulWidget {
  const _OfflineSimToggle({required this.queue});
  final MatbexOfflineQueue queue;

  @override
  State<_OfflineSimToggle> createState() => _OfflineSimToggleState();
}

class _OfflineSimToggleState extends State<_OfflineSimToggle> {
  late bool _simOffline = widget.queue.simulatedOffline;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: _simOffline
          ? 'Simulated offline - tap to go back online'
          : 'Tap to simulate offline (queue replay test)',
      child: IconButton(
        icon: Icon(
          _simOffline ? Icons.cloud_off : Icons.cloud_done_outlined,
          color: _simOffline ? Colors.orange : null,
        ),
        onPressed: () {
          final next = !_simOffline;
          widget.queue.setSimulatedOffline(next);
          setState(() => _simOffline = next);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              duration: const Duration(seconds: 2),
              content: Text(next
                  ? 'Simulated offline - writes will queue locally'
                  : 'Back online - replaying queued writes'),
            ),
          );
        },
      ),
    );
  }
}
