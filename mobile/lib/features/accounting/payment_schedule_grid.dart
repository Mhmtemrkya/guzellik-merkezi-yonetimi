import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme/app_theme.dart';
import '../appointments/calendar_theme.dart';
import 'account_grouping.dart';

/// TAKSİT TAKVİMİ — web `PaymentScheduleGrid` paritesi.
///
/// Satır = VADE GÜNÜ (ay değil). Dört sütun: **Tarih · Planlanan · Ödenen · Durum**.
/// Renk kuralı: ödendi YEŞİL · bekliyor SARI · vadesi geçtiyse KIRMIZI.
/// RENK TEK BAŞINA ANLAM TAŞIMAZ — "Durum" sütununda yazılı karşılığı da var.
///
/// AYNI GÜN TOPLANIR: 12.08'de bir pakette 5.000, başkasında 2.000 taksit varsa o gün tek
/// satırda 7.000 yazar; kaynak dökümü satırın altında ("Tümü" görünümünde).
///
/// "Kalan" sütunu ve devir (carry) KALDIRILDI — devir aylık ızgaraya özeldi ve tahsilat hesap
/// havuzundan dağıtıldığı için birden çok satışı birleştiren bu listede tanımsız kalıyordu.
class PaymentScheduleGrid extends StatefulWidget {
  const PaymentScheduleGrid({
    required this.rows,
    required this.todayIso,
    this.showSources = true,
    super.key,
  });

  final List<DueDateRow> rows;

  /// `YYYY-MM-DD` yerel bugün — sıradaki vadeyi vurgulamak ve oraya kaydırmak için.
  final String todayIso;

  /// Kaynak dökümü ("hangi satıştan") gösterilsin mi — tek satış seçiliyken gereksiz.
  final bool showSources;

  @override
  State<PaymentScheduleGrid> createState() => _PaymentScheduleGridState();
}

class _PaymentScheduleGridState extends State<PaymentScheduleGrid> {
  final _scroll = ScrollController();
  static const _rowHeight = 58.0;

  @override
  void initState() {
    super.initState();
    // Açılışta odak satırına kaydır: uzun planda kullanıcı her seferinde elle arıyordu.
    WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToFocus());
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  /// ODAK: bugünden itibaren ilk vade. Tarih listesinde bugünün kendi satırı olmayabilir.
  String get _focusDate {
    for (final r in widget.rows) {
      if (r.date.compareTo(widget.todayIso) >= 0) return r.date;
    }
    return widget.rows.isEmpty ? '' : widget.rows.last.date;
  }

  void _scrollToFocus() {
    if (!_scroll.hasClients) return;
    final idx = widget.rows.indexWhere((r) => r.date == _focusDate);
    if (idx < 0) return;
    final target = (idx * _rowHeight) - 80;
    _scroll.jumpTo(target.clamp(0, _scroll.position.maxScrollExtent));
  }

  /// Durum → zemin/mürekkep/etiket.
  ///
  /// "Gecikti" sözü ve kırmızı YALNIZ `overdue`da: o da toleransı uygulayan kanonik bayrak
  /// (bkz. `account_installments.graceDeadline`). Vadesi geçmiş ama tolerans penceresi süren
  /// gün `grace` ile "Vadesi geçti" yazar — görünür kalır, resmen gecikmiş ilan edilmez.
  ({Color bg, Color ink, String label}) _style(String status) {
    switch (status) {
      case 'paid':
        return (bg: const Color(0xFFECFDF5), ink: const Color(0xFF065F46), label: 'Ödendi');
      case 'overdue':
        return (bg: const Color(0xFFFFF1F2), ink: const Color(0xFF9F1239), label: 'Gecikti');
      case 'grace':
        return (bg: const Color(0xFFFEF3C7), ink: const Color(0xFF92400E), label: 'Vadesi geçti');
      case 'partial':
        return (bg: const Color(0xFFFFFBEB), ink: const Color(0xFF92400E), label: 'Kısmi');
      case 'upcoming':
        return (bg: const Color(0xFFFFFBEB), ink: const Color(0xFF92400E), label: 'Bekliyor');
      default:
        return (bg: Colors.white, ink: AppColors.muted, label: '—');
    }
  }

  /// "2026-08-12" → "12 Ağu 2026".
  static String _fmtDue(String iso) {
    final d = DateTime.tryParse(iso);
    if (d == null) return iso;
    return DateFormat('d MMM yyyy', 'tr_TR').format(d);
  }

