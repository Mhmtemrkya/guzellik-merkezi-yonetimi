import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../appointments/calendar_theme.dart';
import 'account_grouping.dart';

/// AYLIK TAKSİT TAKVİMİ — web `PaymentScheduleGrid` paritesi.
///
/// Sütunlar aylar, hücre rengi o ayın durumunu söyler: yeşil ödendi · amber kısmi · kırmızı
/// gecikmiş · nötr bekleyen. Tutarlar hücrenin İÇİNDE yazılır (dokunmadan okunmalı).
///
/// RENK TEK BAŞINA ANLAM TAŞIMAZ: her hücrede durum işareti + tutar var (renk körlüğü).
/// Şerit yatay kaydırılır ve "bugün" sütunu açılışta görünür konuma getirilir.
class PaymentScheduleGrid extends StatefulWidget {
  const PaymentScheduleGrid({required this.cells, required this.todayKey, super.key});

  final List<MonthCell> cells;

  /// `YYYY-MM` — "bugün" sütununu vurgulamak ve oraya kaydırmak için.
  final String todayKey;

  @override
  State<PaymentScheduleGrid> createState() => _PaymentScheduleGridState();
}

class _PaymentScheduleGridState extends State<PaymentScheduleGrid> {
  final _scroll = ScrollController();
  static const _cellWidth = 108.0;
  static const _gap = 8.0;

  @override
  void initState() {
    super.initState();
    // Açılışta "bugün"e kaydır: 24 aylık planda kullanıcı her seferinde elle sürüklüyordu.
    WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToToday());
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _scrollToToday() {
    if (!_scroll.hasClients) return;
    final idx = widget.cells.indexWhere((c) => c.key == widget.todayKey);
    if (idx < 0) return;
    final target = (idx * (_cellWidth + _gap)) - 120;
    _scroll.jumpTo(target.clamp(0, _scroll.position.maxScrollExtent));
  }

