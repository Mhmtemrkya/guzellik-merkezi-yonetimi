import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/responsive.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import '../../shared/widgets/period_selector.dart';
import 'report_charts.dart';
import 'report_metric_info.dart';

/// RAPORLAR (mobil) — web `/admin/raporlar` sayfasının karşılığı.
///
/// 8 sekme: Genel Bakış · Paketler · Hizmetler · Personel · Şubeler · Müşteriler ·
/// Stok & Ürün · Hediye Çeki. Ortak filtre: dönem (gün/hafta/ay/yıl/özel aralık) +
/// karşılaştırma (önceki dönem / geçen yıl / 2 yıl önce / özel).
///
/// Veri `/api/admin/reports/*` uçlarından gelir; yalnız aktif sekmenin ucu çağrılır.
class ReportsScreen extends StatefulWidget {
  const ReportsScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

enum _Tab {
  overview,
  compare,
  packages,
  services,
  staff,
  branches,
  customers,
  inventory,
  giftCards,
}

/// (etiket, ikon, uç adı) — uç adı `/api/admin/reports/<ad>` olarak çağrılır.
const _tabMeta = <_Tab, (String, IconData, String)>{
  _Tab.overview: ('Genel Bakış', Icons.insights_rounded, 'summary'),
  _Tab.compare: ('Karşılaştırma', Icons.compare_arrows_rounded, 'compare'),
  _Tab.packages: ('Paketler', Icons.inventory_2_rounded, 'catalog'),
  _Tab.services: ('Hizmetler', Icons.auto_awesome_rounded, 'catalog'),
  _Tab.staff: ('Personel', Icons.badge_rounded, 'staff'),
  _Tab.branches: ('Şubeler', Icons.store_mall_directory_rounded, 'branches'),
  _Tab.customers: ('Müşteriler', Icons.groups_rounded, 'customers'),
  _Tab.inventory: ('Stok & Ürün', Icons.warehouse_rounded, 'inventory'),
  _Tab.giftCards: ('Hediye Çeki', Icons.card_giftcard_rounded, 'inventory'),
};

enum _Compare { none, previous, lastYear, twoYearsAgo, custom }

const _compareLabels = <_Compare, String>{
  _Compare.none: 'Karşılaştırma yok',
  _Compare.previous: 'Önceki dönem',
  _Compare.lastYear: 'Geçen yıl',
  _Compare.twoYearsAgo: '2 yıl önce',
  _Compare.custom: 'Özel dönem',
};

// --------------------------------------------------------------- yardımcılar ---

double _n(dynamic v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0;
int _i(dynamic v) => _n(v).round();
String _s(dynamic v) => v == null ? '' : '$v';

List<Map<String, dynamic>> _rows(dynamic v) => v is List
    ? v.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList()
    : const [];

Map<String, dynamic> _map(dynamic v) =>
    v is Map ? v.cast<String, dynamic>() : <String, dynamic>{};

/// Karşılaştırma sekmesindeki tek dönem (serbest aralık + kullanıcı etiketi).
class _Slot {
  _Slot(this.label, this.from, this.to);
  factory _Slot.year(int y) =>
      _Slot('$y', DateTime(y, 1, 1), DateTime(y + 1, 1, 1));

  String label;
  DateTime from;
  DateTime to;

  /// Uç biçimi: `<başlangıçISO>~<bitişISO>~<etiket>`
  String get param =>
      '${from.toUtc().toIso8601String()}~${to.toUtc().toIso8601String()}~$label';
}

const _maxSlots = 5;

class _ReportsScreenState extends State<ReportsScreen> {
  _Tab _tab = _Tab.overview;
  PeriodValue _period = PeriodValue(
    kind: PeriodKind.month,
    anchor: DateTime.now(),
  );
  _Compare _compare = _Compare.previous;
  DateTimeRange? _compareCustom;

  /// Karşılaştırma sekmesi kendi dönemlerini taşır; üst filtre çubuğuna bağlı değildir.
  final List<_Slot> _slots = [
    _Slot.year(DateTime.now().year),
    _Slot.year(DateTime.now().year - 1),
  ];

  late Future<Map<String, dynamic>> _future = _load();

  // ------------------------------------------------------------- dönem hesabı ---

  ({DateTime start, DateTime end}) get _range => _period.localRange();

  /// Kıyas penceresi — 'none' ise null.
  ({DateTime start, DateTime end})? get _compareRange {
    final r = _range;
    switch (_compare) {
      case _Compare.none:
        return null;
      case _Compare.previous:
        if (_period.kind != PeriodKind.custom) {
          return _period.shifted(-1).localRange();
        }
        // Özel aralıkta: eşit uzunlukta hemen önceki blok.
        final days = r.end.difference(r.start).inDays.clamp(1, 3650);
        return (start: r.start.subtract(Duration(days: days)), end: r.start);
      case _Compare.lastYear:
        return (
          start: DateTime(r.start.year - 1, r.start.month, r.start.day),
          end: DateTime(r.end.year - 1, r.end.month, r.end.day),
        );
      case _Compare.twoYearsAgo:
        return (
          start: DateTime(r.start.year - 2, r.start.month, r.start.day),
          end: DateTime(r.end.year - 2, r.end.month, r.end.day),
        );
      case _Compare.custom:
        final c = _compareCustom;
        if (c == null) return null;
        return (
          start: DateTime(c.start.year, c.start.month, c.start.day),
          end: DateTime(
            c.end.year,
            c.end.month,
            c.end.day,
          ).add(const Duration(days: 1)),
        );
    }
  }

  String get _rangeLabel => _period.label();

  String? get _compareLabel {
    final c = _compareRange;
    if (c == null) return null;
    final df = DateFormat('d MMM yyyy', 'tr_TR');
    return '${df.format(c.start)} – ${df.format(c.end.subtract(const Duration(days: 1)))}';
  }

  /// Sunucudaki kuralla aynı: ≤45 gün → gün, ≤190 gün → hafta, ötesi ay.
  String get _granularity =>
      _bucketFor(_range.end.difference(_range.start).inDays);

  /// Karşılaştırmada kova genişliği TEMEL dönemden türetilir — tüm dönemler aynı kovayı kullanmalı
  /// ki eğriler üst üste binsin.
  String get _slotGranularity => _slots.isEmpty
      ? 'month'
      : _bucketFor(_slots.first.to.difference(_slots.first.from).inDays);

  static String _bucketFor(int days) {
    if (days <= 45) return 'day';
    if (days <= 190) return 'week';
    return 'month';
  }

  // ------------------------------------------------------------------- veri ---

  Future<Map<String, dynamic>> _load() async {
    // Karşılaştırma: çoklu dönem tekrarlanan `periods=` anahtarıyla gider. Dio'nun liste
    // biçimi sürüme göre `periods[]=` üretebildiği için sorgu dizesi elle kurulur.
    if (_tab == _Tab.compare) {
      final g = _slotGranularity;
      final qs = _slots
          .map((s) => 'periods=${Uri.encodeQueryComponent(s.param)}')
          .join('&');
      final res = await widget.api.get(
        '/api/admin/reports/compare?$qs&granularity=$g',
      );
      return _map(res);
    }

    final r = _range;
    final c = _compareRange;
    final query = <String, dynamic>{
      'fromUtc': r.start.toUtc().toIso8601String(),
      'toUtc': r.end.toUtc().toIso8601String(),
      'granularity': _granularity,
      if (c != null) 'compareFromUtc': c.start.toUtc().toIso8601String(),
      if (c != null) 'compareToUtc': c.end.toUtc().toIso8601String(),
    };
    final res = await widget.api.get(
      '/api/admin/reports/${_tabMeta[_tab]!.$3}',
      query: query,
    );
    return _map(res);
  }

  void _reload() => setState(() => _future = _load());

  Future<void> _pickCompareCustom() async {
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year - 6),
      lastDate: DateTime(now.year + 1, 12, 31),
      initialDateRange:
          _compareCustom ??
          DateTimeRange(
            start: DateTime(now.year - 1, now.month, 1),
            end: DateTime(now.year - 1, now.month + 1, 0),
          ),
    );
    if (picked == null) return;
    setState(() {
      _compareCustom = picked;
      _compare = _Compare.custom;
      _future = _load();
    });
  }

  // ----------------------------------------------------------------- render ---

