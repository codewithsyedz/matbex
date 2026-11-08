import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../app_state.dart';
import 'pair_screen.dart';
import 'login_screen.dart';
import 'home_screen.dart';

/// Routes the user to the right entry point based on pairing + auth state.
class GateScreen extends StatefulWidget {
  const GateScreen({super.key});
  @override
  State<GateScreen> createState() => _GateScreenState();
}

class _GateScreenState extends State<GateScreen> {
  @override
  Widget build(BuildContext context) {
    final state = AppStateScope.of(context);
    if (!state.client.isPaired) return const PairScreen();

    return StreamBuilder<AuthState>(
      stream: Supabase.instance.client.auth.onAuthStateChange,
      builder: (_, __) {
        final session = Supabase.instance.client.auth.currentSession;
        if (session == null) return const LoginScreen();
        return const HomeScreen();
      },
    );
  }
}
