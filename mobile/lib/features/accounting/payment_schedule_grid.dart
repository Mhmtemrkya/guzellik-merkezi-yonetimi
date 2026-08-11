import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme/app_theme.dart';
import '../appointments/calendar_theme.dart';
import 'account_grouping.dart';

/// TAKSİT TAKVİMİ — web `PaymentScheduleGrid` paritesi, Excel hücre mantığı.
///
/// Satır = vade. Beş sütun: **Tarih · Planlanan Miktar · Ödenen Taksit · Kalan · Durum**.
/// Renk kuralı: ödendi YEŞİL · bekliyor SARI · vadesi geçtiyse KIRMIZI.
/// RENK TEK BAŞINA ANLAM TAŞIMAZ — "Durum" sütununda yazılı karşılığı da var.
///
/// DEVİR (düzensiz ödeme): ödenmeyen ayın borcu sonraki ayın taksitinin üstüne biner.
/// "Planlanan Miktar" hücresi PLAN tutarını yazar, altında devreden varsa "+X devir → Y"
/// satırıyla o ay gerçekten ödenmesi gereken tutarı gösterir; "Kalan" ise bir sonraki aya
/// devredecek tutardır. Hesap `account_grouping.dart` + `account_installments.dart` içinde.
class PaymentScheduleGrid extends StatefulWidget {
  const PaymentScheduleGrid({required this.cells, required this.todayKey, super.key});

  final List<MonthCell> cells;

  /// `YYYY-MM` — içinde bulunulan ayın satırını vurgulamak ve oraya kaydırmak için.
  final String todayKey;

  @override
  State<PaymentScheduleGrid> createState() => _PaymentScheduleGridState();
}

class _PaymentScheduleGridState extends State<PaymentScheduleGrid> {
  final _scroll = ScrollController();
  static const _rowHeight = 58.0;

  /// Vadesi olan aylar; taksitsiz aylar satır üretmez (sütun ızgarasında süreklilik için
  /// duruyorlardı, satır tablosunda yalnız gürültü olurlardı).
  List<MonthCell> get _rows =>
      widget.cells.where((c) => c.installmentCount > 0).toList();

  @override
  void initState() {
    super.initState();
    // Açılışta "bu ay" satırına kaydır: 24 aylık planda kullanıcı her seferinde elle arıyordu.
    WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToToday());
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _scrollToToday() {
    if (!_scroll.hasClients) return;
    final idx = _rows.indexWhere((c) => c.key == widget.todayKey);
    if (idx < 0) return;
    final target = (idx * _rowHeight) - 80;
    _scroll.jumpTo(target.clamp(0, _scroll.position.maxScrollExtent));
  }

  ({Color bg, Color ink, String label}) _style(String status) {
    switch (status) {
      case 'paid':
        return (bg: const Color(0xFFECFDF5), ink: const Color(0xFF065F46), label: 'Ödendi');
      case 'partial':
        return (bg: const Color(0xFFFFFBEB), ink: const Color(0xFF92400E), label: 'Kısmi');
      case 'overdue':
        return (bg: const Color(0xFFFFF1F2), ink: const Color(0xFF9F1239), label: 'Gecikti');
      case 'upcoming':
        return (bg: const Color(0xFFFFFBEB), ink: const Color(0xFF92400E), label: 'Bekliyor');
      default:
        return (bg: Colors.white, ink: AppColors.muted, label: '—');
    }
  }

  static String _fmtDue(MonthCell c) {
    final iso = c.firstDueDate;
    if (iso == null || iso.isEmpty) {
      return DateFormat('MMM yyyy', 'tr_TR').format(DateTime(c.year, c.month));
    }
    final d = DateTime.tryParse(iso);
    if (d == null) return iso;
    return DateFormat('d MMM yyyy', 'tr_TR').format(d);
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    if (rows.isEmpty) {
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

    final totalDue = rows.fold<double>(0, (s, c) => s + c.due);
    final totalPaid = rows.fold<double>(0, (s, c) => s + c.paid);
    final totalRemaining = rows.fold<double>(0, (s, c) => s + c.remaining);

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
              _totalRow(rows.length, totalDue, totalPaid, totalRemaining),
            ],
          ),
        ),
        const SizedBox(height: 8),
        const Wrap(
          spacing: 12,
          children: [
            _Legend(color: Color(0xFFECFDF5), border: Color(0xFFA7F3D0), text: 'Ödendi'),
            _Legend(color: Color(0xFFFFFBEB), border: Color(0xFFFCD34D), text: 'Bekliyor'),
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
            Expanded(flex: 26, child: _Head('Tarih')),
            Expanded(flex: 24, child: _Head('Planlanan', right: true)),
            Expanded(flex: 20, child: _Head('Ödenen', right: true)),
            Expanded(flex: 20, child: _Head('Kalan', right: true)),
            Expanded(flex: 20, child: _Head('Durum', center: true)),
          ],
        ),
      );

  Widget _dataRow(MonthCell c) {
    final s = _style(c.status);
    final isThisMonth = c.key == widget.todayKey;
    return Container(
      decoration: BoxDecoration(
        color: s.bg,
        border: Border(
          top: const BorderSide(color: Color(0xFFF0DCE5)),
          left: isThisMonth
              ? const BorderSide(color: AppColors.primaryDark, width: 2.5)
              : BorderSide.none,
        ),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 26,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_fmtDue(c),
                    style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                Text(
                    isThisMonth
                        ? 'bu ay'
                        : (c.installmentCount > 1 ? '${c.installmentCount} taksit' : ''),
                    style: const TextStyle(fontSize: 9.5, color: AppColors.muted)),
              ],
            ),
          ),
          Expanded(
            flex: 24,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(CalendarText.tl(c.due),
                    style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                // DEVİR: önceki ayların borcu bu ayın üstüne biner.
                if (c.carryIn > 0.005)
                  Text('+${CalendarText.tl(c.carryIn)} → ${CalendarText.tl(c.expected)}',
                      style: const TextStyle(
                          fontSize: 9.5,
                          fontWeight: FontWeight.w700,
                          color: Color(0xFF9F1239))),
              ],
            ),
          ),
          Expanded(
            flex: 20,
            child: Text(c.paid > 0.005 ? CalendarText.tl(c.paid) : '—',
                textAlign: TextAlign.right,
                style: const TextStyle(fontSize: 11.5, color: Color(0xFF065F46))),
          ),
          Expanded(
            flex: 20,
            child: Text(CalendarText.tl(c.outstanding),
                textAlign: TextAlign.right,
                style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w800,
                    color: c.outstanding > 0.005
                        ? AppColors.primaryDark
                        : const Color(0xFF065F46))),
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

  Widget _totalRow(int count, double due, double paid, double remaining) => Container(
        color: const Color(0xFFFFF7FA),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        child: Row(
          children: [
            const Expanded(
                flex: 26,
                child: Text('TOPLAM',
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800))),
            Expanded(
                flex: 24,
                child: Text(CalendarText.tl(due),
                    textAlign: TextAlign.right,
                    style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800))),
            Expanded(
                flex: 20,
                child: Text(CalendarText.tl(paid),
                    textAlign: TextAlign.right,
                    style: const TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w800,
                        color: Color(0xFF065F46)))),
            Expanded(
                flex: 20,
                child: Text(CalendarText.tl(remaining),
                    textAlign: TextAlign.right,
                    style: const TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w800,
                        color: AppColors.primaryDark))),
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
