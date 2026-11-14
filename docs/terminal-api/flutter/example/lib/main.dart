// Matbex POS demo entrypoint (Android + iOS).
//
// Before running, copy the shared client + offline queue into lib/api/:
//   cp ../matbex_terminal_client.dart lib/api/
//   cp ../matbex_offline_queue.dart   lib/api/

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'api/matbex_terminal_client.dart';
import 'api/matbex_offline_queue.dart';
import 'app_state.dart';
import 'screens/gate_screen.dart';
const _apiBase = String.fromEnvironment(
  'MATBEX_API_BASE',
  defaultValue:
      'https://api.matbex.com/functions/v1/terminal-api',
);
const _apiBase = String.fromEnvironment(
  'SUFRA_API_BASE',
  defaultValue:
      'https://api.matbex.com/functions/v1/terminal-api',
);
const _supabaseUrl = String.fromEnvironment(
  'SUPABASE_URL',
  defaultValue: 'https://api.matbex.com',
);
const _supabaseAnonKey = String.fromEnvironment(
  'SUPABASE_ANON_KEY',
  defaultValue:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRsa3l1YmtiYnF3bXpqYW9nYXZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU2ODI2NDYsImV4cCI6MjA4MTI1ODY0Nn0.lWDH5IPae2Yqe-kWae58KELgV6486VXijyAj4NLWKJQ',
);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Supabase.initialize(url: _supabaseUrl, anonKey: _supabaseAnonKey);

  final client = MatbexTerminalClient(baseUrl: _apiBase);
  await client.loadDeviceKey();

  final queue = MatbexOfflineQueue(client: client);
  await queue.init();

  // Keep cashier JWT in sync with the Supabase session.
  Supabase.instance.client.auth.onAuthStateChange.listen((evt) {
    client.setCashierJwt(evt.session?.accessToken);
  });
  client.setCashierJwt(Supabase.instance.client.auth.currentSession?.accessToken);

  queue.start();

  runApp(MatbexPosDemo(state: AppState(client: client, queue: queue)));
}

class MatbexPosDemo extends StatelessWidget {
  const MatbexPosDemo({super.key, required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) {
    return AppStateScope(
      state: state,
      child: MaterialApp(
        title: 'Matbex POS',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF00A859), // Matbex Emerald
            brightness: Brightness.light,
          ),
          fontFamily: 'Inter',
          textTheme: const TextTheme(
            bodyMedium: TextStyle(fontWeight: FontWeight.w300),
          ),
        ),
        home: const GateScreen(),
      ),
    );
  }
}