  @override
  Widget build(BuildContext context) {
    final meta = _tabMeta[_tab]!;
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: () async {
              _reload();
              await _future;
            },
            child: ResponsiveCenter(
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 20, 16, 110),
                children: [
                  PageHeader(
                    eyebrow: 'Analitik',
                    title: 'Raporlar',
                    subtitle: '${meta.$1} · $_rangeLabel',
                  ),
                  const SizedBox(height: 14),
                  _tabChips(),
                  const SizedBox(height: 14),
                  // Karşılaştırma sekmesi kendi dönem kurucusunu kullanır; iki farklı dönem
                  // kaynağı aynı anda görünürse kafa karıştırır.
                  if (_tab != _Tab.compare) ...[
                    PeriodSelector(
                      value: _period,
                      showYear: true,
                      onChanged: (v) => setState(() {
                        _period = v;
                        _future = _load();
                      }),
                    ),
                    const SizedBox(height: 10),
                    _compareBar(),
                  ] else
                    _slotBuilder(),
                  const SizedBox(height: 16),
                  FutureBuilder<Map<String, dynamic>>(
                    future: _future,
                    builder: (context, snap) {
                      if (!snap.hasData && !snap.hasError) {
                        return const SizedBox(
                          height: 240,
                          child: Center(child: CircularProgressIndicator()),
                        );
                      }
                      if (snap.hasError) return _errorBox('${snap.error}');
                      final d = snap.data ?? const <String, dynamic>{};
                      return switch (_tab) {
                        _Tab.overview => _overview(d),
                        _Tab.compare => _compareView(d),
                        _Tab.packages => _catalog(d, isPackage: true),
                        _Tab.services => _catalog(d, isPackage: false),
                        _Tab.staff => _staff(d),
                        _Tab.branches => _branches(d),
                        _Tab.customers => _customers(d),
                        _Tab.inventory => _inventory(d),
                        _Tab.giftCards => _giftCards(d),
                      };
                    },
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _tabChips() => SizedBox(
    height: 38,
    child: ListView.separated(
      scrollDirection: Axis.horizontal,
      itemCount: _Tab.values.length,
      separatorBuilder: (_, _) => const SizedBox(width: 8),
      itemBuilder: (_, i) {
        final t = _Tab.values[i];
        final (label, icon, _) = _tabMeta[t]!;
        final selected = _tab == t;
        return GestureDetector(
          onTap: () => setState(() {
            _tab = t;
            _future = _load();
          }),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: BoxDecoration(
              color: selected ? AppColors.primary : AppColors.surface,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: selected ? AppColors.primary : AppColors.border,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  icon,
                  size: 15,
                  color: selected ? Colors.white : AppColors.muted,
                ),
                const SizedBox(width: 6),
                Text(
                  label,
                  style: TextStyle(
                    color: selected ? Colors.white : AppColors.muted,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
        );
      },
    ),
  );

  Widget _compareBar() => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
    decoration: BoxDecoration(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(10),
      border: Border.all(color: AppColors.border),
    ),
    child: Row(
      children: [
        const Icon(
          Icons.compare_arrows_rounded,
          size: 17,
          color: Color(0xFF7B52BA),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: DropdownButtonHideUnderline(
            child: DropdownButton<_Compare>(
              value: _compare,
              isDense: true,
              isExpanded: true,
              style: const TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                color: AppColors.ink,
              ),
              items: [
                for (final c in _Compare.values)
                  DropdownMenuItem(value: c, child: Text(_compareLabels[c]!)),
              ],
              onChanged: (v) {
                if (v == null) return;
                if (v == _Compare.custom) {
                  _pickCompareCustom();
                  return;
                }
                setState(() {
                  _compare = v;
                  _future = _load();
                });
              },
            ),
          ),
        ),
        if (_compareLabel != null)
          Flexible(
            child: Text(
              _compareLabel!,
              textAlign: TextAlign.right,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: Color(0xFF6B4AA0),
              ),
            ),
          ),
      ],
    ),
  );

  Widget _errorBox(String message) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: AppColors.danger.withValues(alpha: .08),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: AppColors.danger.withValues(alpha: .3)),
    ),
    child: Text(
      'Rapor yüklenemedi.\n$message',
      style: const TextStyle(fontSize: 12, color: AppColors.danger),
    ),
  );

  /// Dağılım dilimlerini detay sayfasındaki kırılım listesine çevirir.
  List<({String label, String value, String? hint})> _sliceRows(
    List<Map<String, dynamic>> slices,
  ) {
    final total = slices.fold<double>(0, (s, x) => s + _n(x['amount']));
    return [
      for (final s in slices)
        (
          label: _s(s['label']),
          value: reportMoney(_n(s['amount'])),
          hint: total > 0
              ? '%${((_n(s['amount']) / total) * 100).round()} · ${_i(s['count'])} işlem'
              : '${_i(s['count'])} işlem',
        ),
    ];
  }

  /// KPI kartına dokununca açılacak detay sayfası. Sözlükte karşılığı yoksa null döner
  /// (kart tıklanabilir görünmez).
  VoidCallback? _detail(
    String key, {
    String? valueText,
    double? value,
    double? previous,
    String? hint,
    bool invert = false,
    List<({String label, String value, String? hint})> breakdown = const [],
  }) {
    if (!reportMetricInfo.containsKey(key)) return null;
    return () => showMetricDetail(
      context,
      metricKey: key,
      valueText: valueText,
      value: value,
      previous: _compareLabel == null ? null : previous,
      compareLabel: _compareLabel,
      rangeLabel: _tab == _Tab.compare ? null : _rangeLabel,
      hint: hint,
      invert: invert,
      breakdown: breakdown,
    );
  }

  /// KPI ızgarası — telefonda 2, tablette 3-4 kolon.
  Widget _kpiGrid(List<Widget> tiles) => GridView.count(
    crossAxisCount: gridCols(context, 2),
    shrinkWrap: true,
    physics: const NeverScrollableScrollPhysics(),
    crossAxisSpacing: 10,
    mainAxisSpacing: 10,
    childAspectRatio: 1.22,
    children: tiles,
  );

  // ==================================================== KARŞILAŞTIRMA ======

  /// Dönem kurucu: hızlı kalıplar + yıl çipleri + dönem kartları (özel aralık düzenlenebilir).
  Widget _slotBuilder() {
    final thisYear = DateTime.now().year;
    final used = _slots.map((s) => s.label).toSet();
    final df = DateFormat('d MMM yyyy', 'tr_TR');

    Future<void> editSlot(_Slot slot) async {
      final picked = await showDateRangePicker(
        context: context,
        firstDate: DateTime(thisYear - 8),
        lastDate: DateTime(thisYear + 1, 12, 31),
        initialDateRange: DateTimeRange(
          start: slot.from,
          end: slot.to.subtract(const Duration(days: 1)),
        ),
      );
      if (picked == null) return;
      setState(() {
        slot.from = DateTime(
          picked.start.year,
          picked.start.month,
          picked.start.day,
        );
        slot.to = DateTime(
          picked.end.year,
          picked.end.month,
          picked.end.day,
        ).add(const Duration(days: 1));
        _future = _load();
      });
    }

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Karşılaştırılacak Dönemler',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.ink,
                  ),
                ),
              ),
              Text(
                '${_slots.length}/$_maxSlots',
                style: const TextStyle(fontSize: 11, color: AppColors.muted),
              ),
            ],
          ),
          const SizedBox(height: 2),
          const Text(
            'İlk dönem "temel"dir, farklar ona göre hesaplanır.',
            style: TextStyle(fontSize: 10.5, color: AppColors.muted),
          ),
          const SizedBox(height: 10),

          // Hızlı kalıplar
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              _quickChip('Bu yıl ↔ 5 yıl önce', const Color(0xFF7B52BA), () {
                setState(() {
                  _slots
                    ..clear()
                    ..addAll([_Slot.year(thisYear), _Slot.year(thisYear - 5)]);
                  _future = _load();
                });
              }),
              _quickChip('Son 5 yıl', AppColors.primaryDark, () {
                setState(() {
                  _slots
                    ..clear()
                    ..addAll(List.generate(5, (i) => _Slot.year(thisYear - i)));
                  _future = _load();
                });
              }),
            ],
          ),
          const SizedBox(height: 10),

          // Dönem kartları
          for (var i = 0; i < _slots.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Container(
                padding: const EdgeInsets.fromLTRB(10, 8, 6, 8),
                decoration: BoxDecoration(
                  color: AppColors.surfaceSoft.withValues(alpha: .45),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: i == 0 ? AppColors.primary : AppColors.border,
                  ),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 10,
                      height: 10,
                      decoration: BoxDecoration(
                        color: paletteAt(i),
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: GestureDetector(
                        onTap: () => editSlot(_slots[i]),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Text(
                                  _slots[i].label,
                                  style: const TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w800,
                                    color: AppColors.ink,
                                  ),
                                ),
                                if (i == 0) ...[
                                  const SizedBox(width: 6),
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 6,
                                      vertical: 1,
                                    ),
                                    decoration: BoxDecoration(
                                      color: AppColors.success.withValues(
                                        alpha: .12,
                                      ),
                                      borderRadius: BorderRadius.circular(20),
                                    ),
                                    child: const Text(
                                      'temel',
                                      style: TextStyle(
                                        fontSize: 9.5,
                                        fontWeight: FontWeight.w800,
                                        color: AppColors.success,
                                      ),
                                    ),
                                  ),
                                ],
                              ],
                            ),
                            const SizedBox(height: 2),
                            Text(
                              '${df.format(_slots[i].from)} – ${df.format(_slots[i].to.subtract(const Duration(days: 1)))}',
                              style: const TextStyle(
                                fontSize: 10.5,
                                color: AppColors.muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      icon: const Icon(
                        Icons.edit_calendar_rounded,
                        size: 17,
                        color: AppColors.primaryDark,
                      ),
                      onPressed: () => editSlot(_slots[i]),
                    ),
                    if (_slots.length > 2)
                      IconButton(
                        visualDensity: VisualDensity.compact,
                        icon: const Icon(
                          Icons.close_rounded,
                          size: 17,
                          color: AppColors.muted,
                        ),
                        onPressed: () => setState(() {
                          _slots.removeAt(i);
                          _future = _load();
                        }),
                      ),
                  ],
                ),
              ),
            ),

          // Yıl ekle
          if (_slots.length < _maxSlots) ...[
            const Divider(height: 16, color: AppColors.border),
            const Text(
              'YIL EKLE',
              style: TextStyle(
                fontSize: 9.5,
                fontWeight: FontWeight.w800,
                letterSpacing: .8,
                color: AppColors.muted,
              ),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (var y = thisYear; y > thisYear - 8; y--)
                  _quickChip(
                    '$y',
                    used.contains('$y') ? AppColors.muted : AppColors.ink,
                    used.contains('$y')
                        ? null
                        : () => setState(() {
                            _slots.add(_Slot.year(y));
                            _future = _load();
                          }),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _quickChip(String text, Color color, VoidCallback? onTap) =>
      GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
          decoration: BoxDecoration(
            color: onTap == null ? AppColors.surfaceSoft : Colors.white,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.border),
          ),
          child: Text(
            text,
            style: TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
              color: onTap == null ? AppColors.muted : color,
            ),
          ),
        ),
      );

  Widget _compareView(Map<String, dynamic> d) {
    final periods = _rows(d['periods']);
    final axis = (d['axisLabels'] as List? ?? const [])
        .map((e) => '$e')
        .toList();
    if (periods.isEmpty) {
      return const ReportEmpty(text: 'Karşılaştırma verisi yok.');
    }
    final baseMetrics = _rows(periods.first['metrics']);

    double metric(Map<String, dynamic> p, String key) {
      for (final m in _rows(p['metrics'])) {
        if (_s(m['key']) == key) return _n(m['value']);
      }
      return 0;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ReportSection(
          title: 'Metrik Karşılaştırması',
          subtitle: 'Temel dönem: ${_s(periods.first['label'])}',
          icon: Icons.table_chart_rounded,
          child: ReportDataTable<Map<String, dynamic>>(
            // Satır = metrik. Her dönem için ayrı kolon üretilir.
            rows: List.generate(baseMetrics.length, (i) => {'index': i}),
            emptyText: 'Metrik yok.',
            columns: [
              ReportColumn(
                width: 128,
                header: 'Metrik',
                cell: (r) => Text(
                  _s(baseMetrics[r['index'] as int]['label']),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              for (var pi = 0; pi < periods.length; pi++)
                ReportColumn(
                  width: 104,
                  alignRight: true,
                  header:
                      _s(periods[pi]['label']) + (pi == 0 ? ' (temel)' : ''),
                  cell: (r) {
                    final i = r['index'] as int;
                    final ms = _rows(periods[pi]['metrics']);
                    if (i >= ms.length) return const Text('—');
                    final unit = _s(ms[i]['unit']);
                    final v = _n(ms[i]['value']);
                    final base = _n(baseMetrics[i]['value']);
                    final text = unit == 'currency'
                        ? reportMoney(v)
                        : unit == 'percent'
                        ? '%${v.round()}'
                        : reportCount(v);
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          text,
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                            color: AppColors.ink,
                          ),
                        ),
                        if (pi > 0) DeltaChip(current: v, previous: base),
                      ],
                    );
                  },
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'Gelir Eğrileri (üst üste)',
          subtitle:
              'Ortak eksen · ${_s(d['granularity']) == 'month'
                  ? 'aylık'
                  : _s(d['granularity']) == 'week'
                  ? 'haftalık'
                  : 'günlük'} kova',
          icon: Icons.stacked_line_chart_rounded,
          child: ReportTrend(
            labels: axis,
            series: [
              for (var i = 0; i < periods.length; i++)
                TrendSeries(
                  label: _s(periods[i]['label']),
                  color: paletteAt(i),
                  filled: i == 0,
                  dashed: i > 0,
                  values: _rows(
                    periods[i]['series'],
                  ).map((s) => _n(s['income'])).toList(),
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'Net Kâr',
          subtitle: 'Dönem bazında',
          icon: Icons.emoji_events_rounded,
          child: RankBarList(
            items: [
              for (var i = 0; i < periods.length; i++)
                RankBarItem(
                  label: _s(periods[i]['label']),
                  value: metric(periods[i], 'net'),
                  color: metric(periods[i], 'net') >= 0
                      ? paletteAt(i)
                      : AppColors.danger,
                  hint:
                      '${reportMoney(metric(periods[i], 'income'))} gelir · ${reportMoney(metric(periods[i], 'expense'))} gider · %${metric(periods[i], 'margin').round()} marj',
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'Dönemlerin Öne Çıkanları',
          subtitle: 'En çok uygulanan hizmet ve en çok iş bitiren personel',
          icon: Icons.star_rounded,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (var i = 0; i < periods.length; i++) ...[
                Row(
                  children: [
                    Container(
                      width: 10,
                      height: 10,
                      decoration: BoxDecoration(
                        color: paletteAt(i),
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      _s(periods[i]['label']),
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                        color: AppColors.ink,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                RankBarList(
                  format: (v) => '${v.round()} seans',
                  emptyText: 'Bu dönemde uygulanan seans yok.',
                  items: [
                    for (final s in _rows(periods[i]['topServices']).take(3))
                      RankBarItem(
                        label: _s(s['label']),
                        value: _n(s['count']),
                        hint: reportMoney(_n(s['amount'])),
                      ),
                  ],
                ),
                const SizedBox(height: 4),
                RankBarList(
                  format: (v) => '${v.round()} işlem',
                  emptyText: 'Bu dönemde tamamlanan işlem yok.',
                  items: [
                    for (final s in _rows(periods[i]['topStaff']).take(3))
                      RankBarItem(
                        label: _s(s['label']),
                        value: _n(s['count']),
                        hint: reportMoney(_n(s['amount'])),
                      ),
                  ],
                ),
                if (i < periods.length - 1)
                  const Divider(height: 18, color: AppColors.border),
              ],
            ],
          ),
        ),
      ],
    );
  }

  // ====================================================== GENEL BAKIŞ ======

  Widget _overview(Map<String, dynamic> d) {
    final metrics = _rows(d['metrics']);
    final series = _rows(d['series']);
    final compareSeries = _rows(d['compareSeries']);
    final labels = series.map((p) => _s(p['label'])).toList();
    final hasCompare = _compareLabel != null;

    String fmt(Map<String, dynamic> m) {
      final unit = _s(m['unit']);
      final v = _n(m['value']);
      if (unit == 'currency') return reportMoney(v);
      if (unit == 'percent') return '%${v.round()}';
      return reportCount(v);
    }

    const icons = <String, IconData>{
      'income': Icons.trending_up_rounded,
      'expense': Icons.trending_down_rounded,
      'net': Icons.account_balance_wallet_rounded,
      'margin': Icons.pie_chart_rounded,
      'sales': Icons.shopping_bag_rounded,
      'appointments': Icons.event_rounded,
      'completed': Icons.task_alt_rounded,
      'occupancy': Icons.bar_chart_rounded,
      'activeCustomers': Icons.groups_rounded,
      'newCustomers': Icons.person_add_alt_1_rounded,
      'avgTicket': Icons.receipt_long_rounded,
      'revenuePerCustomer': Icons.credit_card_rounded,
    };
    const tones = <String, Color>{
      'income': AppColors.success,
      'expense': AppColors.danger,
      'net': AppColors.warning,
      'margin': Color(0xFF7B52BA),
      'sales': AppColors.primary,
      'appointments': Color(0xFF4A7FB5),
      'completed': AppColors.success,
      'occupancy': Color(0xFF7B52BA),
      'activeCustomers': AppColors.primary,
      'newCustomers': AppColors.success,
      'avgTicket': AppColors.warning,
      'revenuePerCustomer': AppColors.primary,
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _kpiGrid([
          for (final m in metrics)
            ReportKpi(
              label: _s(m['label']),
              value: fmt(m),
              icon: icons[_s(m['key'])] ?? Icons.query_stats_rounded,
              tone: tones[_s(m['key'])] ?? AppColors.primary,
              hint: _s(m['hint']).isEmpty ? null : _s(m['hint']),
              current: _n(m['value']),
              previous: hasCompare ? _n(m['previousValue']) : null,
              compareLabel: _compareLabel,
              invert: _s(m['key']) == 'expense',
              onTap: _detail(
                _s(m['key']),
                valueText: fmt(m),
                value: _n(m['value']),
                previous: _n(m['previousValue']),
                hint: _s(m['hint']).isEmpty ? null : _s(m['hint']),
                invert: _s(m['key']) == 'expense',
                // Gelir kartında yöntem, gider kartında kalem kırılımını da göster.
                breakdown: _s(m['key']) == 'income'
                    ? _sliceRows(_rows(d['paymentMethods']))
                    : _s(m['key']) == 'expense'
                    ? _sliceRows(_rows(d['expenseCategories']))
                    : const [],
              ),
            ),
        ]),
        const SizedBox(height: 14),
        ReportSection(
          title: 'Gelir · Gider · Net Kâr',
          subtitle: hasCompare
              ? '$_rangeLabel — kesikli: kıyas dönemi'
              : _rangeLabel,
          icon: Icons.show_chart_rounded,
          child: ReportTrend(
            labels: labels,
            series: [
              TrendSeries(
                label: 'Gelir',
                color: AppColors.success,
                values: series.map((p) => _n(p['income'])).toList(),
              ),
              TrendSeries(
                label: 'Gider',
                color: AppColors.danger,
                values: series.map((p) => _n(p['expense'])).toList(),
              ),
              TrendSeries(
                label: 'Net',
                color: AppColors.primary,
                filled: false,
                values: series.map((p) => _n(p['net'])).toList(),
              ),
              if (hasCompare && compareSeries.isNotEmpty)
                TrendSeries(
                  label: 'Kıyas geliri',
                  color: const Color(0xFF7B52BA),
                  dashed: true,
                  filled: false,
                  values: [
                    for (var i = 0; i < labels.length; i++)
                      i < compareSeries.length
                          ? _n(compareSeries[i]['income'])
                          : 0.0,
                  ],
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'Ödeme Yöntemi',
          icon: Icons.credit_card_rounded,
          child: ReportDonut(
            centerLabel: 'Toplam tahsilat',
            slices: [
              for (final s in _rows(d['paymentMethods']))
                DonutSlice(label: _s(s['label']), value: _n(s['amount'])),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'Gider Kalemleri',
          icon: Icons.receipt_long_rounded,
          child: ReportDonut(
            centerLabel: 'Toplam gider',
            slices: [
              for (final s in _rows(d['expenseCategories']))
                DonutSlice(label: _s(s['label']), value: _n(s['amount'])),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'Ciro Kaynağı',
          subtitle: 'Hizmet · paket · ürün payı',
          icon: Icons.shopping_bag_rounded,
          child: ReportDonut(
            centerLabel: 'Adisyon cirosu',
            slices: [
              for (final s in _rows(d['revenueSources']))
                DonutSlice(label: _s(s['label']), value: _n(s['amount'])),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'Randevu Durumu',
          icon: Icons.event_available_rounded,
          child: RankBarList(
            format: (v) => '${v.round()} randevu',
            emptyText: 'Bu dönemde randevu yok.',
            items: [
              for (final s in _rows(d['appointmentStatuses']))
                RankBarItem(label: _s(s['label']), value: _n(s['count'])),
            ],
          ),
        ),
      ],
    );
  }

  // ================================================== PAKET / HİZMET ======

  Widget _catalog(Map<String, dynamic> d, {required bool isPackage}) {
    final items = _rows(d[isPackage ? 'packages' : 'services']);
    final totals = _map(d[isPackage ? 'packageTotals' : 'serviceTotals']);
    final prev = _map(
      d[isPackage ? 'packageTotalsPrevious' : 'serviceTotalsPrevious'],
    );
    final categories = _rows(
      d[isPackage ? 'packageCategories' : 'serviceCategories'],
    );
    final hasCompare = _compareLabel != null;
    final label = isPackage ? 'Paket' : 'Hizmet';

    double? p(String key) => hasCompare ? _n(prev[key]) : null;

    // Kurum geneli "kim sattı" / "kim uyguladı" sıralaması.
    final sellerTotals = <String, ({double amount, int count})>{};
    final performerTotals = <String, ({double amount, int count})>{};
    for (final item in items) {
      for (final s in _rows(item['sellers'])) {
        final key = _s(s['staffName']);
        final cur = sellerTotals[key] ?? (amount: 0.0, count: 0);
        sellerTotals[key] = (
          amount: cur.amount + _n(s['amount']),
          count: cur.count + _i(s['soldCount']),
        );
      }
      for (final s in _rows(item['performers'])) {
        final key = _s(s['staffName']);
        final cur = performerTotals[key] ?? (amount: 0.0, count: 0);
        performerTotals[key] = (
          amount: cur.amount + _n(s['revenue']),
          count: cur.count + _i(s['sessionCount']),
        );
      }
    }
    final sellers = sellerTotals.entries.toList()
      ..sort((a, b) => b.value.amount.compareTo(a.value.amount));
    final performers = performerTotals.entries.toList()
      ..sort((a, b) => b.value.count.compareTo(a.value.count));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _kpiGrid([
          ReportKpi(
            label: 'Satılan $label',
            value: reportCount(_n(totals['soldCount'])),
            icon: isPackage
                ? Icons.inventory_2_rounded
                : Icons.auto_awesome_rounded,
            tone: const Color(0xFF7B52BA),
            hint: '${_i(totals['customerCount'])} müşteriye',
            current: _n(totals['soldCount']),
            previous: p('soldCount'),
            compareLabel: _compareLabel,
          ),
          ReportKpi(
            label: 'Satış Tutarı',
            value: reportMoney(_n(totals['grossAmount'])),
            icon: Icons.sell_rounded,
            tone: AppColors.primary,
            current: _n(totals['grossAmount']),
            previous: p('grossAmount'),
            compareLabel: _compareLabel,
            onTap: _detail(
              'catalog.grossAmount',
              valueText: reportMoney(_n(totals['grossAmount'])),
            ),
          ),
          ReportKpi(
            label: 'Tahsil Edilen',
            value: reportMoney(_n(totals['collectedAmount'])),
            icon: Icons.payments_rounded,
            tone: AppColors.success,
            current: _n(totals['collectedAmount']),
            previous: p('collectedAmount'),
            compareLabel: _compareLabel,
            onTap: _detail(
              'catalog.collectedAmount',
              valueText: reportMoney(_n(totals['collectedAmount'])),
            ),
          ),
          ReportKpi(
            label: 'Kalan Tutar',
            value: reportMoney(_n(totals['remainingAmount'])),
            icon: Icons.hourglass_bottom_rounded,
            tone: AppColors.warning,
            invert: true,
            current: _n(totals['remainingAmount']),
            previous: p('remainingAmount'),
            compareLabel: _compareLabel,
            onTap: _detail(
              'catalog.remainingAmount',
              valueText: reportMoney(_n(totals['remainingAmount'])),
            ),
          ),
          ReportKpi(
            label: 'Yapılan Seans',
            value: reportCount(_n(totals['sessionsInPeriod'])),
            icon: Icons.task_alt_rounded,
            tone: AppColors.success,
            hint: 'dönemde tamamlanan',
            current: _n(totals['sessionsInPeriod']),
            previous: p('sessionsInPeriod'),
            compareLabel: _compareLabel,
            onTap: _detail(
              'catalog.sessionsInPeriod',
              valueText: reportCount(_n(totals['sessionsInPeriod'])),
            ),
          ),
          ReportKpi(
            label: 'Kalan Seans',
            value: reportCount(_n(totals['sessionsRemaining'])),
            icon: Icons.layers_rounded,
            tone: const Color(0xFF4A7FB5),
            hint:
                '${_i(totals['sessionsUsed'])}/${_i(totals['sessionsTotal'])} kullanıldı',
            current: _n(totals['sessionsRemaining']),
            previous: p('sessionsRemaining'),
            compareLabel: _compareLabel,
            onTap: _detail(
              'catalog.sessionsRemaining',
              valueText: reportCount(_n(totals['sessionsRemaining'])),
            ),
          ),
          ReportKpi(
            label: 'Prim Sonrası Net',
            value: reportMoney(_n(totals['netRevenue'])),
            icon: Icons.savings_rounded,
            tone: AppColors.success,
            hint:
                '${reportMoney(_n(totals['sessionRevenue']))} ciro − ${reportMoney(_n(totals['commissionCost']))} prim',
            current: _n(totals['netRevenue']),
            previous: p('netRevenue'),
            compareLabel: _compareLabel,
            onTap: _detail(
              'catalog.netRevenue',
              valueText: reportMoney(_n(totals['netRevenue'])),
            ),
          ),
          ReportKpi(
            label: 'İptal Edilen',
            value: reportCount(_n(totals['cancelledCount'])),
            icon: Icons.cancel_rounded,
            tone: AppColors.danger,
            invert: true,
            hint: reportMoney(_n(totals['cancelledAmount'])),
            current: _n(totals['cancelledCount']),
            previous: p('cancelledCount'),
            compareLabel: _compareLabel,
            onTap: _detail(
              'catalog.cancelledCount',
              valueText: reportCount(_n(totals['cancelledCount'])),
            ),
          ),
        ]),
        const SizedBox(height: 14),
        ReportSection(
          title: 'Kategori Dağılımı',
          icon: Icons.category_rounded,
          child: ReportDonut(
            centerLabel: 'Toplam satış',
            slices: [
              for (final c in categories)
                DonutSlice(label: _s(c['label']), value: _n(c['amount'])),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'Kim Sattı',
          subtitle: 'Satış tutarına göre personel sıralaması',
          icon: Icons.verified_user_rounded,
          child: RankBarList(
            emptyText: 'Bu dönemde satış yok.',
            items: [
              for (final e in sellers.take(8))
                RankBarItem(
                  label: e.key,
                  value: e.value.amount,
                  hint: '${e.value.count} satış',
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'Kim Uyguladı',
          subtitle: 'Dönemde yapılan seans adedine göre',
          icon: Icons.handshake_rounded,
          child: RankBarList(
            format: (v) => '${v.round()} seans',
            emptyText: 'Bu dönemde tamamlanan seans yok.',
            items: [
              for (final e in performers.take(8))
                RankBarItem(
                  label: e.key,
                  value: e.value.count.toDouble(),
                  hint: '${reportMoney(e.value.amount)} ciro',
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'Kârlılık',
          subtitle: 'Uygulama cirosundan personel primi düşülmüş net',
          icon: Icons.savings_rounded,
          child: RankBarList(
            emptyText: 'Bu dönemde uygulanan seans yok.',
            items: [
              for (final item
                  in ([...items]..sort(
                        (a, b) =>
                            _n(b['netRevenue']).compareTo(_n(a['netRevenue'])),
                      ))
                      .where((i) => _n(i['sessionRevenue']) > 0)
                      .take(10))
                RankBarItem(
                  label: _s(item['name']),
                  value: _n(item['netRevenue']),
                  color: _n(item['netRevenue']) >= 0
                      ? AppColors.success
                      : AppColors.danger,
                  hint:
                      '${_i(item['sessionsInPeriod'])} seans · ${reportMoney(_n(item['sessionRevenue']))} ciro − ${reportMoney(_n(item['commissionCost']))} prim',
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: '$label Detayı',
          subtitle:
              '${items.length} kalem · satıra dokun, personel kırılımı açılır',
          icon: Icons.table_chart_rounded,
          child: Column(
            children: [
              for (final item in items) _catalogTile(item),
              if (items.isEmpty)
                ReportEmpty(
                  text: 'Bu dönemde ${label.toLowerCase()} satışı yok.',
                ),
            ],
          ),
        ),
      ],
    );
  }

  /// Katalog kalemi — açılınca "kim sattı / kim uyguladı" kırılımını gösterir.
  Widget _catalogTile(Map<String, dynamic> item) {
    return Theme(
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        tilePadding: EdgeInsets.zero,
        childrenPadding: const EdgeInsets.only(bottom: 10),
        title: Text(
          _s(item['name']),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            color: AppColors.ink,
          ),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 3),
          child: Text(
            '${_s(item['category'])} · ${_i(item['soldCount'])} satış · '
            '${_i(item['sessionsInPeriod'])} seans yapıldı · ${_i(item['sessionsRemaining'])} kaldı',
            style: const TextStyle(fontSize: 11, color: AppColors.muted),
          ),
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              reportMoney(_n(item['grossAmount'])),
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w800,
                color: AppColors.ink,
              ),
            ),
            Text(
              '${reportMoney(_n(item['collectedAmount']))} tahsil',
              style: const TextStyle(fontSize: 10, color: AppColors.success),
            ),
          ],
        ),
        children: [
          _partyBlock(
            'Kim sattı',
            _rows(item['sellers']),
            countKey: 'soldCount',
            amountKey: 'amount',
            unit: 'satış',
          ),
          const SizedBox(height: 10),
          _partyBlock(
            'Kim uyguladı (dönemde)',
            _rows(item['performers']),
            countKey: 'sessionCount',
            amountKey: 'revenue',
            unit: 'seans',
          ),
          if (_i(item['cancelledCount']) > 0) ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                '${_i(item['cancelledCount'])} iptal · ${reportMoney(_n(item['cancelledAmount']))}',
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: AppColors.danger,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _partyBlock(
    String title,
    List<Map<String, dynamic>> rows, {
    required String countKey,
    required String amountKey,
    required String unit,
  }) {
    final total = rows.fold<double>(0, (s, r) => s + _n(r[amountKey]));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title.toUpperCase(),
          style: const TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.w800,
            letterSpacing: .6,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: 6),
        if (rows.isEmpty)
          const Text(
            'Kayıt yok.',
            style: TextStyle(fontSize: 11.5, color: AppColors.muted),
          )
        else
          for (final r in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 12,
                    backgroundColor: AppColors.primary,
                    child: Text(
                      reportInitials(_s(r['staffName'])),
                      style: const TextStyle(
                        fontSize: 9,
                        fontWeight: FontWeight.w800,
                        color: Colors.white,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _s(r['staffName']),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: AppColors.ink,
                          ),
                        ),
                        Text(
                          '${_i(r[countKey])} $unit · ${_i(r['customerCount'])} müşteri',
                          style: const TextStyle(
                            fontSize: 10.5,
                            color: AppColors.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        reportMoney(_n(r[amountKey])),
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w800,
                          color: AppColors.ink,
                        ),
                      ),
                      Text(
                        total > 0
                            ? '%${((_n(r[amountKey]) / total) * 100).round()}'
                            : '%0',
                        style: const TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          color: AppColors.primaryDark,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
      ],
    );
  }

  // ========================================================= PERSONEL ======

  Widget _staff(Map<String, dynamic> d) {
    final rows = _rows(d['rows']);
    final hasCompare = _compareLabel != null;
    final contribution =
        _n(d['totalServiceRevenue']) + _n(d['totalSalesAmount']);
    final prevContribution =
        _n(d['previousTotalServiceRevenue']) +
        _n(d['previousTotalSalesAmount']);

    final sorted = [...rows]
      ..sort(
        (a, b) => (_n(b['serviceRevenue']) + _n(b['salesAmount'])).compareTo(
          _n(a['serviceRevenue']) + _n(a['salesAmount']),
        ),
      );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _kpiGrid([
          ReportKpi(
            label: 'Toplam Katkı',
            value: reportMoney(contribution),
            icon: Icons.trending_up_rounded,
            tone: AppColors.primary,
            hint: 'uygulama + satış',
            current: contribution,
            previous: hasCompare ? prevContribution : null,
            compareLabel: _compareLabel,
            onTap: _detail(
              'staff.contribution',
              valueText: reportMoney(contribution),
            ),
          ),
          ReportKpi(
            label: 'Uygulama Cirosu',
            value: reportMoney(_n(d['totalServiceRevenue'])),
            icon: Icons.task_alt_rounded,
            tone: AppColors.success,
            current: _n(d['totalServiceRevenue']),
            previous: hasCompare ? _n(d['previousTotalServiceRevenue']) : null,
            compareLabel: _compareLabel,
            onTap: _detail(
              'staff.serviceRevenue',
              valueText: reportMoney(_n(d['totalServiceRevenue'])),
            ),
          ),
          ReportKpi(
            label: 'Satış Cirosu',
            value: reportMoney(_n(d['totalSalesAmount'])),
            icon: Icons.verified_user_rounded,
            tone: const Color(0xFF7B52BA),
            current: _n(d['totalSalesAmount']),
            previous: hasCompare ? _n(d['previousTotalSalesAmount']) : null,
            compareLabel: _compareLabel,
            onTap: _detail(
              'staff.salesAmount',
              valueText: reportMoney(_n(d['totalSalesAmount'])),
            ),
          ),
          ReportKpi(
            label: 'Komisyon',
            value: reportMoney(_n(d['totalCommission'])),
            icon: Icons.savings_rounded,
            tone: AppColors.warning,
            hint: 'dönemde hak edilen',
            onTap: _detail(
              'staff.commission',
              valueText: reportMoney(_n(d['totalCommission'])),
            ),
          ),
          ReportKpi(
            label: 'Tamamlanan',
            value: reportCount(_n(d['totalCompleted'])),
            icon: Icons.event_available_rounded,
            tone: AppColors.success,
            hint: '${_i(d['totalAppointments'])} randevudan',
            current: _n(d['totalCompleted']),
            previous: hasCompare ? _n(d['previousTotalCompleted']) : null,
            compareLabel: _compareLabel,
            onTap: _detail(
              'completed',
              valueText: reportCount(_n(d['totalCompleted'])),
            ),
          ),
          ReportKpi(
            label: 'Çalışılan Süre',
            value: reportDuration(_n(d['totalWorkedMinutes'])),
            icon: Icons.schedule_rounded,
            tone: const Color(0xFF4A7FB5),
            onTap: _detail(
              'staff.workedMinutes',
              valueText: reportDuration(_n(d['totalWorkedMinutes'])),
            ),
          ),
        ]),
        const SizedBox(height: 14),
        ReportSection(
          title: 'Ciro Payı',
          subtitle: 'Personelin toplam katkıdaki payı',
          icon: Icons.pie_chart_rounded,
          child: ReportDonut(
            centerLabel: 'Toplam katkı',
            slices: [
              for (final r in sorted.take(8))
                DonutSlice(
                  label: _s(r['staffName']),
                  value: _n(r['serviceRevenue']) + _n(r['salesAmount']),
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        // İŞLEM SAYISININ PARASAL KARŞILIĞI (web StaffTab ile parite). Karnede işlem sayısı
        // zaten var; çok iş yapanın çok ciro ürettiği varsayılamayacağı için tutar ayrıca
        // sıralanır — kısa/ucuz işlemler burada ayrışır.
        ReportSection(
          title: 'En Çok Üreten',
          subtitle: 'Uygulama + satış cirosu',
          icon: Icons.account_balance_wallet_rounded,
          child: RankBarList(
            format: reportMoney,
            emptyText: 'Bu dönemde ciro üretilmemiş.',
            items: [
              for (final r in sorted.take(8))
                RankBarItem(
                  label: _s(r['staffName']),
                  value: _n(r['serviceRevenue']) + _n(r['salesAmount']),
                  hint:
                      'Uygulama ${reportMoney(_n(r['serviceRevenue']))} · '
                      'Satış ${reportMoney(_n(r['salesAmount']))}',
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        if (hasCompare)
          ReportSection(
            title: 'Uygulama Cirosu Karşılaştırması',
            subtitle: '$_rangeLabel ↔ $_compareLabel',
            icon: Icons.compare_arrows_rounded,
            child: CompareBars(
              currentLabel: 'Dönem',
              previousLabel: 'Kıyas',
              rows: [
                for (final r in sorted.take(6))
                  CompareRow(
                    label: _s(r['staffName']),
                    current: _n(r['serviceRevenue']),
                    previous: _n(r['previousServiceRevenue']),
                  ),
              ],
            ),
          )
        else
          ReportSection(
            title: 'Müşteri Puanı',
            subtitle: 'QR ile toplanan yıldız ortalaması',
            icon: Icons.star_rounded,
            child: RankBarList(
              maxValue: 5,
              format: (v) => '${v.toStringAsFixed(1)} ★',
              emptyText: 'Bu dönemde puan verilmemiş.',
              items: [
                for (final r
                    in ([...rows]..sort(
                          (a, b) => _n(
                            b['averageRating'],
                          ).compareTo(_n(a['averageRating'])),
                        ))
                        .where((r) => _i(r['ratingCount']) > 0)
                        .take(8))
                  RankBarItem(
                    label: _s(r['staffName']),
                    value: _n(r['averageRating']),
                    hint: '${_i(r['ratingCount'])} değerlendirme',
                  ),
              ],
            ),
          ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'Personel Karnesi',
          subtitle: '${rows.length} personel',
          icon: Icons.badge_rounded,
          child: ReportDataTable<Map<String, dynamic>>(
            rows: sorted,
            emptyText: 'Personel kaydı bulunamadı.',
            columns: [
              ReportColumn(
                width: 130,
                header: 'Personel',
                cell: (r) => Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _s(r['staffName']),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink,
                      ),
                    ),
                    Text(
                      _s(r['title']),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 10,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
              ReportColumn(
                width: 78,
                alignRight: true,
                header: 'Randevu',
                cell: (r) => Text(
                  '${_i(r['completedCount'])}/${_i(r['appointmentCount'])}',
                  style: const TextStyle(fontSize: 12, color: AppColors.ink),
                ),
              ),
              ReportColumn(
                width: 70,
                alignRight: true,
                header: 'İpt/Gel',
                cell: (r) => Text(
                  '${_i(r['cancelledCount'])}/${_i(r['noShowCount'])}',
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ),
              ReportColumn(
                width: 96,
                alignRight: true,
                header: 'Uygulama',
                cell: (r) => Text(
                  reportMoney(_n(r['serviceRevenue'])),
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              ReportColumn(
                width: 96,
                alignRight: true,
                header: 'Satış',
                cell: (r) => Text(
                  reportMoney(_n(r['salesAmount'])),
                  style: const TextStyle(
                    fontSize: 12,
                    color: Color(0xFF6B4AA0),
                  ),
                ),
              ),
              ReportColumn(
                width: 90,
                alignRight: true,
                header: 'Komisyon',
                cell: (r) => Text(
                  reportMoney(_n(r['commissionEarned'])),
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.success,
                  ),
                ),
              ),
              ReportColumn(
                width: 74,
                alignRight: true,
                header: 'Çalışma',
                cell: (r) => Text(
                  reportDuration(_n(r['workedMinutes'])),
                  style: const TextStyle(
                    fontSize: 11.5,
                    color: AppColors.muted,
                  ),
                ),
              ),
              ReportColumn(
                width: 58,
                alignRight: true,
                header: 'Puan',
                cell: (r) => Text(
                  _i(r['ratingCount']) > 0
                      ? _n(r['averageRating']).toStringAsFixed(1)
                      : '—',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.warning,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // =========================================================== ŞUBELER ======

  Widget _branches(Map<String, dynamic> d) {
    final rows = _rows(d['rows']);
    final hasCompare = _compareLabel != null;
    final scoped = d['scopedToSingleBranch'] == true;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (scoped) ...[
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.warning.withValues(alpha: .10),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: AppColors.warning.withValues(alpha: .3),
              ),
            ),
            child: const Text(
              'Yetkiniz yalnızca kendi şubenizi kapsıyor; karşılaştırma tek şube üzerinden gösteriliyor.',
              style: TextStyle(fontSize: 11.5, color: AppColors.warning),
            ),
          ),
          const SizedBox(height: 12),
        ],
        _kpiGrid([
          ReportKpi(
            label: 'Toplam Gelir',
            value: reportMoney(_n(d['totalIncome'])),
            icon: Icons.trending_up_rounded,
            tone: AppColors.success,
            hint: '${rows.length} şube',
            current: _n(d['totalIncome']),
            previous: hasCompare ? _n(d['previousTotalIncome']) : null,
            compareLabel: _compareLabel,
            onTap: _detail(
              'branch.income',
              valueText: reportMoney(_n(d['totalIncome'])),
            ),
          ),
          ReportKpi(
            label: 'Toplam Gider',
            value: reportMoney(_n(d['totalExpense'])),
            icon: Icons.trending_down_rounded,
            tone: AppColors.danger,
            invert: true,
            current: _n(d['totalExpense']),
            previous: hasCompare ? _n(d['previousTotalExpense']) : null,
            compareLabel: _compareLabel,
            onTap: _detail(
              'branch.expense',
              valueText: reportMoney(_n(d['totalExpense'])),
            ),
          ),
          ReportKpi(
            label: 'Toplam Net Kâr',
            value: reportMoney(_n(d['totalNet'])),
            icon: Icons.account_balance_wallet_rounded,
            tone: AppColors.warning,
            current: _n(d['totalNet']),
            previous: hasCompare ? _n(d['previousTotalNet']) : null,
            compareLabel: _compareLabel,
            onTap: _detail(
              'branch.net',
              valueText: reportMoney(_n(d['totalNet'])),
            ),
          ),
          ReportKpi(
            label: 'Açık Alacak',
            value: reportMoney(
              rows.fold<double>(0, (s, r) => s + _n(r['receivable'])),
            ),
            icon: Icons.hourglass_bottom_rounded,
            tone: const Color(0xFF7B52BA),
            hint: 'tahsil edilmemiş taksit',
            onTap: _detail(
              'branch.receivable',
              valueText: reportMoney(
                rows.fold<double>(0, (s, r) => s + _n(r['receivable'])),
              ),
            ),
          ),
        ]),
        const SizedBox(height: 14),
        ReportSection(
          title: 'Gelir Payı',
          subtitle: 'Şubelerin ciro içindeki ağırlığı',
          icon: Icons.store_mall_directory_rounded,
          child: ReportDonut(
            centerLabel: 'Toplam gelir',
            slices: [
              for (final r in rows)
                DonutSlice(label: _s(r['branchName']), value: _n(r['income'])),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'Net Kâr Sıralaması',
          subtitle: 'Gelir − gider',
          icon: Icons.leaderboard_rounded,
          child: RankBarList(
            emptyText: 'Şube kaydı yok.',
            items: [
              for (final r in ([
                ...rows,
              ]..sort((a, b) => _n(b['net']).compareTo(_n(a['net'])))))
                RankBarItem(
                  label: _s(r['branchName']),
                  value: _n(r['net']),
                  color: _n(r['net']) >= 0
                      ? AppColors.success
                      : AppColors.danger,
                  hint:
                      '${reportMoney(_n(r['income']))} gelir · ${reportMoney(_n(r['expense']))} gider · %${_n(r['profitMargin']).round()} marj',
                ),
            ],
          ),
        ),
        if (hasCompare) ...[
          const SizedBox(height: 12),
          ReportSection(
            title: 'Net Kâr Karşılaştırması',
            subtitle: '$_rangeLabel ↔ $_compareLabel',
            icon: Icons.compare_arrows_rounded,
            child: CompareBars(
              currentLabel: 'Dönem',
              previousLabel: 'Kıyas',
              rows: [
                for (final r in rows)
                  CompareRow(
                    label: _s(r['branchName']),
                    current: _n(r['net']),
                    previous: _n(r['previousNet']),
                  ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 12),
        ReportSection(
          title: 'Şube Karşılaştırma Tablosu',
          icon: Icons.table_chart_rounded,
          child: ReportDataTable<Map<String, dynamic>>(
            rows: rows,
            emptyText: 'Şube kaydı bulunamadı.',
            columns: [
              ReportColumn(
                width: 120,
                header: 'Şube',
                cell: (r) => Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _s(r['branchName']),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink,
                      ),
                    ),
                    Text(
                      '${_s(r['city'])} · ${_i(r['staffCount'])} personel',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 10,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
              ReportColumn(
                width: 96,
                alignRight: true,
                header: 'Gelir',
                cell: (r) => Text(
                  reportMoney(_n(r['income'])),
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.success,
                  ),
                ),
              ),
              ReportColumn(
                width: 96,
                alignRight: true,
                header: 'Gider',
                cell: (r) => Text(
                  reportMoney(_n(r['expense'])),
                  style: const TextStyle(fontSize: 12, color: AppColors.danger),
                ),
              ),
              ReportColumn(
                width: 100,
                alignRight: true,
                header: 'Net Kâr',
                cell: (r) => Text(
                  reportMoney(_n(r['net'])),
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: _n(r['net']) >= 0
                        ? AppColors.success
                        : AppColors.danger,
                  ),
                ),
              ),
              ReportColumn(
                width: 58,
                alignRight: true,
                header: 'Marj',
                cell: (r) => Text(
                  '%${_n(r['profitMargin']).round()}',
                  style: const TextStyle(fontSize: 12, color: AppColors.ink),
                ),
              ),
              ReportColumn(
                width: 96,
                alignRight: true,
                header: 'Satış',
                cell: (r) => Text(
                  reportMoney(_n(r['salesAmount'])),
                  style: const TextStyle(
                    fontSize: 12,
                    color: Color(0xFF6B4AA0),
                  ),
                ),
              ),
              ReportColumn(
                width: 100,
                alignRight: true,
                header: 'Açık Alacak',
                cell: (r) => Text(
                  reportMoney(_n(r['receivable'])),
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.warning,
                  ),
                ),
              ),
              ReportColumn(
                width: 78,
                alignRight: true,
                header: 'Randevu',
                cell: (r) => Text(
                  '${_i(r['completedCount'])}/${_i(r['appointmentCount'])}',
                  style: const TextStyle(fontSize: 12, color: AppColors.ink),
                ),
              ),
              ReportColumn(
                width: 70,
                alignRight: true,
                header: 'Müşteri',
                cell: (r) => Text(
                  '${_i(r['customerCount'])}',
                  style: const TextStyle(fontSize: 12, color: AppColors.ink),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // ======================================================== MÜŞTERİLER ======

  Widget _customers(Map<String, dynamic> d) {
    final hasCompare = _compareLabel != null;
    final series = _rows(d['series']);
    final total = _n(d['totalCustomers']);
    final kvkkRatio = total > 0 ? (_n(d['kvkkApproved']) / total) * 100 : 0.0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _kpiGrid([
          ReportKpi(
            label: 'Toplam Müşteri',
            value: reportCount(total),
            icon: Icons.groups_rounded,
            tone: AppColors.primary,
            onTap: _detail('customer.total', valueText: reportCount(total)),
          ),
          ReportKpi(
            label: 'Yeni Müşteri',
            value: reportCount(_n(d['newCustomers'])),
            icon: Icons.person_add_alt_1_rounded,
            tone: AppColors.success,
            current: _n(d['newCustomers']),
            previous: hasCompare ? _n(d['previousNewCustomers']) : null,
            compareLabel: _compareLabel,
            onTap: _detail(
              'newCustomers',
              valueText: reportCount(_n(d['newCustomers'])),
            ),
          ),
          ReportKpi(
            label: 'Aktif Müşteri',
            value: reportCount(_n(d['activeCustomers'])),
            icon: Icons.event_available_rounded,
            tone: const Color(0xFF7B52BA),
            hint: 'dönemde randevusu olan',
            current: _n(d['activeCustomers']),
            previous: hasCompare ? _n(d['previousActiveCustomers']) : null,
            compareLabel: _compareLabel,
            onTap: _detail(
              'activeCustomers',
              valueText: reportCount(_n(d['activeCustomers'])),
            ),
          ),
          ReportKpi(
            label: 'Tekrar Gelen',
            value: reportCount(_n(d['returningCustomers'])),
            icon: Icons.repeat_rounded,
            tone: AppColors.warning,
            hint: '${_i(d['oneTimeCustomers'])} tek seferlik',
            onTap: _detail(
              'customer.returning',
              valueText: reportCount(_n(d['returningCustomers'])),
            ),
          ),
          ReportKpi(
            label: 'Dönem Harcaması',
            value: reportMoney(_n(d['totalSpent'])),
            icon: Icons.payments_rounded,
            tone: AppColors.success,
            hint: 'kişi başı ${reportMoney(_n(d['averageSpent']))}',
            current: _n(d['totalSpent']),
            previous: hasCompare ? _n(d['previousTotalSpent']) : null,
            compareLabel: _compareLabel,
            onTap: _detail(
              'customer.spent',
              valueText: reportMoney(_n(d['totalSpent'])),
            ),
          ),
          ReportKpi(
            label: 'Açık Borç',
            value: reportMoney(_n(d['totalDebt'])),
            icon: Icons.hourglass_bottom_rounded,
            tone: AppColors.danger,
            invert: true,
            onTap: _detail(
              'customer.debt',
              valueText: reportMoney(_n(d['totalDebt'])),
            ),
          ),
          ReportKpi(
            label: 'VIP Müşteri',
            value: reportCount(_n(d['vipCount'])),
            icon: Icons.workspace_premium_rounded,
            tone: AppColors.warning,
            hint: '${_i(d['blacklistedCount'])} kara listede',
            onTap: _detail(
              'customer.total',
              valueText: reportCount(_n(d['vipCount'])),
            ),
          ),
          ReportKpi(
            label: 'Kayıp Müşteri',
            value: reportCount(_n(d['lostCustomers'])),
            icon: Icons.heart_broken_rounded,
            tone: AppColors.danger,
            invert: true,
            hint: '180 gündür gelmeyen',
            onTap: _detail(
              'customer.lost',
              valueText: reportCount(_n(d['lostCustomers'])),
            ),
          ),
        ]),
        const SizedBox(height: 14),
        ReportSection(
          title: 'Müşteri Hareketi',
          subtitle: _rangeLabel,
          icon: Icons.show_chart_rounded,
          child: ReportTrend(
            labels: series.map((p) => _s(p['label'])).toList(),
            series: [
              TrendSeries(
                label: 'Tahsilat',
                color: AppColors.success,
                values: series.map((p) => _n(p['income'])).toList(),
              ),
              TrendSeries(
                label: 'Randevu',
                color: AppColors.primary,
                filled: false,
                values: series.map((p) => _n(p['appointments'])).toList(),
              ),
              TrendSeries(
                label: 'Yeni müşteri',
                color: const Color(0xFF7B52BA),
                filled: false,
                values: series.map((p) => _n(p['newCustomers'])).toList(),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'Sadakat & KVKK',
          icon: Icons.verified_rounded,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              ReportGauge(
                value: _n(d['retentionRate']),
                label: 'Tekrar gelme',
                hint: 'aktif müşteriye oranla',
                color: const Color(0xFF7B52BA),
              ),
              ReportGauge(
                value: kvkkRatio,
                label: 'KVKK onaylı',
                hint: '${_i(d['kvkkApproved'])} müşteri',
                color: AppColors.success,
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'Yaş Dağılımı',
          icon: Icons.cake_rounded,
          child: ReportDonut(
            centerLabel: 'Doğum tarihi bilinen',
            format: (v) => '${v.round()} kişi',
            slices: [
              for (final s in _rows(d['ageSegments']))
                DonutSlice(label: _s(s['label']), value: _n(s['count'])),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'Ziyaret Sıklığı',
          subtitle: 'Dönem içi randevu adedi',
          icon: Icons.repeat_rounded,
          child: RankBarList(
            format: (v) => '${v.round()} kişi',
            emptyText: 'Bu dönemde ziyaret yok.',
            items: [
              for (final s in _rows(d['visitFrequency']))
                RankBarItem(label: _s(s['label']), value: _n(s['count'])),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'En Çok Harcayan Müşteriler',
          icon: Icons.workspace_premium_rounded,
          child: ReportDataTable<Map<String, dynamic>>(
            rows: _rows(d['topCustomers']).take(50).toList(),
            emptyText: 'Bu dönemde işlem gören müşteri yok.',
            columns: [
              ReportColumn(
                width: 140,
                header: 'Müşteri',
                cell: (r) => Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _s(r['fullName']),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink,
                      ),
                    ),
                    Text(
                      _s(r['phone']),
                      maxLines: 1,
                      style: const TextStyle(
                        fontSize: 10,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
              ReportColumn(
                width: 66,
                alignRight: true,
                header: 'Ziyaret',
                cell: (r) => Text(
                  '${_i(r['visitCount'])}',
                  style: const TextStyle(fontSize: 12, color: AppColors.ink),
                ),
              ),
              ReportColumn(
                width: 100,
                alignRight: true,
                header: 'Harcama',
                cell: (r) => Text(
                  reportMoney(_n(r['spent'])),
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              ReportColumn(
                width: 90,
                alignRight: true,
                header: 'Son Ziyaret',
                cell: (r) {
                  final dt = parseUtcToLocal(r['lastVisitUtc']);
                  return Text(
                    dt == null
                        ? '—'
                        : DateFormat('d MMM yy', 'tr_TR').format(dt),
                    style: const TextStyle(
                      fontSize: 11.5,
                      color: AppColors.muted,
                    ),
                  );
                },
              ),
              ReportColumn(
                width: 62,
                alignRight: true,
                header: 'KVKK',
                cell: (r) => Icon(
                  r['kvkkConsent'] == true
                      ? Icons.check_circle_rounded
                      : Icons.schedule_rounded,
                  size: 15,
                  color: r['kvkkConsent'] == true
                      ? AppColors.success
                      : AppColors.warning,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // ======================================================= STOK & ÜRÜN ======

  Widget _inventory(Map<String, dynamic> d) {
    final hasCompare = _compareLabel != null;
    final products = _rows(d['products']);
    final series = _rows(d['series']);
    final soldAmount = _n(d['soldAmount']);
    final margin = soldAmount > 0
        ? (_n(d['soldProfit']) / soldAmount) * 100
        : 0.0;
    final critical = products.where((p) => p['isCritical'] == true).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _kpiGrid([
          ReportKpi(
            label: 'Ürün Satışı',
            value: reportMoney(soldAmount),
            icon: Icons.shopping_bag_rounded,
            tone: AppColors.primary,
            hint: '${_n(d['soldQuantity']).toStringAsFixed(0)} adet',
            current: soldAmount,
            previous: hasCompare ? _n(d['previousSoldAmount']) : null,
            compareLabel: _compareLabel,
            onTap: _detail(
              'inventory.soldAmount',
              valueText: reportMoney(soldAmount),
            ),
          ),
          ReportKpi(
            label: 'Satış Kârı',
            value: reportMoney(_n(d['soldProfit'])),
            icon: Icons.trending_up_rounded,
            tone: AppColors.success,
            hint: '%${margin.round()} marj',
            current: _n(d['soldProfit']),
            previous: hasCompare ? _n(d['previousSoldProfit']) : null,
            compareLabel: _compareLabel,
            onTap: _detail(
              'inventory.soldProfit',
              valueText: reportMoney(_n(d['soldProfit'])),
            ),
          ),
          ReportKpi(
            label: 'Satılan Maliyet',
            value: reportMoney(_n(d['soldCost'])),
            icon: Icons.south_rounded,
            tone: AppColors.danger,
            invert: true,
            onTap: _detail(
              'inventory.soldAmount',
              valueText: reportMoney(_n(d['soldCost'])),
            ),
          ),
          ReportKpi(
            label: 'Alım Tutarı',
            value: reportMoney(_n(d['purchasedAmount'])),
            icon: Icons.inventory_rounded,
            tone: const Color(0xFF4A7FB5),
            hint: 'dönemde stoğa giren',
            onTap: _detail(
              'inventory.purchased',
              valueText: reportMoney(_n(d['purchasedAmount'])),
            ),
          ),
          ReportKpi(
            label: 'Stok Değeri',
            value: reportMoney(_n(d['stockValueAtCost'])),
            icon: Icons.warehouse_rounded,
            tone: const Color(0xFF7B52BA),
            hint: 'satışta ${reportMoney(_n(d['stockValueAtSale']))}',
            onTap: _detail(
              'inventory.stockValue',
              valueText: reportMoney(_n(d['stockValueAtCost'])),
            ),
          ),
          ReportKpi(
            label: 'Kritik Stok',
            value: reportCount(_n(d['criticalCount'])),
            icon: Icons.warning_amber_rounded,
            tone: AppColors.warning,
            invert: true,
            hint: '${_i(d['outOfStockCount'])} tükendi',
            onTap: _detail(
              'inventory.critical',
              valueText: reportCount(_n(d['criticalCount'])),
            ),
          ),
        ]),
        const SizedBox(height: 14),
        ReportSection(
          title: 'Ürün Satışı & Alımı',
          subtitle: _rangeLabel,
          icon: Icons.show_chart_rounded,
          child: ReportTrend(
            labels: series.map((p) => _s(p['label'])).toList(),
            series: [
              TrendSeries(
                label: 'Satış',
                color: AppColors.success,
                values: series.map((p) => _n(p['income'])).toList(),
              ),
              TrendSeries(
                label: 'Alım maliyeti',
                color: AppColors.danger,
                values: series.map((p) => _n(p['expense'])).toList(),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'Kategori Payı',
          icon: Icons.category_rounded,
          child: ReportDonut(
            centerLabel: 'Ürün satışı',
            slices: [
              for (final c in _rows(
                d['categories'],
              ).where((c) => _n(c['amount']) > 0))
                DonutSlice(label: _s(c['label']), value: _n(c['amount'])),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'En Çok Satan Ürünler',
          icon: Icons.leaderboard_rounded,
          child: RankBarList(
            emptyText: 'Bu dönemde ürün satışı yok.',
            items: [
              for (final p
                  in products.where((p) => _n(p['soldQuantity']) > 0).take(8))
                RankBarItem(
                  label: _s(p['name']),
                  value: _n(p['soldAmount']),
                  hint:
                      '${_n(p['soldQuantity']).toStringAsFixed(0)} adet · ${reportMoney(_n(p['profit']))} kâr',
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'Stok Uyarıları',
          subtitle: '${critical.length} ürün kritik seviyede',
          icon: Icons.warning_amber_rounded,
          child: critical.isEmpty
              ? const ReportEmpty(text: 'Tüm ürünler yeterli seviyede.')
              : Column(
                  children: [
                    for (final p in critical.take(12))
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    _s(p['name']),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w700,
                                      color: AppColors.ink,
                                    ),
                                  ),
                                  Text(
                                    _s(p['category']),
                                    style: const TextStyle(
                                      fontSize: 10.5,
                                      color: AppColors.muted,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Text(
                              '${_n(p['currentStock']).toStringAsFixed(0)} / ${_n(p['minStockLevel']).toStringAsFixed(0)}',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w800,
                                color: _n(p['currentStock']) <= 0
                                    ? AppColors.danger
                                    : AppColors.warning,
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'Ürün Tablosu',
          subtitle: '${products.length} ürün',
          icon: Icons.table_chart_rounded,
          child: ReportDataTable<Map<String, dynamic>>(
            rows: products,
            emptyText: 'Ürün kaydı bulunamadı.',
            columns: [
              ReportColumn(
                width: 140,
                header: 'Ürün',
                cell: (r) => Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _s(r['name']),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink,
                      ),
                    ),
                    Text(
                      _s(r['category']),
                      maxLines: 1,
                      style: const TextStyle(
                        fontSize: 10,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
              ReportColumn(
                width: 62,
                alignRight: true,
                header: 'Satılan',
                cell: (r) => Text(
                  _n(r['soldQuantity']).toStringAsFixed(0),
                  style: const TextStyle(fontSize: 12, color: AppColors.ink),
                ),
              ),
              ReportColumn(
                width: 96,
                alignRight: true,
                header: 'Tutar',
                cell: (r) => Text(
                  reportMoney(_n(r['soldAmount'])),
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              ReportColumn(
                width: 90,
                alignRight: true,
                header: 'Kâr',
                cell: (r) => Text(
                  reportMoney(_n(r['profit'])),
                  style: TextStyle(
                    fontSize: 12,
                    color: _n(r['profit']) >= 0
                        ? AppColors.success
                        : AppColors.danger,
                  ),
                ),
              ),
              ReportColumn(
                width: 78,
                alignRight: true,
                header: 'Stok',
                cell: (r) => Text(
                  _n(r['currentStock']).toStringAsFixed(0),
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: r['isCritical'] == true
                        ? AppColors.danger
                        : AppColors.ink,
                  ),
                ),
              ),
              ReportColumn(
                width: 96,
                alignRight: true,
                header: 'Stok Değeri',
                cell: (r) => Text(
                  reportMoney(_n(r['stockValue'])),
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // ====================================================== HEDİYE ÇEKİ ======

  Widget _giftCards(Map<String, dynamic> d) {
    final cards = _rows(d['giftCards']);
    final issuedValue = _n(d['giftCardIssuedValue']);
    final redeemed = _n(d['giftCardRedeemedValue']);
    final usedRatio = issuedValue > 0 ? (redeemed / issuedValue) * 100 : 0.0;

    final byKind = <String, double>{};
    for (final c in cards) {
      final k = _s(c['kind']);
      byKind[k] = (byKind[k] ?? 0) + _n(c['value']);
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _kpiGrid([
          ReportKpi(
            label: 'Kesilen Çek',
            value: reportCount(_n(d['giftCardIssuedCount'])),
            icon: Icons.card_giftcard_rounded,
            tone: AppColors.primary,
            hint: 'dönem içinde',
            onTap: _detail(
              'gift.issued',
              valueText: reportCount(_n(d['giftCardIssuedCount'])),
            ),
          ),
          ReportKpi(
            label: 'Kesilen Tutar',
            value: reportMoney(issuedValue),
            icon: Icons.sell_rounded,
            tone: const Color(0xFF7B52BA),
            onTap: _detail('gift.issued', valueText: reportMoney(issuedValue)),
          ),
          ReportKpi(
            label: 'Kullanılan',
            value: reportMoney(redeemed),
            icon: Icons.check_circle_rounded,
            tone: AppColors.success,
            hint: 'kullanım oranı %${usedRatio.round()}',
            onTap: _detail('gift.redeemed', valueText: reportMoney(redeemed)),
          ),
          ReportKpi(
            label: 'Açık Bakiye',
            value: reportMoney(_n(d['giftCardOutstanding'])),
            icon: Icons.account_balance_wallet_rounded,
            tone: AppColors.warning,
            hint: 'harcanmayı bekleyen',
            onTap: _detail(
              'gift.outstanding',
              valueText: reportMoney(_n(d['giftCardOutstanding'])),
            ),
          ),
          ReportKpi(
            label: 'Geçerli Çek',
            value: reportCount(_n(d['giftCardActiveCount'])),
            icon: Icons.verified_rounded,
            tone: AppColors.success,
            hint: '${cards.length} kayıttan',
            onTap: _detail(
              'gift.issued',
              valueText: reportCount(_n(d['giftCardActiveCount'])),
            ),
          ),
          ReportKpi(
            label: 'Süresi Dolan',
            value: reportCount(_n(d['giftCardExpiredCount'])),
            icon: Icons.event_busy_rounded,
            tone: AppColors.danger,
            invert: true,
            onTap: _detail(
              'gift.expired',
              valueText: reportCount(_n(d['giftCardExpiredCount'])),
            ),
          ),
        ]),
        const SizedBox(height: 14),
        ReportSection(
          title: 'Tür Dağılımı',
          subtitle: 'Toplam değere göre',
          icon: Icons.pie_chart_rounded,
          child: ReportDonut(
            centerLabel: 'Toplam değer',
            slices: [
              for (final e in byKind.entries)
                DonutSlice(label: e.key, value: e.value),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'En Çok Kullanılan Çekler',
          icon: Icons.leaderboard_rounded,
          child: RankBarList(
            emptyText: 'Henüz kullanılan çek yok.',
            items: [
              for (final c
                  in ([...cards]..sort(
                        (a, b) =>
                            _n(b['usedAmount']).compareTo(_n(a['usedAmount'])),
                      ))
                      .where((c) => _n(c['usedAmount']) > 0)
                      .take(8))
                RankBarItem(
                  label: _s(c['customerName']).isEmpty
                      ? _s(c['code'])
                      : '${_s(c['code'])} · ${_s(c['customerName'])}',
                  value: _n(c['usedAmount']),
                  hint: '${_i(c['usedCount'])} kullanım · ${_s(c['kind'])}',
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        ReportSection(
          title: 'Hediye Çeki Listesi',
          subtitle: '${cards.length} kayıt',
          icon: Icons.table_chart_rounded,
          child: ReportDataTable<Map<String, dynamic>>(
            rows: cards,
            emptyText: 'Hediye çeki kaydı bulunamadı.',
            columns: [
              ReportColumn(
                width: 130,
                header: 'Kod',
                cell: (r) => Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _s(r['code']),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink,
                      ),
                    ),
                    Text(
                      _s(r['customerName']).isEmpty
                          ? 'Genel'
                          : _s(r['customerName']),
                      maxLines: 1,
                      style: const TextStyle(
                        fontSize: 10,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
              ReportColumn(
                width: 96,
                header: 'Tür',
                cell: (r) => Text(
                  _s(r['kind']),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 11.5, color: AppColors.ink),
                ),
              ),
              ReportColumn(
                width: 90,
                alignRight: true,
                header: 'Değer',
                cell: (r) => Text(
                  reportMoney(_n(r['value'])),
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              ReportColumn(
                width: 92,
                alignRight: true,
                header: 'Kullanılan',
                cell: (r) => Text(
                  reportMoney(_n(r['usedAmount'])),
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.success,
                  ),
                ),
              ),
              ReportColumn(
                width: 90,
                alignRight: true,
                header: 'Kalan',
                cell: (r) => Text(
                  reportMoney(_n(r['balance'])),
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.warning,
                  ),
                ),
              ),
              ReportColumn(
                width: 70,
                alignRight: true,
                header: 'Durum',
                cell: (r) => Icon(
                  r['isActive'] == true
                      ? Icons.check_circle_rounded
                      : Icons.pause_circle_rounded,
                  size: 15,
                  color: r['isActive'] == true
                      ? AppColors.success
                      : AppColors.muted,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
