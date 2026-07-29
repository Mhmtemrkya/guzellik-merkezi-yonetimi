import 'dart:math' as math;

import 'package:flutter/material.dart';
// intl kendi TextDirection'ını dışa verir ve Flutter'ınkini gölgeler (TextPainter'da .ltr gerekiyor).
import 'package:intl/intl.dart' hide TextDirection;

import '../../core/theme/app_theme.dart';

/// Raporlar ekranının görselleştirme kiti — web'deki `ReportCharts.tsx` karşılığı.
///  • ReportKpi     · KPI kartı (kıyas farkı rozetiyle)
///  • ReportDonut   · dairesel dağılım + açıklama listesi
///  • ReportTrend   · çok serili çizgi/alan grafiği (kıyas serisi kesikli)
///  • ReportGauge   · tek oranı gösteren halka
///  • RankBarList   · sıralı yatay bar listesi
///  • CompareBars   · dönem ↔ kıyas dönemi ikili bar
///  • ReportSection · başlıklı kart kabuğu

const reportPalette = <Color>[
  Color(0xFFC85776),
  Color(0xFF7B52BA),
  Color(0xFF2C7D63),
  Color(0xFFC99A2E),
  Color(0xFF4A7FB5),
  Color(0xFFB3453F),
  Color(0xFF8A6D3B),
  Color(0xFF5D8A7B),
];

Color paletteAt(int i) => reportPalette[i % reportPalette.length];

final _moneyFmt = NumberFormat.currency(
  locale: 'tr_TR',
  symbol: '₺',
  decimalDigits: 0,
);
final _countFmt = NumberFormat.decimalPattern('tr_TR');

String reportMoney(num v) => _moneyFmt.format(v.round());
String reportCount(num v) => _countFmt.format(v.round());

/// Kısa sayı: 12.500 → 12,5B · 1.200.000 → 1,2M (eksen etiketleri için).
String reportShort(num v) {
  final abs = v.abs();
  if (abs >= 1000000) {
    return '${(v / 1000000).toStringAsFixed(abs >= 10000000 ? 0 : 1)}M';
  }
  if (abs >= 1000) {
    return '${(v / 1000).toStringAsFixed(abs >= 10000 ? 0 : 1)}B';
  }
  return v.round().toString();
}

/// Süre: 615 dk → "10 sa 15 dk"
String reportDuration(num minutes) {
  final total = minutes.round();
  final h = total ~/ 60;
  final m = total % 60;
  return h > 0 ? '$h sa $m dk' : '$m dk';
}

/// "Ayşe Yılmaz" → "AY"
String reportInitials(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((p) => p.isNotEmpty)
      .toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) {
    return parts.first
        .substring(0, math.min(2, parts.first.length))
        .toUpperCase();
  }
  return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
}

// ===========================================================================
// Kart kabuğu
// ===========================================================================

class ReportSection extends StatelessWidget {
  const ReportSection({
    required this.title,
    required this.child,
    this.subtitle,
    this.icon,
    this.action,
    super.key,
  });

  final String title;
  final String? subtitle;
  final IconData? icon;
  final Widget? action;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                if (icon != null) ...[
                  Container(
                    width: 30,
                    height: 30,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: AppColors.surfaceSoft,
                      borderRadius: BorderRadius.circular(9),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Icon(icon, size: 16, color: AppColors.primaryDark),
                  ),
                  const SizedBox(width: 9),
                ],
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w800,
                          color: AppColors.ink,
                        ),
                      ),
                      if (subtitle != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(
                            subtitle!,
                            style: const TextStyle(
                              fontSize: 11,
                              color: AppColors.muted,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                ?action,
              ],
            ),
            const SizedBox(height: 12),
            child,
          ],
        ),
      ),
    );
  }
}

// ===========================================================================
// KPI kartı
// ===========================================================================

class ReportKpi extends StatelessWidget {
  const ReportKpi({
    required this.label,
    required this.value,
    required this.icon,
    this.tone = AppColors.primary,
    this.hint,
    this.current,
    this.previous,
    this.compareLabel,
    this.invert = false,
    this.onTap,
    super.key,
  });

  final String label;
  final String value;
  final IconData icon;
  final Color tone;
  final String? hint;

  /// Fark rozeti için dönem ve kıyas değeri (ikisi de verilmeli).
  final double? current;
  final double? previous;
  final String? compareLabel;

  /// Gider gibi düşmesi iyi olan metriklerde renkler ters çevrilir.
  final bool invert;

