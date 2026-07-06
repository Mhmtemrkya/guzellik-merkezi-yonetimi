import 'package:flutter/material.dart';

/// Küçük satır-içi sparkline: tamsayı değer listesini çizgi + son nokta olarak çizer.
/// Web dashboard/onaylar/loglar sayfalarındaki SVG sparkline'ın Flutter karşılığı.
class Sparkline extends StatelessWidget {
  const Sparkline({
    required this.values,
    required this.color,
    this.strokeWidth = 1.6,
    this.showDot = true,
    super.key,
  });

  final List<int> values;
  final Color color;
  final double strokeWidth;
  final bool showDot;

  @override
  Widget build(BuildContext context) => CustomPaint(
        painter: _SparkPainter(values, color, strokeWidth, showDot),
      );
}

class _SparkPainter extends CustomPainter {
  _SparkPainter(this.values, this.color, this.strokeWidth, this.showDot);
  final List<int> values;
  final Color color;
  final double strokeWidth;
  final bool showDot;

  @override
  void paint(Canvas canvas, Size size) {
    if (values.isEmpty) return;
    final maxV = values.reduce((a, b) => a > b ? a : b);
    final m = maxV < 1 ? 1 : maxV;
    final n = values.length;
    final path = Path();
    for (var i = 0; i < n; i++) {
      final x = n == 1 ? size.width : (i / (n - 1)) * size.width;
      final y = size.height - (values[i] / m) * (size.height - 3) - 1.5;
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = color
        ..strokeWidth = strokeWidth
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
    if (showDot) {
      final lastY = size.height - (values[n - 1] / m) * (size.height - 3) - 1.5;
      canvas.drawCircle(Offset(size.width, lastY), 2, Paint()..color = color);
    }
  }

  @override
  bool shouldRepaint(covariant _SparkPainter old) =>
      old.values != values ||
      old.color != color ||
      old.strokeWidth != strokeWidth ||
      old.showDot != showDot;
}
