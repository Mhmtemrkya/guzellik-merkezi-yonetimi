import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../appointments/calendar_theme.dart';

/// Günlük adisyon kartı — gün içinde kime ne yapıldı (saatli), kim yaptı ve tahsilatlar.
/// Web `DailyAdisyonModal` karşılığı. Randevu ve Ön Muhasebe ekranlarından açılır.
class DailyAdisyonSheet extends StatefulWidget {
  const DailyAdisyonSheet({required this.api, this.initialDate, super.key});
  final ApiClient api;
  final DateTime? initialDate;

  @override
  State<DailyAdisyonSheet> createState() => _DailyAdisyonSheetState();
}

class _DailyAdisyonSheetState extends State<DailyAdisyonSheet> {
  late DateTime _day;
  Map<String, dynamic>? _data;
  bool _busy = false;

  // Enum (int) → etiket. Backend'de global string converter yok → tip integer gelir.
  static const _typeLabels = {
    0: 'Hizmet', 1: 'Ürün', 2: 'Paketten', 3: 'Ek', 4: 'Tahsilat', 5: 'İndirim', 6: 'Paket satışı',
  };

  @override
  void initState() {
    super.initState();
    final n = widget.initialDate ?? DateTime.now();
    _day = DateTime(n.year, n.month, n.day);
    _load();
  }

  Future<void> _load() async {
    setState(() => _busy = true);
    try {
      final start = _day;
      final end = start.add(const Duration(days: 1));
      final data = await widget.api.get('/api/admin/adisyonlar/daily', query: {
        'fromUtc': start.toUtc().toIso8601String(),
        'toUtc': end.toUtc().toIso8601String(),
      });
      if (mounted && data is Map) {
        setState(() => _data = data.cast<String, dynamic>());
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _shift(int days) {
    setState(() => _day = _day.add(Duration(days: days)));
    _load();
  }

  bool get _isToday {
    final t = DateTime.now();
    return _day.year == t.year && _day.month == t.month && _day.day == t.day;
  }

  String _dateLabel() {
    const days = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
    const months = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    return '${days[_day.weekday - 1]}, ${_day.day} ${months[_day.month - 1]}';
  }

  String _time(String? iso) {
    if (iso == null || iso.isEmpty) return '—';
    final d = DateTime.tryParse(iso)?.toLocal();
    if (d == null) return '—';
    return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final rows = (d?['rows'] as List? ?? const []);
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.9),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Başlık + tarih nav
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 12, 6),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('GÜNLÜK ADİSYON',
                            style: TextStyle(fontSize: 11, letterSpacing: 1.4, color: AppColors.primaryDark, fontWeight: FontWeight.w700)),
                        Text('${_dateLabel()}${_isToday ? '  · Bugün' : ''}',
                            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                      ],
                    ),
                  ),
                  IconButton(onPressed: _busy ? null : () => _shift(-1), icon: const Icon(Icons.chevron_left_rounded)),
                  IconButton(onPressed: _busy ? null : () => _shift(1), icon: const Icon(Icons.chevron_right_rounded)),
                  IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close_rounded)),
                ],
              ),
            ),
            // KPI şeridi
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  _kpi('İşlem', '${d?['serviceCount'] ?? 0}', AppColors.primaryDark),
                  _kpi('Danışan', '${d?['customerCount'] ?? 0}', const Color(0xFF2F5FA6)),
                  _kpi('Ciro', CalendarText.tl((d?['chargeTotal'] as num?)?.toDouble()), AppColors.ink),
                  _kpi('Tahsilat', CalendarText.tl((d?['paymentTotal'] as num?)?.toDouble()), const Color(0xFF2A7A50)),
                ],
              ),
            ),
            const SizedBox(height: 8),
            const Divider(height: 1),
            // Zaman çizelgesi
            Flexible(
              child: _busy && d == null
                  ? const SizedBox(height: 200, child: Center(child: CircularProgressIndicator()))
                  : rows.isEmpty
                      ? const Padding(
                          padding: EdgeInsets.symmetric(vertical: 48),
                          child: Center(child: Text('Bu gün için işlem yok.', style: TextStyle(color: AppColors.muted))),
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.fromLTRB(16, 10, 16, 20),
                          itemCount: rows.length,
                          itemBuilder: (_, i) {
                            final r = (rows[i] as Map).cast<String, dynamic>();
                            return _row(r);
                          },
                        ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _kpi(String label, String value, Color color) => Expanded(
        child: Column(
          children: [
            Text(label, style: const TextStyle(fontSize: 10, color: AppColors.muted)),
            const SizedBox(height: 2),
            Text(value, maxLines: 1, overflow: TextOverflow.ellipsis,
                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: color)),
          ],
        ),
      );

  Widget _row(Map<String, dynamic> r) {
    final type = (r['type'] as num?)?.toInt() ?? 3;
    final isPayment = type == 4;
    final isDiscount = type == 5;
    final isPackageUse = type == 2;
    final amount = (r['amount'] as num?)?.toDouble() ?? 0;
    final dot = isPayment
        ? const Color(0xFF2A7A50)
        : isDiscount
            ? const Color(0xFFD34D68)
            : AppColors.primary;
    final amountText = isPackageUse
        ? 'paket'
        : '${isPayment ? '+' : isDiscount ? '−' : ''}${CalendarText.tl(amount)}';
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          SizedBox(width: 38, child: Text(_time('${r['occurredAtUtc']}'),
              style: const TextStyle(fontSize: 11, color: AppColors.muted, fontFeatures: []))),
          Container(width: 10, height: 10, margin: const EdgeInsets.symmetric(horizontal: 8),
              decoration: BoxDecoration(color: dot, shape: BoxShape.circle)),
          Expanded(
            child: Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.surfaceSoft,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                            decoration: BoxDecoration(color: dot.withValues(alpha: .12), borderRadius: BorderRadius.circular(6)),
                            child: Text(_typeLabels[type] ?? 'Kalem', style: TextStyle(fontSize: 9, color: dot, fontWeight: FontWeight.w700)),
                          ),
                          const SizedBox(width: 6),
                          Expanded(child: Text('${r['description'] ?? '—'}', maxLines: 1, overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5))),
                        ]),
                        const SizedBox(height: 2),
                        Text([
                          '${r['customerName'] ?? 'Müşteri'}',
                          if ((r['staffName'] ?? '').toString().isNotEmpty) '${r['staffName']}',
                        ].join(' · '), maxLines: 1, overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 11, color: AppColors.muted)),
                      ],
                    ),
                  ),
                  Text(amountText, style: TextStyle(fontWeight: FontWeight.w800, color: dot)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
