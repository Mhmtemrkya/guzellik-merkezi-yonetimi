import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';

class AppBackground extends StatelessWidget {
  const AppBackground({required this.child, super.key});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFFFBFC), AppColors.background, Color(0xFFFDF0F4)],
        ),
      ),
      child: Stack(
        children: [
          const Positioned(
            top: -100,
            left: -80,
            child: _Glow(color: AppColors.rose, size: 260),
          ),
          const Positioned(
            bottom: 80,
            right: -110,
            child: _Glow(color: Color(0xFFFFEAF1), size: 290),
          ),
          child,
        ],
      ),
    );
  }
}

class _Glow extends StatelessWidget {
  const _Glow({required this.color, required this.size});
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) => IgnorePointer(
    child: Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(
          colors: [color.withValues(alpha: .55), color.withValues(alpha: 0)],
        ),
      ),
    ),
  );
}