  /// Verilirse karta dokununca detay sayfası açılır.
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: tone.withValues(alpha: .12),
                    borderRadius: BorderRadius.circular(9),
                  ),
                  child: Icon(icon, size: 15, color: tone),
                ),
                const Spacer(),
                if (current != null && previous != null && compareLabel != null)
                  DeltaChip(
                    current: current!,
                    previous: previous!,
                    invert: invert,
                  )
                else if (onTap != null)
                  const Icon(
                    Icons.info_outline_rounded,
                    size: 14,
                    color: AppColors.muted,
                  ),
              ],
            ),
            const SizedBox(height: 9),
            Text(
              label,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
                color: AppColors.muted,
              ),
            ),
            const SizedBox(height: 3),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                value,
                style: const TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w800,
                  color: AppColors.ink,
                  letterSpacing: -.6,
                ),
              ),
            ),
            if (hint != null) ...[
              const SizedBox(height: 4),
              Text(
                hint!,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 10.5, color: AppColors.muted),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Dönem ↔ kıyas farkı rozeti.
class DeltaChip extends StatelessWidget {
  const DeltaChip({
    required this.current,
    required this.previous,
    this.invert = false,
    super.key,
  });

  final double current;
  final double previous;
  final bool invert;

  @override
  Widget build(BuildContext context) {
    final diff = current - previous;
    final neutral = diff.abs() < 0.005;
    final good = invert ? diff < 0 : diff > 0;
    final color = neutral
        ? AppColors.muted
        : good
        ? AppColors.success
        : AppColors.danger;
    final text = previous == 0
        ? (neutral ? '—' : reportShort(diff.abs()))
        : '%${((diff / previous.abs()) * 100).abs().round()}';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .10),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: .30)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            neutral
                ? Icons.remove_rounded
                : diff > 0
                ? Icons.arrow_upward_rounded
                : Icons.arrow_downward_rounded,
            size: 11,
            color: color,
          ),
          const SizedBox(width: 2),
          Text(
            text,
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

// ===========================================================================
// Donut
// ===========================================================================

class DonutSlice {
  const DonutSlice({required this.label, required this.value, this.color});
  final String label;
  final double value;
  final Color? color;
}

class ReportDonut extends StatelessWidget {
  const ReportDonut({
    required this.slices,
    this.centerLabel = 'Toplam',
    this.format = reportMoney,
    this.size = 140,
    super.key,
  });

  final List<DonutSlice> slices;
  final String centerLabel;
  final String Function(num) format;
  final double size;

  @override
  Widget build(BuildContext context) {
    final visible = slices.where((s) => s.value > 0).toList();
    final total = visible.fold<double>(0, (s, x) => s + x.value);
    if (visible.isEmpty || total <= 0) return const ReportEmpty();

    final colored = <(DonutSlice, Color)>[
      for (var i = 0; i < visible.length; i++)
        (visible[i], visible[i].color ?? paletteAt(i)),
    ];

    return Column(
      children: [
        SizedBox(
          width: size,
          height: size,
          child: CustomPaint(
            painter: _DonutPainter(
              values: colored.map((e) => e.$1.value).toList(),
              colors: colored.map((e) => e.$2).toList(),
            ),
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      format(total),
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        color: AppColors.ink,
                      ),
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    centerLabel,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 10,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: 12),
        for (final (slice, color) in colored)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              children: [
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(
                    color: color,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    slice.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                    ),
                  ),
                ),
                Text(
                  format(slice.value),
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(width: 6),
                SizedBox(
                  width: 34,
                  child: Text(
                    '%${((slice.value / total) * 100).round()}',
                    textAlign: TextAlign.right,
                    style: const TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.primaryDark,
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _DonutPainter extends CustomPainter {
  _DonutPainter({required this.values, required this.colors});
  final List<double> values;
  final List<Color> colors;

  @override
  void paint(Canvas canvas, Size size) {
    final total = values.fold<double>(0, (s, v) => s + v);
    if (total <= 0) return;
    final thickness = size.width * .17;
    final rect = Rect.fromLTWH(
      thickness / 2,
      thickness / 2,
      size.width - thickness,
      size.height - thickness,
    );

    final track = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = thickness
      ..color = AppColors.surfaceSoft;
    canvas.drawArc(rect, 0, math.pi * 2, false, track);

    var start = -math.pi / 2;
    for (var i = 0; i < values.length; i++) {
      final sweep = (values[i] / total) * math.pi * 2;
      final paint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = thickness
        ..color = colors[i];
      canvas.drawArc(rect, start, sweep, false, paint);
      start += sweep;
    }
  }

  @override
  bool shouldRepaint(covariant _DonutPainter old) =>
      old.values != values || old.colors != colors;
}

// ===========================================================================
// Trend (çizgi/alan)
// ===========================================================================

class TrendSeries {
  const TrendSeries({
    required this.label,
    required this.color,
    required this.values,
    this.dashed = false,
    this.filled = true,
  });

  final String label;
  final Color color;
  final List<double> values;

  /// Kıyas serisi kesikli ve dolgusuz çizilir.
  final bool dashed;
  final bool filled;
}

class ReportTrend extends StatelessWidget {
  const ReportTrend({
    required this.labels,
    required this.series,
    this.height = 190,
    this.format = reportShort,
    super.key,
  });

  final List<String> labels;
  final List<TrendSeries> series;
  final double height;
  final String Function(num) format;

  @override
  Widget build(BuildContext context) {
    final visible = series.where((s) => s.values.isNotEmpty).toList();
    if (labels.isEmpty || visible.isEmpty) return const ReportEmpty();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          height: height,
          width: double.infinity,
          child: CustomPaint(
            painter: _TrendPainter(
              labels: labels,
              series: visible,
              format: format,
            ),
          ),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 14,
          runSpacing: 4,
          children: [
            for (final s in visible)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 14,
                    height: 3,
                    decoration: BoxDecoration(
                      color: s.color.withValues(alpha: s.dashed ? .55 : 1),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  const SizedBox(width: 5),
                  Text(
                    s.label,
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                ],
              ),
          ],
        ),
      ],
    );
  }
}

class _TrendPainter extends CustomPainter {
  _TrendPainter({
    required this.labels,
    required this.series,
    required this.format,
  });
  final List<String> labels;
  final List<TrendSeries> series;
  final String Function(num) format;

  @override
  void paint(Canvas canvas, Size size) {
    const padLeft = 44.0;
    const padRight = 6.0;
    const padTop = 8.0;
    const padBottom = 20.0;
    final w = size.width - padLeft - padRight;
    final h = size.height - padTop - padBottom;
    if (w <= 0 || h <= 0) return;

    var maxV = 0.0;
    var minV = 0.0;
    for (final s in series) {
      for (final v in s.values) {
        if (v > maxV) maxV = v;
        if (v < minV) minV = v;
      }
    }
    if (maxV == 0 && minV == 0) maxV = 1;
    final span = maxV - minV == 0 ? 1 : maxV - minV;

    double yOf(double v) => padTop + h - ((v - minV) / span) * h;
    double xOf(int i) =>
        padLeft + (labels.length == 1 ? w / 2 : (i / (labels.length - 1)) * w);

    // ızgara + y ekseni
    final grid = Paint()
      ..color = AppColors.border
      ..strokeWidth = 1;
    for (var i = 0; i <= 4; i++) {
      final value = minV + (span * i / 4);
      final y = yOf(value);
      canvas.drawLine(
        Offset(padLeft, y),
        Offset(size.width - padRight, y),
        grid,
      );
      _text(
        canvas,
        format(value),
        Offset(padLeft - 5, y - 6),
        align: TextAlign.right,
        width: 40,
        size: 9.5,
      );
    }

    // seriler
    for (final s in series) {
      if (s.values.isEmpty) continue;
      final path = Path();
      for (var i = 0; i < s.values.length && i < labels.length; i++) {
        final p = Offset(xOf(i), yOf(s.values[i]));
        if (i == 0) {
          path.moveTo(p.dx, p.dy);
        } else {
          path.lineTo(p.dx, p.dy);
        }
      }
      if (s.filled && !s.dashed) {
        final area = Path.from(path)
          ..lineTo(
            xOf(math.min(s.values.length, labels.length) - 1),
            padTop + h,
          )
          ..lineTo(xOf(0), padTop + h)
          ..close();
        canvas.drawPath(
          area,
          Paint()
            ..shader = LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                s.color.withValues(alpha: .28),
                s.color.withValues(alpha: 0),
              ],
            ).createShader(Rect.fromLTWH(padLeft, padTop, w, h)),
        );
      }
      final stroke = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = s.dashed ? 1.8 : 2.4
        ..strokeCap = StrokeCap.round
        ..color = s.color.withValues(alpha: s.dashed ? .7 : 1);
      canvas.drawPath(s.dashed ? _dash(path) : path, stroke);
    }

    // x ekseni etiketleri (en fazla 5)
    final step = math.max(1, (labels.length / 5).ceil());
    for (var i = 0; i < labels.length; i += step) {
      _text(
        canvas,
        labels[i],
        Offset(xOf(i) - 22, size.height - 14),
        align: TextAlign.center,
        width: 44,
        size: 9.5,
      );
    }
  }

  /// Kıyas serisi için kesikli çizgi (Flutter'da yerleşik dash yok).
  Path _dash(Path source) {
    final result = Path();
    for (final metric in source.computeMetrics()) {
      var distance = 0.0;
      var draw = true;
      while (distance < metric.length) {
        final len = draw ? 6.0 : 5.0;
        final next = math.min(distance + len, metric.length);
        if (draw) {
          result.addPath(metric.extractPath(distance, next), Offset.zero);
        }
        distance = next;
        draw = !draw;
      }
    }
    return result;
  }

  void _text(
    Canvas canvas,
    String value,
    Offset at, {
    required TextAlign align,
    required double width,
    double size = 10,
  }) {
    final tp = TextPainter(
      text: TextSpan(
        text: value,
        style: const TextStyle(fontSize: 9.5, color: AppColors.muted),
      ),
      textAlign: align,
      textDirection: TextDirection.ltr,
    )..layout(maxWidth: width);
    tp.paint(
      canvas,
      align == TextAlign.right ? Offset(at.dx - tp.width, at.dy) : at,
    );
  }

  @override
  bool shouldRepaint(covariant _TrendPainter old) =>
      old.labels != labels || old.series != series;
}

// ===========================================================================
// Gauge
// ===========================================================================

class ReportGauge extends StatelessWidget {
  const ReportGauge({
    required this.value,
    required this.label,
    this.hint,
    this.color = AppColors.primary,
    this.size = 104,
    super.key,
  });

  /// 0–100 arası oran.
  final double value;
  final String label;
  final String? hint;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    final clamped = value.clamp(0, 100).toDouble();
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: size,
          height: size,
          child: CustomPaint(
            painter: _GaugePainter(value: clamped, color: color),
            child: Center(
              child: Text(
                '%${clamped.round()}',
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                  color: AppColors.ink,
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 7),
        Text(
          label,
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontSize: 11.5,
            fontWeight: FontWeight.w700,
            color: AppColors.ink,
          ),
        ),
        if (hint != null)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(
              hint!,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 10.5, color: AppColors.muted),
            ),
          ),
      ],
    );
  }
}