  ({Color bg, Color border, Color ink, String label, String mark}) _style(String status) {
    switch (status) {
      case 'paid':
        return (bg: const Color(0xFFECFDF5), border: const Color(0xFFA7F3D0), ink: const Color(0xFF065F46), label: 'Ödendi', mark: '✓');
      case 'partial':
        return (bg: const Color(0xFFFFFBEB), border: const Color(0xFFFCD34D), ink: const Color(0xFF92400E), label: 'Kısmi', mark: '◐');
      case 'overdue':
        return (bg: const Color(0xFFFFF1F2), border: const Color(0xFFFDA4AF), ink: const Color(0xFF9F1239), label: 'Gecikmiş', mark: '!');
      case 'upcoming':
        return (bg: Colors.white, border: const Color(0xFFE3D2DA), ink: AppColors.ink, label: 'Bekleyen', mark: '·');
      default:
        return (bg: const Color(0xFFFCFAFB), border: const Color(0xFFECDFE5), ink: AppColors.muted, label: 'Taksit yok', mark: '–');
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.cells.isEmpty) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 26, horizontal: 14),
        decoration: BoxDecoration(
          color: const Color(0xFFFFFAFB),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.border),
        ),
        child: const Text('Bu müşteride taksit planı yok — satışlar peşin.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: AppColors.muted)),
      );
    }

    final due = widget.cells.fold<double>(0, (s, c) => s + c.due);
    final paid = widget.cells.fold<double>(0, (s, c) => s + c.paid);
    final remaining = widget.cells.fold<double>(0, (s, c) => s + c.remaining);
    final overdue = widget.cells
        .where((c) => c.status == 'overdue')
        .fold<double>(0, (s, c) => s + c.remaining);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Özet şeridi — KAPSAM AÇIKÇA YAZILI: bu rakamlar YALNIZ taksitleri sayar. Peşinat ve
        // peşin satışlar taksit satırı üretmediğinden buraya girmez; üstteki "Tahsil Edilen"
        // KPI'ı ise müşterinin TÜM tahsilatıdır (etiketsiz bırakılınca çelişki sanılıyordu).
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            _chip('Taksit planı', due, AppColors.ink, AppColors.border, Colors.white),
            _chip('Taksitlerden tahsil', paid, const Color(0xFF065F46), const Color(0xFFA7F3D0), const Color(0xFFECFDF5)),
            _chip('Kalan taksit', remaining, AppColors.primaryDark, const Color(0xFFEFBFD0), const Color(0xFFFFF4F8)),
            if (overdue > 0.005)
              _chip('Gecikmiş', overdue, const Color(0xFF9F1239), const Color(0xFFFDA4AF), const Color(0xFFFFF1F2)),
          ],
        ),
        const SizedBox(height: 10),
        SizedBox(
          height: 78,
          child: ListView.separated(
            controller: _scroll,
            scrollDirection: Axis.horizontal,
            itemCount: widget.cells.length,
            separatorBuilder: (_, _) => const SizedBox(width: _gap),
            itemBuilder: (_, i) {
              final c = widget.cells[i];
              final s = _style(c.status);
              final isToday = c.key == widget.todayKey;
              // Yıl etiketi yalnız ilk sütunda ve yıl değişiminde — 24 aylık planda "Oca"
              // hangi yılın ocağı sorusu ortaya çıkıyordu.
              final showYear = i == 0 || c.year != widget.cells[i - 1].year;
              return Container(
                width: _cellWidth,
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
                decoration: BoxDecoration(
                  color: s.bg,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: isToday ? AppColors.primary : s.border,
                    width: isToday ? 2 : 1,
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        Text(
                          CalendarText.months[c.month - 1].substring(0, 3),
                          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: AppColors.ink),
                        ),
                        if (showYear) ...[
                          const SizedBox(width: 3),
                          Text('${c.year}',
                              style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: AppColors.primaryDark)),
                        ],
                        const Spacer(),
                        // Renkten BAĞIMSIZ durum işareti (renk körlüğü).
                        Text(s.mark, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: s.ink)),
                      ],
                    ),
                    const SizedBox(height: 3),
                    if (c.due > 0) ...[
                      Text(
                        CalendarText.tl(c.remaining > 0.005 ? c.remaining : c.due),
                        style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: s.ink),
                      ),
                      Text(
                        c.status == 'paid'
                            ? 'ödendi'
                            : c.status == 'partial'
                                ? '${CalendarText.tl(c.paid)} ödendi'
                                : c.status == 'overdue'
                                    ? 'gecikmiş'
                                    : 'bekliyor',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 9, color: AppColors.muted),
                      ),
                    ] else
                      const Text('taksit yok', style: TextStyle(fontSize: 10, color: AppColors.muted)),
                    if (isToday)
                      const Text('BU AY',
                          style: TextStyle(fontSize: 8, fontWeight: FontWeight.w900, color: AppColors.primary)),
                  ],
                ),
              );
            },
          ),
        ),
        const SizedBox(height: 8),
        Wrap(spacing: 10, runSpacing: 4, children: [
          _legend(const Color(0xFFA7F3D0), 'Ödendi'),
          _legend(const Color(0xFFFCD34D), 'Kısmi'),
          _legend(const Color(0xFFFDA4AF), 'Gecikmiş'),
          _legend(const Color(0xFFE3D2DA), 'Bekleyen'),
        ]),
      ],
    );
  }

  Widget _chip(String label, double value, Color ink, Color border, Color bg) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: border),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Text('$label ', style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: ink)),
          Text(CalendarText.tl(value),
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: ink)),
        ]),
      );

  Widget _legend(Color c, String text) => Row(mainAxisSize: MainAxisSize.min, children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(3)),
        ),
        const SizedBox(width: 4),
        Text(text, style: const TextStyle(fontSize: 10, color: AppColors.muted)),
      ]);
}
