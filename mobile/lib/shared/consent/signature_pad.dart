import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';

/// Parmak / kalem ile imza alanı (web `SignaturePad` paritesi).
///
/// Çizgiler ekran koordinatında toplanır, dışa aktarırken [ui.PictureRecorder] ile
/// devicePixelRatio ölçeğinde PNG'ye basılır — tablette imza net çıksın diye.
class SignaturePad extends StatefulWidget {
  const SignaturePad({
    required this.onChanged,
    this.height = 200,
    this.enabled = true,
    super.key,
  });

  /// Her darbeden sonra base64 PNG data-URL (boşsa null).
  final ValueChanged<String?> onChanged;
  final double height;
  final bool enabled;

  @override
  State<SignaturePad> createState() => _SignaturePadState();
}

class _SignaturePadState extends State<SignaturePad> {
  /// Her eleman bir darbe (stroke); null ayraç kullanılmaz, ayrı listeler tutulur.
  final List<List<Offset>> _strokes = [];
  Size _size = Size.zero;

  bool get _empty => _strokes.every((s) => s.isEmpty);

  void _start(Offset p) {
    if (!widget.enabled) return;
    setState(() => _strokes.add([p]));
  }

  void _extend(Offset p) {
    if (!widget.enabled || _strokes.isEmpty) return;
    setState(() => _strokes.last.add(p));
  }

  Future<void> _emit() async {
    if (_empty) {
      widget.onChanged(null);
      return;
    }
    final dataUrl = await _export();
    widget.onChanged(dataUrl);
  }

  Future<String?> _export() async {
    if (_size == Size.zero) return null;
    final ratio = MediaQuery.of(context).devicePixelRatio.clamp(1.0, 3.0);
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    canvas.scale(ratio);
    // Beyaz zemin: PDF'te şeffaf PNG bazı görüntüleyicilerde siyah çıkıyor.
    canvas.drawRect(Offset.zero & _size, Paint()..color = Colors.white);
    _paintStrokes(canvas);
    final picture = recorder.endRecording();
    final image = await picture.toImage((_size.width * ratio).round(), (_size.height * ratio).round());
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    if (bytes == null) return null;
    return 'data:image/png;base64,${base64Encode(Uint8List.view(bytes.buffer))}';
  }

  void _paintStrokes(Canvas canvas) {
    final paint = Paint()
      ..color = AppColors.ink
      ..strokeWidth = 2.4
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;
    for (final stroke in _strokes) {
      if (stroke.isEmpty) continue;
      if (stroke.length == 1) {
        canvas.drawPoints(ui.PointMode.points, stroke, paint);
        continue;
      }
      final path = Path()..moveTo(stroke.first.dx, stroke.first.dy);
      for (final p in stroke.skip(1)) {
        path.lineTo(p.dx, p.dy);
      }
      canvas.drawPath(path, paint);
    }
  }

  void _clear() {
    setState(_strokes.clear);
    widget.onChanged(null);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            _size = Size(constraints.maxWidth, widget.height);
            return Container(
              height: widget.height,
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.primary.withValues(alpha: .5), width: 2),
              ),
              clipBehavior: Clip.antiAlias,
              child: Stack(
                children: [
                  GestureDetector(
                    onPanStart: (d) => _start(d.localPosition),
                    onPanUpdate: (d) => _extend(d.localPosition),
                    onPanEnd: (_) => _emit(),
                    child: CustomPaint(
                      painter: _SignaturePainter(_strokes),
                      size: Size.infinite,
                      child: const SizedBox.expand(),
                    ),
                  ),
                  if (_empty)
                    IgnorePointer(
                      child: Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.draw_rounded, size: 28, color: AppColors.primaryDark),
                            const SizedBox(height: 6),
                            Text(
                              'Parmağınızla buraya imzalayın',
                              style: TextStyle(
                                color: AppColors.primaryDark.withValues(alpha: .85),
                                fontSize: 13,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            );
          },
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            const Expanded(
              child: Text(
                'İmzanız belgeye tarih ve saat bilgisiyle işlenir.',
                style: TextStyle(color: AppColors.muted, fontSize: 11.5),
              ),
            ),
            TextButton.icon(
              onPressed: _empty || !widget.enabled ? null : _clear,
              icon: const Icon(Icons.backspace_outlined, size: 16),
              label: const Text('Temizle'),
            ),
          ],
        ),
      ],
    );
  }
}

class _SignaturePainter extends CustomPainter {
  _SignaturePainter(this.strokes);
  final List<List<Offset>> strokes;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AppColors.ink
      ..strokeWidth = 2.4
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;
    for (final stroke in strokes) {
      if (stroke.isEmpty) continue;
      if (stroke.length == 1) {
        canvas.drawPoints(ui.PointMode.points, stroke, paint);
        continue;
      }
      final path = Path()..moveTo(stroke.first.dx, stroke.first.dy);
      for (final p in stroke.skip(1)) {
        path.lineTo(p.dx, p.dy);
      }
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(_SignaturePainter oldDelegate) => true;
}