class _GaugePainter extends CustomPainter {
  _GaugePainter({required this.value, required this.color});
  final double value;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    const thickness = 10.0;
    final rect = Rect.fromLTWH(
      thickness / 2,
      thickness / 2,
      size.width - thickness,
      size.height - thickness,
    );
    canvas.drawArc(
      rect,
      0,
      math.pi * 2,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = thickness
        ..color = AppColors.surfaceSoft,
    );
    canvas.drawArc(
      rect,
      -math.pi / 2,
      (value / 100) * math.pi * 2,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = thickness
        ..strokeCap = StrokeCap.round
        ..color = color,
    );
  }

  @override
  bool shouldRepaint(covariant _GaugePainter old) =>
      old.value != value || old.color != color;
}

// ===========================================================================
// Sıralı bar listesi
// ===========================================================================

class RankBarItem {
  const RankBarItem({
    required this.label,
    required this.value,
    this.hint,
    this.color,
  });
  final String label;
  final double value;
  final String? hint;
  final Color? color;
}

class RankBarList extends StatelessWidget {
  const RankBarList({
    required this.items,
    this.format = reportMoney,
    this.emptyText = 'Kayıt yok.',
    this.maxValue,
    super.key,
  });

  final List<RankBarItem> items;
  final String Function(num) format;
  final String emptyText;
  final double? maxValue;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return ReportEmpty(text: emptyText);
    final top =
        maxValue ?? items.fold<double>(1, (m, i) => math.max(m, i.value.abs()));

