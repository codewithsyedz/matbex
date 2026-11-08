import 'package:flutter/material.dart';
import '../app_state.dart';

class OpenShiftScreen extends StatefulWidget {
  const OpenShiftScreen({super.key});
  @override
  State<OpenShiftScreen> createState() => _OpenShiftScreenState();
}

class _OpenShiftScreenState extends State<OpenShiftScreen> {
  final _float = TextEditingController(text: '100');
  bool _busy = false;
  String? _error;

  @override
  Widget build(BuildContext context) {
    final state = AppStateScope.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Open shift')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _float,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Opening float'),
            ),
            const SizedBox(height: 16),
            if (_error != null)
              Text(_error!, style: const TextStyle(color: Colors.red)),
            FilledButton(
              onPressed: _busy
                  ? null
                  : () async {
                      setState(() {
                        _busy = true;
                        _error = null;
                      });
                      try {
                        await state.client.openShift(
                            openingFloat: num.parse(_float.text));
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
                  : const Text('Open shift'),
            ),
          ],
        ),
      ),
    );
  }
}