  @override
  Widget build(BuildContext context) {
    final rows = widget.rows;
    if (rows.isEmpty) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 26, horizontal: 14),
        decoration: BoxDecoration(
          color: const Color(0xFFFFFAFB),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.border),
        ),
        child: const Text('Bu seçimde taksit planı yok — satış peşin.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: AppColors.muted)),
      );
    }

    final totalDue = rows.fold<double>(0, (s, r) => s + r.due);
    final totalPaid = rows.fold<double>(0, (s, r) => s + r.paid);
    final totalRemaining = rows.fold<double>(0, (s, r) => s + r.remaining);
    // "Gecikmiş" YALNIZ kanonik satırları sayar → cari kartındaki gecikme tutarıyla birebir.
    // Tolerans penceresi süren günler ayrı çipte yazılır (web ile aynı kural).
    final totalOverdue = rows
        .where((r) => r.status == 'overdue')
        .fold<double>(0, (s, r) => s + r.remaining);
    final totalGrace =
        rows.where((r) => r.status == 'grace').fold<double>(0, (s, r) => s + r.remaining);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Özet: bu rakamlar YALNIZ taksitleri sayar (peşinat ve peşin satış taksit üretmez).
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            _chip('Taksit planı', totalDue, AppColors.ink),
            _chip('Tahsil edilen', totalPaid, const Color(0xFF065F46)),
            _chip('Kalan taksit', totalRemaining, AppColors.primaryDark),
            if (totalOverdue > 0.005) _chip('Gecikmiş', totalOverdue, const Color(0xFF9F1239)),
            if (totalGrace > 0.005) _chip('Vadesi geçti', totalGrace, const Color(0xFF92400E)),
          ],
        ),
        const SizedBox(height: 10),
        Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.border),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              _headerRow(),
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 360),
                child: ListView.builder(
                  controller: _scroll,
                  shrinkWrap: true,
                  physics: const ClampingScrollPhysics(),
                  itemCount: rows.length,
                  itemBuilder: (_, index) => _dataRow(rows[index]),
                ),
              ),
              _totalRow(rows.length, totalDue, totalPaid),
            ],
          ),
        ),
        const SizedBox(height: 8),
        const Wrap(
          spacing: 12,
          children: [
            _Legend(color: Color(0xFFECFDF5), border: Color(0xFFA7F3D0), text: 'Ödendi'),
            _Legend(color: Color(0xFFFFFBEB), border: Color(0xFFFCD34D), text: 'Bekliyor'),
            _Legend(color: Color(0xFFFEF3C7), border: Color(0xFFF59E0B), text: 'Vadesi geçti'),
            _Legend(color: Color(0xFFFFF1F2), border: Color(0xFFFDA4AF), text: 'Gecikti'),
          ],
        ),
      ],
    );
  }

  Widget _chip(String label, double value, Color ink) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.border),
        ),
        child: Text('$label · ${CalendarText.tl(value)}',
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: ink)),
      );

  Widget _headerRow() => Container(
        color: const Color(0xFFFFF7FA),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
        child: Row(
          children: const [
            Expanded(flex: 30, child: _Head('Tarih')),
            Expanded(flex: 30, child: _Head('Planlanan', right: true)),
            Expanded(flex: 22, child: _Head('Ödenen', right: true)),
            Expanded(flex: 20, child: _Head('Durum', center: true)),
          ],
        ),
      );

  Widget _dataRow(DueDateRow r) {
    final s = _style(r.status);
    final isFocus = r.date == _focusDate;
    final isToday = r.date == widget.todayIso;
    final note = [
      if (isToday) 'bugün',
      if (r.installmentCount > 1) '${r.installmentCount} taksit birleşti',
    ].join(' · ');

    return Container(
      decoration: BoxDecoration(
        color: s.bg,
        border: Border(
          top: const BorderSide(color: Color(0xFFF0DCE5)),
          left: isFocus
              ? const BorderSide(color: AppColors.primaryDark, width: 2.5)
              : BorderSide.none,
        ),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 30,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_fmtDue(r.date),
                    style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                if (note.isNotEmpty)
                  Text(note, style: const TextStyle(fontSize: 9.5, color: AppColors.muted)),
              ],
            ),
          ),
          Expanded(
            flex: 30,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(CalendarText.tl(r.due),
                    style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                // KAYNAK DÖKÜMÜ: aynı güne birden çok satıştan taksit düştüyse hangisinden
                // ne kadar geldiği yazılır — yoksa toplam "nereden çıktı" sorusu kalırdı.
                if (widget.showSources && r.sources.length > 1)
                  ...r.sources.map((src) => Text(
                        '${CalendarText.tl(src.amount)} · ${src.label}',
                        textAlign: TextAlign.right,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 9.5, color: AppColors.muted),
                      )),
              ],
            ),
          ),
          Expanded(
            flex: 22,
            child: Text(r.paid > 0.005 ? CalendarText.tl(r.paid) : '—',
                textAlign: TextAlign.right,
                style: const TextStyle(fontSize: 11.5, color: Color(0xFF065F46))),
          ),
          Expanded(
            flex: 20,
            child: Text(s.label,
                textAlign: TextAlign.center,
                style: TextStyle(
                    fontSize: 10, fontWeight: FontWeight.w800, color: s.ink)),
          ),
        ],
      ),
    );
  }

  Widget _totalRow(int count, double due, double paid) => Container(
        color: const Color(0xFFFFF7FA),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        child: Row(
          children: [
            const Expanded(
                flex: 30,
                child: Text('TOPLAM',
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800))),
            Expanded(
                flex: 30,
                child: Text(CalendarText.tl(due),
                    textAlign: TextAlign.right,
                    style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800))),
            Expanded(
                flex: 22,
                child: Text(CalendarText.tl(paid),
                    textAlign: TextAlign.right,
                    style: const TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w800,
                        color: Color(0xFF065F46)))),
            Expanded(
                flex: 20,
                child: Text('$count vade',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 10, color: AppColors.muted))),
          ],
        ),
      );
}

class _Head extends StatelessWidget {
  const _Head(this.text, {this.right = false, this.center = false});
  final String text;
  final bool right;
  final bool center;

  @override
  Widget build(BuildContext context) => Text(
        text,
        textAlign: right
            ? TextAlign.right
            : center
                ? TextAlign.center
                : TextAlign.left,
        style: const TextStyle(
            fontSize: 10, fontWeight: FontWeight.w800, color: AppColors.primaryDark),
      );
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.border, required this.text});
  final Color color;
  final Color border;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(3),
              border: Border.all(color: border),
            ),
          ),
          const SizedBox(width: 5),
          Text(text, style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
        ],
      );
}
