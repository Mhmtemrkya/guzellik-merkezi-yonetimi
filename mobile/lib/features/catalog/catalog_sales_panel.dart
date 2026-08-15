import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../customers/customer_sales_panel.dart';

/// Katalog (hizmet / paket) kartındaki SATIŞ PANELİ — web paritesi.
///
/// Müşteri kartındaki panel "bu müşteri ne aldı?" sorusunu cevaplar; buradaki panel aynı veriye
/// kataloğun gözünden bakar: "bu paket/hizmet kime, ne zaman, KİM TARAFINDAN satıldı?".
/// Ciro, kalan tahsilat, seans doluluğu ve personel bazlı satış payı tek bakışta görünür;
/// satıra dokununca satışın tam ayrıntısı (taksitler dahil) açılır.
///
/// ÖLÇEK: satışlar sunucuda bu katalog kaydına göre süzülür (serviceDefinitionId /
/// servicePackageId) — tüm cari listesi indirilmez.
class CatalogSalesPanel extends StatefulWidget {
  const CatalogSalesPanel({
    required this.api,
    required this.kind, // 'service' | 'package'
    required this.itemId,
    required this.itemName,
    required this.itemPrice,
    this.canManage = true,
    this.showHistoryButton = true,
    super.key,
  });

  final ApiClient api;
  final String kind;
  final String itemId;
  final String itemName;
  final double itemPrice;
  final bool canManage;

  /// Panelin KENDİ "Geçmiş satış" bağlantısı çizilsin mi? Katalog kartlarında tetikleyici
  /// alta (Sil'in yanına) taşındığı için orada `false` verilir; form yine burada yaşar,
  /// çünkü kaydettikten sonra listeyi tazeleyen kod bu panele ait.
  ///
  /// Dışarıdan açmak için `GlobalKey<CatalogSalesPanelState>` ile
  /// [CatalogSalesPanelState.openHistoricalForm] çağrılır. Bayrak/nonce yerine anahtar:
  /// bayrak, panel sekme değişiminde yeniden kurulduğunda kendiliğinden tetikleniyor ve
  /// sıfırlaması `setState`'siz olduğu için İKİNCİ dokunuşta hiç çalışmıyordu.
  final bool showHistoryButton;

  @override
  State<CatalogSalesPanel> createState() => CatalogSalesPanelState();
}

class CatalogSalesPanelState extends State<CatalogSalesPanel> {
  List<Map<String, dynamic>> _accounts = const [];

  /// İptal arşivi (cancelled_sales) — canlı satış listesinden ayrı kaynak.
  List<Map<String, dynamic>> _cancelled = const [];
  bool _loading = true;
  String _filter = 'all';
  bool _expanded = false;

  static String _money(num? v) =>
      NumberFormat.currency(locale: 'tr_TR', symbol: '₺', decimalDigits: 0).format(v ?? 0);

