import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/responsive.dart';
import '../../shared/json_helpers.dart';

/// Müşteriler ekranının "Müşteri Özeti" bloğu — web `/admin/musteriler` sayfasındaki
/// SummaryTile'ların mobil karşılığı.
///
/// Sayaçların TAMAMI sunucuda hesaplanır (`/customers/stats`); 12 bin+ müşteride liste
/// indirilmez. Ortalama harcamanın dönemi kart üzerinden seçilir ve yalnız hafif
/// `/customers/stats/spending` ucu yeniden çağrılır — ağır sayaçlar tekrar koşmaz.
///
/// Liste ekranın asıl içeriği olduğu için panel başlığından katlanabilir.
class CustomerSummaryPanel extends StatefulWidget {
  const CustomerSummaryPanel({required this.api, super.key});

  final ApiClient api;

  @override
  State<CustomerSummaryPanel> createState() => _CustomerSummaryPanelState();
}

/// Ortalama harcama dönemleri — web SPEND_PERIODS ile birebir.
/// Ölçüt tahsilat tarihidir: geçmiş bir satışın bu ay ödenen taksiti bu döneme düşer.
const _spendPeriods = <(String label, int? days)>[
  ('Tüm zamanlar', null),
  ('Son 30 gün', 30),
  ('Son 90 gün', 90),
  ('Son 1 yıl', 365),
];

final _money = NumberFormat.currency(locale: 'tr_TR', symbol: '₺', decimalDigits: 0);
final _count = NumberFormat.decimalPattern('tr_TR');

class _CustomerSummaryPanelState extends State<CustomerSummaryPanel> {
  late Future<Map<String, dynamic>> _stats;
  late Future<Map<String, dynamic>> _spending;
  int _periodIndex = 0;
  bool _open = true;

  @override
  void initState() {
    super.initState();
    _stats = _loadStats();
    _spending = _loadSpending();
  }

  Future<Map<String, dynamic>> _loadStats() async {
    final res = await widget.api
        .get('/api/admin/customers/stats')
        .catchError((_) => const <String, dynamic>{});
    return res is Map ? res.cast<String, dynamic>() : const {};
  }

  Future<Map<String, dynamic>> _loadSpending() async {
    final days = _spendPeriods[_periodIndex].$2;
    final res = await widget.api
        .get('/api/admin/customers/stats/spending', query: {'days': ?days})
        .catchError((_) => const <String, dynamic>{});
    return res is Map ? res.cast<String, dynamic>() : const {};
  }

