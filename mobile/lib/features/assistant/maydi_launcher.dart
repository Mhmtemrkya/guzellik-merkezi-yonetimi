import 'package:flutter/material.dart';

import '../../core/auth/auth_controller.dart';
import 'assistant_api.dart';
import 'assistant_screen.dart';
import 'maydi_mascot.dart';

/// Kabuğun (yönetici/personel ve müşteri) üstünde duran Maydi. Kurumun paketinde "ai.assistant" yoksa,
/// asistan kapalıysa ya da hesap türü desteklenmiyorsa (platform yöneticisi) hiç görünmez — durum
/// sorgusu hata verirse de gizli kalır, sayfa etkilenmez. Web `MaydiAssistant` ile parite.
class MaydiOverlay extends StatefulWidget {
  const MaydiOverlay({required this.auth, required this.child, required this.routeKey, this.bottomInset = 88, super.key});

  final AuthController auth;
  final Widget child;
  /// Sekme değişince maskot döner (en fazla 15 sn'de bir).
  final String routeKey;
  /// Alt gezinme çubuğu ve FAB'ın üstünde durmak için boşluk.
  final double bottomInset;

  @override
  State<MaydiOverlay> createState() => _MaydiOverlayState();
}

class _MaydiOverlayState extends State<MaydiOverlay> {
  late final AssistantApi _api = AssistantApi(widget.auth);
  bool _visible = false;
  int _spinSignal = 0;
  DateTime _lastSpin = DateTime.fromMillisecondsSinceEpoch(0);

  @override
  void initState() {
    super.initState();
    _check();
  }

  @override
  void didUpdateWidget(MaydiOverlay oldWidget) {
    super.didUpdateWidget(oldWidget);
    final now = DateTime.now();
    if (widget.routeKey != oldWidget.routeKey && now.difference(_lastSpin) >= const Duration(seconds: 15)) {
      _lastSpin = now;
      setState(() => _spinSignal++);
    }
  }

  Future<void> _check() async {
    try {
      final status = await _api.status();
      if (!mounted) return;
      setState(() => _visible = status['enabled'] == true && status['featureAllowed'] == true);
    } catch (_) {
      if (mounted) setState(() => _visible = false);
    }
  }

  void _open() {
    Navigator.of(context, rootNavigator: true).push(
      MaterialPageRoute(fullscreenDialog: true, builder: (_) => AssistantScreen(api: _api, auth: widget.auth)),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!_visible) return widget.child;
    final size = MediaQuery.sizeOf(context).shortestSide >= 600 ? 96.0 : 80.0;
    return Stack(
      children: [
        widget.child,
        Positioned(
          right: 6,
          bottom: widget.bottomInset + MediaQuery.paddingOf(context).bottom,
          child: Semantics(
            button: true,
            label: "Maydi'ye sor",
            child: Tooltip(
              message: "Maydi'ye sor",
              excludeFromSemantics: true,
              child: GestureDetector(
                onTap: _open,
                onLongPress: () => setState(() => _spinSignal++),
                child: MaydiMascot(size: size, spinOnAppear: true, spinSignal: _spinSignal),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