    return Column(
      children: [
        for (var i = 0; i < items.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 18,
                      height: 18,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: AppColors.surfaceSoft,
                        borderRadius: BorderRadius.circular(9),
                      ),
                      child: Text(
                        '${i + 1}',
                        style: const TextStyle(
                          fontSize: 9.5,
                          fontWeight: FontWeight.w800,
                          color: AppColors.primaryDark,
                        ),
                      ),
                    ),
                    const SizedBox(width: 7),
                    Expanded(
                      child: Text(
                        items[i].label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                    ),
                    Text(
                      format(items[i].value),
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                        color: AppColors.ink,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 5),
                ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: (items[i].value.abs() / top)
                        .clamp(0.03, 1)
                        .toDouble(),
                    minHeight: 7,
                    backgroundColor: AppColors.surfaceSoft,
                    valueColor: AlwaysStoppedAnimation(
                      items[i].color ?? paletteAt(i),
                    ),
                  ),
                ),
                if (items[i].hint != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      items[i].hint!,
                      style: const TextStyle(
                        fontSize: 10.5,
                        color: AppColors.muted,
                      ),
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

// ===========================================================================
// Dönem ↔ kıyas ikili bar
// ===========================================================================

class CompareRow {
  const CompareRow({
    required this.label,
    required this.current,
    required this.previous,
  });
  final String label;
  final double current;
  final double previous;
}

class CompareBars extends StatelessWidget {
  const CompareBars({
    required this.rows,
    required this.currentLabel,
    required this.previousLabel,
    this.format = reportMoney,
    super.key,
  });

  final List<CompareRow> rows;
  final String currentLabel;
  final String previousLabel;
  final String Function(num) format;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) {
      return const ReportEmpty(text: 'Karşılaştırılacak veri yok.');
    }
    final max = rows.fold<double>(
      1,
      (m, r) => math.max(m, math.max(r.current.abs(), r.previous.abs())),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 14,
          children: [
            _legend(AppColors.primary, currentLabel),
            _legend(AppColors.rose, previousLabel),
          ],
        ),
        const SizedBox(height: 10),
        for (final r in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        r.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                    ),
                    Text(
                      format(r.current),
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                        color: AppColors.ink,
                      ),
                    ),
                    const SizedBox(width: 6),
                    DeltaChip(current: r.current, previous: r.previous),
                  ],
                ),
                const SizedBox(height: 4),
                _bar(r.current.abs() / max, AppColors.primary, 8),
                const SizedBox(height: 3),
                _bar(r.previous.abs() / max, AppColors.rose, 6),
              ],
            ),
          ),
      ],
    );
  }

  Widget _legend(Color c, String text) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(
        width: 14,
        height: 8,
        decoration: BoxDecoration(
          color: c,
          borderRadius: BorderRadius.circular(4),
        ),
      ),
      const SizedBox(width: 5),
      Text(
        text,
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: AppColors.ink,
        ),
      ),
    ],
  );

  Widget _bar(double ratio, Color color, double height) => ClipRRect(
    borderRadius: BorderRadius.circular(4),
    child: LinearProgressIndicator(
      value: ratio.clamp(0.02, 1).toDouble(),
      minHeight: height,
      backgroundColor: AppColors.surfaceSoft,
      valueColor: AlwaysStoppedAnimation(color),
    ),
  );
}