  void _changePeriod(int index) {
    if (index == _periodIndex) return;
    setState(() {
      _periodIndex = index;
      _spending = _loadSpending();
    });
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Map<String, dynamic>>(
      future: _stats,
      builder: (context, snapshot) {
        // Yüklenirken/başarısızsa panel gizlenir — müşteri listesi yine de açılır.
        if (!snapshot.hasData) return const SizedBox.shrink();
        final s = snapshot.data!;
        return Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              InkWell(
                onTap: () => setState(() => _open = !_open),
                borderRadius: BorderRadius.circular(10),
                child: Row(
                  children: [
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Müşteri Özeti',
                              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                          Text('Kurum geneli — filtre ve aramadan bağımsız',
                              style: TextStyle(fontSize: 11, color: AppColors.muted)),
                        ],
                      ),
                    ),
                    Icon(_open ? Icons.expand_less_rounded : Icons.expand_more_rounded,
                        color: AppColors.primaryDark),
                  ],
                ),
              ),
              if (_open) ...[
                const SizedBox(height: 10),
                AdaptiveStatGrid(
                  phoneCols: 2,
                  // Sabit yükseklik: alt satırın 2 satırlık açıklaması + dönem seçici
                  // sığsın (taşma çizgisi çıkmasın).
                  height: 124,
                  children: [
                    _ageTile(s),
                    _spendTile(),
                    _newThisMonthTile(s),
                    _debtorTile(s),
                  ],
                ),
              ],
            ],
          ),
        );
      },
    );
  }

  /// Yaş segmenti YALNIZCA doğum tarihi girilmiş müşterilerden hesaplanır — kaç kişilik
  /// veriye dayandığı yazılır, aksi halde "%83" tüm müşterileri temsil ediyor sanılıyor.
  Widget _ageTile(Map<String, dynamic> s) {
    final known = numberOf(s, const ['ageKnownCount']).toInt();
    final pct = numberOf(s, const ['topAgeSegmentPercent']).toInt();
    final segment = '${s['topAgeSegment'] ?? ''}'.trim();
    return _Tile(
      icon: Icons.groups_2_rounded,
      tone: AppColors.primaryDark,
      label: 'En yaygın yaş aralığı',
      value: known > 0 && segment.isNotEmpty ? segment : '—',
      sub: known > 0
          ? '%$pct · doğum tarihi girili ${_count.format(known)} müşteri'
          : 'Doğum tarihi girilmiş müşteri yok',
    );
  }

  /// Ortalama harcama seçili DÖNEMDEN gelir; harcaması OLAN müşteriler üzerinden alınır
  /// (o dönemde ödeme yapmayanlar ortalamayı aşağı çekmesin).
  Widget _spendTile() {
    return FutureBuilder<Map<String, dynamic>>(
      future: _spending,
      builder: (context, snapshot) {
        final data = snapshot.data ?? const <String, dynamic>{};
        final spenders = numberOf(data, const ['spenderCount']).toInt();
        final avg = numberOf(data, const ['avgSpent']);
        final isAllTime = _spendPeriods[_periodIndex].$2 == null;
        return _Tile(
          icon: Icons.credit_card_rounded,
          tone: AppColors.primary,
          label: 'Ortalama harcama',
          value: !snapshot.hasData
              ? '…'
              : spenders > 0
                  ? _money.format(avg)
                  : '—',
          sub: spenders > 0
              ? 'Harcaması olan ${_count.format(spenders)} müşteri'
              : isAllTime
                  ? 'Henüz tahsilat yok'
                  : 'Bu dönemde tahsilat yok',
          footer: SizedBox(
            height: 30,
            child: DropdownButtonHideUnderline(
              child: DropdownButton<int>(
                value: _periodIndex,
                isExpanded: true,
                isDense: true,
                iconSize: 18,
                borderRadius: BorderRadius.circular(10),
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: AppColors.primaryDark,
                ),
                items: [
                  for (var i = 0; i < _spendPeriods.length; i++)
                    DropdownMenuItem(value: i, child: Text(_spendPeriods[i].$1)),
                ],
                onChanged: (v) => _changePeriod(v ?? 0),
              ),
            ),
          ),
        );
      },
    );
  }

  /// "Yeni" değil "eklenen": toplu Excel aktarımı da kayıt tarihine göre buraya düşer.
  Widget _newThisMonthTile(Map<String, dynamic> s) {
    final now = numberOf(s, const ['newThisMonth']).toInt();
    final prev = numberOf(s, const ['newPrevMonth']).toInt();
    // Negatif değişimde "↑ %-50 artış" yazılmasın: yön ve kelime birlikte değişir.
    final growth = prev > 0 ? ((now - prev) / prev * 100).round() : null;
    return _Tile(
      icon: Icons.person_add_alt_1_rounded,
      tone: AppColors.success,
      label: 'Bu ay eklenen müşteri',
      value: _count.format(now),
      sub: growth != null
          ? '${growth >= 0 ? '↑' : '↓'} %${growth.abs()} ${growth >= 0 ? 'artış' : 'azalış'} · geçen ay ${_count.format(prev)}'
          : 'Geçen ay ${_count.format(prev)} müşteri eklendi',
      subTone: growth == null
          ? null
          : growth >= 0
              ? AppColors.success
              : AppColors.danger,
    );
  }

  Widget _debtorTile(Map<String, dynamic> s) {
    final debtors = numberOf(s, const ['debtorCount']).toInt();
    final total = numberOf(s, const ['total']).toInt();
    return _Tile(
      icon: Icons.pie_chart_rounded,
      tone: AppColors.warning,
      label: 'Borçlu müşteri oranı',
      value: '%${_debtorPct(debtors, total)}',
      sub: '${_count.format(debtors)} / ${_count.format(total)} müşteri',
    );
  }

  /// 3/12568 gibi küçük oranlar "%0" görünmesin: %1'in altında iki ondalık gösterilir
  /// (0,02 gibi), tam sıfır değilse asla 0 yazılmaz. Kesin sayı alt satırda zaten var.
  static String _debtorPct(int debtors, int total) {
    if (debtors == 0) return '0';
    final raw = total > 0 ? debtors * 100 / total : 0.0;
    final value = raw >= 1
        ? (raw * 10).round() / 10
        : ((raw * 100).round() / 100).clamp(0.01, double.infinity);
    final text = value == value.roundToDouble()
        ? value.toStringAsFixed(0)
        : value.toString();
    return text.replaceAll('.', ',');
  }
}

class _Tile extends StatelessWidget {
  const _Tile({
    required this.icon,
    required this.tone,
    required this.label,
    required this.value,
    required this.sub,
    this.subTone,
    this.footer,
  });

  final IconData icon;
  final Color tone;
  final String label;
  final String value;
  final String sub;
  final Color? subTone;

  /// Kartın altındaki küçük kumanda (ortalama harcamanın dönem seçimi).
  final Widget? footer;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 10),
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
                Icon(icon, size: 14, color: tone),
                const SizedBox(width: 5),
                Expanded(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 10.5, color: AppColors.muted),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 3),
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17),
            ),
            const SizedBox(height: 2),
            Expanded(
              child: Text(
                sub,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 10, color: subTone ?? AppColors.muted),
              ),
            ),
            if (footer != null) footer!,
          ],
        ),
      );
}