  static String _saleStatus(Map<String, dynamic> a) {
    final s = '${a['saleStatus'] ?? 'Active'}';
    return const ['Active', 'Completed', 'Cancelled'].contains(s) ? s : 'Active';
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  /// Dışarıdan (katalog kartının alt çubuğundan) çağrılır: geçmiş satış formunu açar.
  Future<void> openHistoricalForm() => _openHistoricalForm();

  Future<void> _load() async {
    try {
      final res = await widget.api.get('/api/admin/accounts/', query: {
        'page': 1,
        'pageSize': 200,
        if (widget.kind == 'service') 'serviceDefinitionId': widget.itemId,
        if (widget.kind == 'package') 'servicePackageId': widget.itemId,
      });
      // İPTAL EDİLENLER AYRI KAYNAKTAN: iptalde cari kaydı canlı tablodan silinip
      // cancelled_sales arşivine taşınır, bu yüzden yukarıdaki sorguda hiç görünmezler.
      final cancelled = widget.kind == 'package'
          ? await widget.api
              .get('/api/admin/accounts/cancelled', query: {'servicePackageId': widget.itemId})
              .catchError((_) => const <dynamic>[])
          : const <dynamic>[];
      if (!mounted) return;
      setState(() {
        _accounts = apiItems(res);
        _cancelled = apiItems(cancelled);
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 18),
        child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))),
      );
    }

    final sorted = [..._accounts]
      ..sort((a, b) => '${b['soldAtUtc'] ?? b['createdAtUtc'] ?? ''}'
          .compareTo('${a['soldAtUtc'] ?? a['createdAtUtc'] ?? ''}'));

    // İptal edilen satışlar ciroya sayılmaz (geri alınmış işlem).
    final live = sorted.where((a) => _saleStatus(a) != 'Cancelled').toList();
    final revenue = live.fold<double>(0, (s, a) => s + numberOf(a, const ['totalAmount']));
    final remaining = live.fold<double>(0, (s, a) => s + numberOf(a, const ['remainingAmount']));
    final sessionsTotal = live.fold<int>(0, (s, a) => s + numberOf(a, const ['sessionsTotal']).toInt());
    final sessionsUsed = live.fold<int>(0, (s, a) => s + numberOf(a, const ['sessionsUsed']).toInt());
    final customers = live.map((a) => '${a['customerId']}').toSet().length;

    // "Kim sattı" — personel bazlı adet/ciro payı.
    final sellerMap = <String, (int count, double amount)>{};
    for (final a in live) {
      final name = valueOf(a, const ['soldByStaffName'], fallback: 'Belirtilmemiş');
      final cur = sellerMap[name] ?? (0, 0.0);
      sellerMap[name] = (cur.$1 + 1, cur.$2 + numberOf(a, const ['totalAmount']));
    }
    final sellers = sellerMap.entries.toList()..sort((x, y) => y.value.$2.compareTo(x.value.$2));

    final counts = <String, int>{
      'all': sorted.length, 'Active': 0, 'Completed': 0, 'Cancelled': _cancelled.length,
    };
    for (final a in sorted) {
      final s = _saleStatus(a);
      if (s != 'Cancelled') counts[s] = (counts[s] ?? 0) + 1;
    }
    // "İptal" sekmesi arşivden okunur; o satışların canlı kaydı yoktur.
    final filtered = _filter == 'all'
        ? sorted
        : _filter == 'Cancelled'
            ? _cancelled
            : sorted.where((a) => _saleStatus(a) == _filter).toList();
    final visible = _expanded ? filtered : filtered.take(4).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(Icons.trending_up_rounded, size: 16, color: AppColors.primaryDark),
            const SizedBox(width: 5),
            const Text('Satış performansı',
                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
            if (sorted.isNotEmpty) ...[
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: .12),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text('${sorted.length}',
                    style: const TextStyle(
                        fontSize: 10.5, fontWeight: FontWeight.w800, color: AppColors.primaryDark)),
              ),
            ],
            const Spacer(),
            // Tetikleyici DIŞARIDAN yönetiliyorsa burada çizilmez: katalog kartının altına,
            // Sil düğmesinin yanına taşındı (web'deki alt çubuk düzeninin karşılığı).
            if (widget.canManage && widget.showHistoryButton)
              TextButton.icon(
                onPressed: _openHistoricalForm,
                icon: const Icon(Icons.history_rounded, size: 16),
                label: const Text('Geçmiş satış'),
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.primaryDark,
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                  visualDensity: VisualDensity.compact,
                ),
              ),
          ],
        ),
        const SizedBox(height: 8),

        // KPI ızgarası
        Row(
          children: [
            Expanded(child: _kpi('Satış', '${live.length}', '$customers müşteri')),
            const SizedBox(width: 6),
            Expanded(
              child: _kpi('Ciro', _money(revenue),
                  remaining > 0.005 ? '${_money(remaining)} kalan' : 'Tahsil edildi'),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            Expanded(
              child: _kpi(
                'Kalan Seans',
                // KPI'nın büyük rakamı KALAN olsun; toplam/kullanılan alt satırda.
                sessionsTotal > 0 ? '${sessionsTotal - sessionsUsed}' : '—',
                sessionsTotal > 0
                    ? '$sessionsTotal seanslık · $sessionsUsed kullanıldı'
                    : 'Seanssız',
              ),
            ),
            const SizedBox(width: 6),
            Expanded(
              child: _kpi('Ortalama',
                  live.isEmpty ? '—' : _money(revenue / live.length), 'satış başına'),
            ),
          ],
        ),

        if (sellers.isNotEmpty) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: AppColors.surfaceSoft,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.how_to_reg_rounded, size: 13, color: AppColors.primaryDark),
                    SizedBox(width: 4),
                    Text('KİM SATTI',
                        style: TextStyle(
                            fontSize: 9.5,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 1,
                            color: AppColors.muted)),
                  ],
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final e in sellers.take(5))
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                        decoration: BoxDecoration(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          '${e.key} · ${e.value.$1} satış · '
                          '%${revenue > 0 ? (e.value.$2 / revenue * 100).round() : 0}',
                          style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700),
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ],

        if (sorted.isNotEmpty) ...[
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            children: [
              for (final f in const [
                ('all', 'Tümü'),
                ('Active', 'Devam eden'),
                ('Completed', 'Biten'),
                ('Cancelled', 'İptal'),
              ])
                if (f.$1 == 'all' || (counts[f.$1] ?? 0) > 0)
                  ChoiceChip(
                    label: Text('${f.$2}${(counts[f.$1] ?? 0) > 0 ? ' ${counts[f.$1]}' : ''}'),
                    labelStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
                    selected: _filter == f.$1,
                    visualDensity: VisualDensity.compact,
                    onSelected: (_) => setState(() {
                      _filter = f.$1;
                      _expanded = false;
                    }),
                  ),
            ],
          ),
        ],

        const SizedBox(height: 8),
        if (visible.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 12),
            decoration: BoxDecoration(
              color: AppColors.surfaceSoft,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              sorted.isEmpty
                  ? 'Bu ${widget.kind == 'package' ? 'paket' : 'hizmet'} henüz satılmamış. '
                      'Geçmiş satışları da buradan girebilirsiniz.'
                  : 'Bu durumda satış yok.',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
            ),
          )
        else
          for (final a in visible)
            // İptal edilenlerin canlı cari kaydı yok (arşivden gelirler) — ayrı, sade satır.
            if (_filter == 'Cancelled') _cancelledRow(a) else _saleRow(a),

        if (filtered.length > visible.length)
          Align(
            alignment: Alignment.center,
            child: TextButton(
              onPressed: () => setState(() => _expanded = true),
              child: Text('${filtered.length - visible.length} satış daha'),
            ),
          ),
      ],
    );
  }

  Widget _kpi(String label, String value, String sub) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: AppColors.surfaceSoft,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label.toUpperCase(),
                style: const TextStyle(
                    fontSize: 9, fontWeight: FontWeight.w800, letterSpacing: .8, color: AppColors.muted)),
            const SizedBox(height: 2),
            Text(value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
            Text(sub,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 10, color: AppColors.muted)),
          ],
        ),
      );

  /// İptal arşivi satırı. Cari kaydı silindiği için tıklanabilir detay yoktur;
  /// tutar, tahsil edilen/iade edilen ve gerekçe gösterilir.
  Widget _cancelledRow(Map<String, dynamic> c) {
    final refunded = numberOf(c, const ['refundedAmount']);
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
      decoration: BoxDecoration(
        color: AppColors.danger.withValues(alpha: .05),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.danger.withValues(alpha: .22)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  valueOf(c, const ['customerName', 'name'], fallback: 'Müşteri'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5),
                ),
                const SizedBox(height: 3),
                _sellerLine(valueOf(c, const ['soldByStaffName'], fallback: '')),
                const SizedBox(height: 2),
                Text(
                  valueOf(c, const ['cancellationReason'], fallback: 'gerekçe belirtilmemiş'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 10.5, color: AppColors.muted),
                ),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(_money(numberOf(c, const ['totalAmount'])),
                  style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 12.5)),
              Text(
                'tahsil ${_money(numberOf(c, const ['collectedAmount']))}'
                '${refunded > 0.005 ? ' · iade ${_money(refunded)}' : ''}',
                style: const TextStyle(fontSize: 10, color: AppColors.muted),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _saleRow(Map<String, dynamic> a) {
    final status = _saleStatus(a);
    final cancelled = status == 'Cancelled';
    final remaining = numberOf(a, const ['remainingAmount']);
    final sessionsTotal = numberOf(a, const ['sessionsTotal']).toInt();
    final soldAt = parseUtcToLocal(a['soldAtUtc'] ?? a['createdAtUtc']);

    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      decoration: BoxDecoration(
        color: cancelled ? AppColors.surfaceSoft : AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => _openDetail(a),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            valueOf(a, const ['customerName'], fallback: 'Müşteri'),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5),
                          ),
                        ),
                        if (a['isHistorical'] == true) ...[
                          const SizedBox(width: 5),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                            decoration: BoxDecoration(
                              color: const Color(0xFF7B52BA).withValues(alpha: .12),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: const Text('Geçmiş',
                                style: TextStyle(
                                    fontSize: 8.5, fontWeight: FontWeight.w800, color: Color(0xFF6B4AA0))),
                          ),
                        ],
                      ],
                    ),
                    // SATAN PERSONEL KENDİ SATIRINDA. Tarih ve seansla aynı silik satıra
                    // sıkışınca "hangi müşteriye kim satmış" sorusu her satırda farklı yerden
                    // okunuyordu; artık her satırda aynı hizada ve vurgulu.
                    const SizedBox(height: 3),
                    _sellerLine(valueOf(a, const ['soldByStaffName'], fallback: '')),
                    const SizedBox(height: 2),
                    Text(
                      '${soldAt == null ? '—' : DateFormat('d MMM yyyy', 'tr_TR').format(soldAt)}'
                      // "2/4 seans" hangi sayının kalan olduğunu söylemiyordu — cevap yazılır.
                      '${sessionsTotal > 0 ? ' · ${sessionsTotal - numberOf(a, const ['sessionsUsed']).toInt()} seans kaldı' : ''}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 10, color: AppColors.muted),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(_money(numberOf(a, const ['totalAmount'])),
                      style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 12.5)),
                  Text(
                    remaining > 0.005 ? '${_money(remaining)} kalan' : 'Ödendi',
                    style: TextStyle(
                        fontSize: 9.5,
                        fontWeight: FontWeight.w700,
                        color: remaining > 0.005 ? AppColors.danger : AppColors.success),
                  ),
                ],
              ),
              const Icon(Icons.chevron_right_rounded, size: 18, color: AppColors.muted),
            ],
          ),
        ),
      ),
    );
  }

  /// "Satan personel" satırı — baş harf madalyonu + ad. Boşsa açıkça belirtilir;
  /// telefonda tablo kurulamaz, hizayı bu ortak satır sağlar.
  Widget _sellerLine(String name) {
    final label = name.trim();
    if (label.isEmpty) {
      return const Text('Satan belirtilmemiş',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(fontSize: 10.5, color: AppColors.muted));
    }
    final parts = label.split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    final initials = (parts.length == 1
            ? parts.first.characters.take(2).toString()
            : '${parts.first.characters.first}${parts.last.characters.first}')
        .toUpperCase();
    return Row(
      children: [
        Container(
          width: 16,
          height: 16,
          alignment: Alignment.center,
          decoration: const BoxDecoration(
            color: AppColors.primary,
            shape: BoxShape.circle,
          ),
          child: Text(initials,
              style: const TextStyle(
                  fontSize: 7.5, fontWeight: FontWeight.w900, color: Colors.white)),
        ),
        const SizedBox(width: 5),
        Flexible(
          child: Text(label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  fontSize: 10.5, fontWeight: FontWeight.w700, color: AppColors.ink)),
        ),
      ],
    );
  }

  Future<void> _openDetail(Map<String, dynamic> account) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => SaleDetailSheet(
        api: widget.api,
        account: account,
        customerName: valueOf(account, const ['customerName'], fallback: 'Müşteri'),
        canManage: widget.canManage,
      ),
    );
    if (changed == true) await _load();
  }

  Future<void> _openHistoricalForm() async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => HistoricalSaleSheet(
        api: widget.api,
        customerId: '',
        customerName: widget.itemName,
        needsCustomer: true,
        preset: (
          kind: widget.kind,
          id: widget.itemId,
          name: widget.itemName,
          price: widget.itemPrice,
        ),
      ),
    );
    if (saved == true) await _load();
  }
}