// ===========================================================================
// Boş durum
// ===========================================================================

class ReportEmpty extends StatelessWidget {
  const ReportEmpty({this.text = 'Bu dönemde veri yok.', super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.symmetric(vertical: 22, horizontal: 12),
    decoration: BoxDecoration(
      color: AppColors.surfaceSoft.withValues(alpha: .5),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: AppColors.border),
    ),
    child: Text(
      text,
      textAlign: TextAlign.center,
      style: const TextStyle(fontSize: 12, color: AppColors.muted),
    ),
  );
}

// ===========================================================================
// Basit veri tablosu (yatay kaydırmalı)
// ===========================================================================

class ReportColumn<T> {
  const ReportColumn({
    required this.header,
    required this.cell,
    this.width = 90,
    this.alignRight = false,
  });
  final String header;
  final Widget Function(T row) cell;
  final double width;
  final bool alignRight;
}

class ReportDataTable<T> extends StatelessWidget {
  const ReportDataTable({
    required this.rows,
    required this.columns,
    this.emptyText = 'Kayıt bulunamadı.',
    super.key,
  });

  final List<T> rows;
  final List<ReportColumn<T>> columns;
  final String emptyText;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return ReportEmpty(text: emptyText);
    final totalWidth = columns.fold<double>(0, (s, c) => s + c.width + 12);

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: SizedBox(
        width: totalWidth,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  for (final c in columns)
                    SizedBox(
                      width: c.width,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 6),
                        child: Text(
                          c.header,
                          textAlign: c.alignRight
                              ? TextAlign.right
                              : TextAlign.left,
                          style: const TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
                            letterSpacing: .4,
                            color: AppColors.muted,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            for (final row in rows)
              Container(
                decoration: const BoxDecoration(
                  border: Border(
                    top: BorderSide(color: AppColors.border, width: .6),
                  ),
                ),
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  children: [
                    for (final c in columns)
                      SizedBox(
                        width: c.width,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 6),
                          child: Align(
                            alignment: c.alignRight
                                ? Alignment.centerRight
                                : Alignment.centerLeft,
                            child: c.cell(row),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
