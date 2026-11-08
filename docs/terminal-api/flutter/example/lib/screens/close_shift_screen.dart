import 'package:flutter/material.dart';
import '../app_state.dart';

class CloseShiftScreen extends StatefulWidget {
  const CloseShiftScreen({super.key});
  @override
  State<CloseShiftScreen> createState() => _CloseShiftScreenState();
}

class _CloseShiftScreenState extends State<CloseShiftScreen> {
  final _cash = TextEditingController(text: '0');
  final _card = TextEditingController(text: '0');
  final _notes = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  Widget build(BuildContext context) {
    final state = AppStateScope.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Close shift')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _cash,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Counted cash'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _card,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Counted card'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _notes,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Notes (optional)'),
            ),
            const SizedBox(height: 16),
            if (_error != null)
              Text(_error!, style: const TextStyle(color: Colors.red)),
            FilledButton(
              onPressed: _busy || state.shiftId == null
                  ? null
                  : () async {
                      setState(() {
                        _busy = true;
                        _error = null;
                      });
                      try {
                        await state.client.closeShift(
                          shiftId: state.shiftId!,
                          countedCash: num.parse(_cash.text),
                          countedCard: num.parse(_card.text),
                          notes: _notes.text.isEmpty ? null : _notes.text,
                        );
                        await state.refreshShift();
                        if (mounted) Navigator.pop(context);
                      } catch (e) {
                        setState(() => _error = e.toString());
                      } finally {
                        if (mounted) setState(() => _busy = false);
                      }
                    },
              child: _busy
                  ? const CircularProgressIndicator()
                  : const Text('Close shift'),
            ),
          ],
        ),
      ),
    );
  }
}
