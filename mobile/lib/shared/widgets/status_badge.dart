import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';

class StatusBadge extends StatelessWidget {
  const StatusBadge(this.label, {super.key});
  final String label;

  @override
  Widget build(BuildContext context) {
    final key = label.toLowerCase();
    final Color color =
        key.contains('tamam') ||
            key.contains('aktif') ||
            key.contains('approved')
        ? AppColors.success
        : key.contains('iptal') ||
              key.contains('red') ||
              key.contains('critical') ||
              key.contains('outofstock')
        ? AppColors.danger
        : key.contains('bek') ||
              key.contains('pending') ||
              key.contains('trial')
        ? AppColors.warning
        : AppColors.primaryDark;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .1),
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: color.withValues(alpha: .2)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}
