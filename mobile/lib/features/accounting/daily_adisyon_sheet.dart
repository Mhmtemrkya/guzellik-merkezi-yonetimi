import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../appointments/calendar_theme.dart';

/// Günlük adisyon kartı — gün içinde kime ne yapıldı (saatli), kim yaptı ve tahsilatlar.
/// Web `DailyAdisyonModal` karşılığı: KPI'lar dün karşılaştırmalı, tür/personel/arama
/// filtreleri ve altta Gün Sonu Özeti. Randevu ve Ön Muhasebe ekranlarından açılır.
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
  Map<String, dynamic>? _prev; // dün — KPI delta karşılaştırması
  bool _busy = false;
  int? _typeFilter; // null => tümü
  String? _staffFilter;
  String _search = '';

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
      final prevStart = start.subtract(const Duration(days: 1));
      final results = await Future.wait([
        widget.api.get('/api/admin/adisyonlar/daily', query: {
          'fromUtc': start.toUtc().toIso8601String(),
          'toUtc': end.toUtc().toIso8601String(),
        }),
        widget.api.get('/api/admin/adisyonlar/daily', query: {
          'fromUtc': prevStart.toUtc().toIso8601String(),
          'toUtc': start.toUtc().toIso8601String(),
        }).catchError((_) => const <String, dynamic>{}),
      ]);
      if (mounted) {
        setState(() {
          _data = results[0] is Map ? (results[0] as Map).cast<String, dynamic>() : null;
          _prev = results[1] is Map ? (results[1] as Map).cast<String, dynamic>() : null;
        });
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
    return '${_day.day} ${CalendarText.months[_day.month - 1]}, ${days[_day.weekday - 1]}';
  }

  String _time(String? iso) {
    if (iso == null || iso.isEmpty) return '—';
    final d = DateTime.tryParse(iso)?.toLocal();
    if (d == null) return '—';
    return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  double _num(Map<String, dynamic>? m, String key) => ((m?[key] as num?) ?? 0).toDouble();

  /// Yüzde delta (dün'e göre); dün 0 ise null.
  int? _pct(double cur, double prev) => prev == 0 ? null : (((cur - prev) / prev) * 100).round();

  List<Map<String, dynamic>> get _rows =>
      ((_data?['rows'] as List?) ?? const []).map((r) => (r as Map).cast<String, dynamic>()).toList();

  List<Map<String, dynamic>> get _filteredRows {
    final q = _search.trim().toLowerCase();
    return _rows.where((r) {
      if (_typeFilter != null && (r['type'] as num?)?.toInt() != _typeFilter) return false;
      if (_staffFilter != null && '${r['staffMemberId']}' != _staffFilter) return false;
      if (q.isNotEmpty) {
        final hay = '${r['customerName'] ?? ''} ${r['description'] ?? ''} ${r['staffName'] ?? ''}'.toLowerCase();
        if (!hay.contains(q)) return false;
      }
      return true;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final rows = _filteredRows;
    final charge = _num(d, 'chargeTotal');
    final payment = _num(d, 'paymentTotal');
    final kalan = (charge - payment).clamp(0, double.infinity).toDouble();
    final prevCharge = _num(_prev, 'chargeTotal');
    final prevPayment = _num(_prev, 'paymentTotal');
    final prevKalan = (prevCharge - prevPayment).clamp(0, double.infinity).toDouble();

    // Gün sonu özeti — tür bazlı dökümler (filtreden bağımsız, günün tamamı)
    double product = 0, service = 0, discount = 0;
    for (final r in _rows) {
      final t = (r['type'] as num?)?.toInt() ?? 3;
      final a = ((r['amount'] as num?) ?? 0).toDouble();
      if (t == 1) {
        product += a;
      } else if (t == 0 || t == 6 || t == 3) {
        service += a;
      } else if (t == 5) {
        discount += a;
      }
    }

    // Personel filtresi seçenekleri
    final staffMap = <String, String>{};
    for (final r in _rows) {
      final id = '${r['staffMemberId'] ?? ''}';
      final name = '${r['staffName'] ?? ''}';
      if (id.isNotEmpty && id != 'null' && name.isNotEmpty) staffMap[id] = name;
    }
    final typeSet = _rows.map((r) => (r['type'] as num?)?.toInt() ?? 3).toSet();

    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.92),
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
                        const Text('GÜNLÜK ADİSYON KARTI',
                            style: TextStyle(fontSize: 11, letterSpacing: 1.4, color: AppColors.primaryDark, fontWeight: FontWeight.w700)),
                        Row(
                          children: [
                            Flexible(
                              child: Text(_dateLabel(), maxLines: 1, overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                            ),
                            if (_isToday)
                              Container(
                                margin: const EdgeInsets.only(left: 8),
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(color: AppColors.rose, borderRadius: BorderRadius.circular(12)),
                                child: const Text('Bugün',
                                    style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: AppColors.primaryDark)),
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  IconButton(onPressed: _busy ? null : () => _shift(-1), icon: const Icon(Icons.chevron_left_rounded)),
                  TextButton(
                    onPressed: _busy || _isToday
                        ? null
                        : () {
                            final n = DateTime.now();
                            setState(() => _day = DateTime(n.year, n.month, n.day));
                            _load();
                          },
                    child: const Text('Bugün', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                  ),
                  IconButton(onPressed: _busy ? null : () => _shift(1), icon: const Icon(Icons.chevron_right_rounded)),
                  IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close_rounded)),
                ],
              ),
            ),
            // KPI şeridi — dün karşılaştırmalı, yatay kaydırılır
            SizedBox(
              height: 84,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                children: [
                  _kpi('İşlem', '${d?['serviceCount'] ?? 0}', 'Dün: ${_prev?['serviceCount'] ?? 0}',
                      _pct(_num(d, 'serviceCount'), _num(_prev, 'serviceCount')), AppColors.primaryDark),
                  _kpi('Danışan', '${d?['customerCount'] ?? 0}', 'Dün: ${_prev?['customerCount'] ?? 0}',
                      _pct(_num(d, 'customerCount'), _num(_prev, 'customerCount')), const Color(0xFF2F5FA6)),
                  _kpi('Ciro', CalendarText.tl(charge), 'Dün: ${CalendarText.tl(prevCharge)}',
                      _pct(charge, prevCharge), AppColors.ink),
                  _kpi('Tahsilat', CalendarText.tl(payment), 'Dün: ${CalendarText.tl(prevPayment)}',
                      _pct(payment, prevPayment), const Color(0xFF2A7A50)),
                  _kpi('Kalan / Bakiye', CalendarText.tl(kalan), 'Dün: ${CalendarText.tl(prevKalan)}',
                      _pct(kalan, prevKalan), const Color(0xFFD34D68), invertDelta: true),
                ],
              ),
            ),
            // Filtre satırı
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
              child: Row(
                children: [
                  Expanded(
                    child: SizedBox(
                      height: 38,
                      child: TextField(
                        onChanged: (v) => setState(() => _search = v),
                        decoration: InputDecoration(
                          hintText: 'Müşteri, işlem veya not ara…',
                          hintStyle: const TextStyle(fontSize: 12.5, color: AppColors.muted),
                          prefixIcon: const Icon(Icons.search_rounded, size: 18, color: AppColors.muted),
                          isDense: true,
                          contentPadding: EdgeInsets.zero,
                          filled: true,
                          fillColor: AppColors.surfaceSoft,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: const BorderSide(color: AppColors.border),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: const BorderSide(color: AppColors.border),
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  _filterChip<int?>(
                    label: _typeFilter == null ? 'Tür' : (_typeLabels[_typeFilter] ?? 'Tür'),
                    active: _typeFilter != null,
                    items: [
                      const PopupMenuItem<int?>(value: -1, child: Text('Tümü')),
                      for (final t in typeSet)
                        PopupMenuItem<int?>(value: t, child: Text(_typeLabels[t] ?? 'Kalem')),
                    ],
                    onSelected: (v) => setState(() => _typeFilter = v == -1 ? null : v),
                  ),
                  const SizedBox(width: 6),
                  _filterChip<String?>(
                    label: _staffFilter == null ? 'Personel' : (staffMap[_staffFilter] ?? 'Personel'),
                    active: _staffFilter != null,
                    items: [
                      const PopupMenuItem<String?>(value: '', child: Text('Tümü')),
                      for (final e in staffMap.entries)
                        PopupMenuItem<String?>(value: e.key, child: Text(e.value)),
                    ],
                    onSelected: (v) => setState(() => _staffFilter = (v == null || v.isEmpty) ? null : v),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            // Zaman çizelgesi
            Flexible(
              child: _busy && d == null
                  ? const SizedBox(height: 200, child: Center(child: CircularProgressIndicator()))
                  : rows.isEmpty
                      ? Padding(
                          padding: const EdgeInsets.symmetric(vertical: 48),
                          child: Center(
                              child: Text(
                            _rows.isEmpty ? 'Bu gün için işlem yok.' : 'Filtrelere uyan işlem yok.',
                            style: const TextStyle(color: AppColors.muted),
                          )),
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                          itemCount: rows.length,
                          itemBuilder: (_, i) => _row(rows[i]),
                        ),
            ),
            // Gün Sonu Özeti
            Container(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
              decoration: const BoxDecoration(
                color: AppColors.surfaceSoft,
                border: Border(top: BorderSide(color: AppColors.border)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.insights_rounded, size: 16, color: AppColors.primary),
                      SizedBox(width: 6),
                      Text('Gün Sonu Özeti', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      _sumStat('Toplam Ciro', CalendarText.tl(charge), AppColors.primaryDark),
                      _sumStat('Tahsilat', CalendarText.tl(payment), const Color(0xFF2A7A50)),
                      _sumStat('Ürün', CalendarText.tl(product), const Color(0xFFC9852F)),
                      _sumStat('Hizmet', CalendarText.tl(service), const Color(0xFF2F5FA6)),
                      _sumStat('İndirim', CalendarText.tl(discount), const Color(0xFFD34D68)),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _filterChip<T>({
    required String label,
    required bool active,
    required List<PopupMenuEntry<T>> items,
    required void Function(T) onSelected,
  }) {
    return PopupMenuButton<T>(
      itemBuilder: (_) => items,
      onSelected: onSelected,
      child: Container(
        height: 38,
        padding: const EdgeInsets.symmetric(horizontal: 10),
        decoration: BoxDecoration(
          color: active ? AppColors.rose : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: active ? AppColors.primary : AppColors.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(label,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: active ? AppColors.primaryDark : AppColors.muted,
                )),
            const Icon(Icons.arrow_drop_down_rounded, size: 18, color: AppColors.muted),
          ],
        ),
      ),
    );
  }

  Widget _kpi(String label, String value, String prevText, int? delta, Color color, {bool invertDelta = false}) {
    final good = delta != null && (invertDelta ? delta < 0 : delta > 0);
    return Container(
      width: 132,
      margin: const EdgeInsets.symmetric(horizontal: 4),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, maxLines: 1, overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 10, color: AppColors.muted, fontWeight: FontWeight.w600)),
          const SizedBox(height: 2),
          Row(
            children: [
              Flexible(
                child: Text(value, maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5, color: color)),
              ),
              if (delta != null && delta != 0) ...[
                const SizedBox(width: 4),
                Icon(delta > 0 ? Icons.trending_up_rounded : Icons.trending_down_rounded,
                    size: 13, color: good ? const Color(0xFF2A7A50) : const Color(0xFFD34D68)),
                Text('%${delta.abs()}',
                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800,
                        color: good ? const Color(0xFF2A7A50) : const Color(0xFFD34D68))),
              ],
            ],
          ),
          const SizedBox(height: 1),
          Text(prevText, maxLines: 1, overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 9.5, color: AppColors.muted)),
        ],
      ),
    );
  }

  Widget _sumStat(String label, String value, Color color) => Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, maxLines: 1, overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 9.5, color: AppColors.muted)),
            Text(value, maxLines: 1, overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: color)),
          ],
        ),
      );

  Widget _row(Map<String, dynamic> r) {
    final type = (r['type'] as num?)?.toInt() ?? 3;
    final isPayment = type == 4;
    final isDiscount = type == 5;
    final isPackageUse = type == 2;
    final amount = (r['amount'] as num?)?.toDouble() ?? 0;
    // adisyonStatus: 0=Open, 1=Approved/kapali (enum integer gelir)
    final statusRaw = r['adisyonStatus'];
    final isOpen = statusRaw is num ? statusRaw.toInt() == 0 : '$statusRaw'.toLowerCase() == 'open';
    final dot = isPayment
        ? const Color(0xFF2A7A50)
        : isDiscount
            ? const Color(0xFFD34D68)
            : AppColors.primary;
    final amountText = isPackageUse
        ? 'paket'
        : '${isDiscount ? '−' : ''}${CalendarText.tl(amount)}';
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          SizedBox(width: 38, child: Text(_time('${r['occurredAtUtc']}'),
              style: const TextStyle(fontSize: 11, color: AppColors.muted))),
          Container(width: 10, height: 10, margin: const EdgeInsets.symmetric(horizontal: 8),
              decoration: BoxDecoration(color: dot, shape: BoxShape.circle)),
          Expanded(
            child: Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.white,
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
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(amountText, style: TextStyle(fontWeight: FontWeight.w800, color: dot)),
                      const SizedBox(height: 2),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: isOpen ? const Color(0xFFFDEFE0) : const Color(0xFFEAF7EF),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(isOpen ? 'Açık' : 'Tamamlandı',
                            style: TextStyle(fontSize: 8.5, fontWeight: FontWeight.w700,
                                color: isOpen ? const Color(0xFFC9852F) : const Color(0xFF2A7A50))),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
