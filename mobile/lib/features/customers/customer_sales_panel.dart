import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/catalog_picker_field.dart';
import '../accounting/collection_sheet.dart';
import 'customer_picker.dart';

/// Müşteri kartındaki "Paket & Hizmet Satışları" paneli (web paritesi).
///
/// Aktif / tamamlanmış (seansı biten) / iptal edilmiş satışları listeler; her satırda satış tarihi,
/// SATAN PERSONEL, seans ve ödeme durumu bulunur. Satıra dokununca satış detayı açılır (kapsam +
/// aylık taksitler; aya dokununca taksit ayrıntısı ve tahsilat). "Geçmiş satış ekle" ile yazılıma
/// geçmeden önce yapılmış satışlar da sisteme girilir.

const _statusMeta = <String, (String, Color)>{
  'Active': ('Devam ediyor', AppColors.success),
  'Completed': ('Tamamlandı', Color(0xFF3B82F6)),
  'Cancelled': ('İptal', AppColors.danger),
};

String _saleStatus(Map<String, dynamic> a) {
  final s = '${a['saleStatus'] ?? 'Active'}';
  return _statusMeta.containsKey(s) ? s : 'Active';
}

String _fmtDate(dynamic iso) {
  final d = parseUtcToLocal(iso);
  if (d == null) return '—';
  return DateFormat('d MMM yyyy', 'tr_TR').format(d);
}

String _money(num? v) => NumberFormat.currency(locale: 'tr_TR', symbol: '₺', decimalDigits: 0)
    .format(v ?? 0);

// ------------------------------------------------------------------ özet ---

/// Müşterinin satışlarının tek bakışta özeti (kart rozeti + satış modalı başlığı aynı kaynağı kullanır).
class SalesSummary {
  const SalesSummary({
    required this.count,
    required this.active,
    required this.completed,
    required this.cancelled,
    required this.total,
    required this.paid,
    required this.remaining,
    required this.sessionsTotal,
    required this.sessionsUsed,
    this.lastSaleName,
    this.lastSaleAt,
  });

  /// İptaller dahil toplam satış kaydı.
  final int count;
  final int active;
  final int completed;
  final int cancelled;

  /// Tutarlar İPTAL EDİLEN satışları saymaz — iptal, ciroyu şişirmemeli.
  final double total;
  final double paid;
  final double remaining;
  final int sessionsTotal;
  final int sessionsUsed;
  final String? lastSaleName;
  final DateTime? lastSaleAt;

  double get paidPct => total > 0 ? (paid / total).clamp(0.0, 1.0) : 0;
}

SalesSummary salesSummaryOf(List<Map<String, dynamic>> accounts) {
  var active = 0, completed = 0, cancelled = 0, st = 0, su = 0;
  var total = 0.0, paid = 0.0, remaining = 0.0;
  String? lastName;
  DateTime? lastAt;
  for (final a in accounts) {
    final status = _saleStatus(a);
    if (status == 'Cancelled') {
      cancelled++;
      continue;
    }
    if (status == 'Active') {
      active++;
    } else {
      completed++;
    }
    total += numberOf(a, const ['totalAmount']).toDouble();
    paid += numberOf(a, const ['paidAmount']).toDouble();
    final rem = numberOf(a, const ['remainingAmount']).toDouble();
    remaining += rem > 0 ? rem : 0;
    st += numberOf(a, const ['sessionsTotal']).toInt();
    su += numberOf(a, const ['sessionsUsed']).toInt();
    final soldAt = parseUtcToLocal(a['soldAtUtc'] ?? a['createdAtUtc']);
    if (soldAt != null && (lastAt == null || soldAt.isAfter(lastAt))) {
      lastAt = soldAt;
      lastName = valueOf(a, const ['name']);
    }
  }
  return SalesSummary(
    count: accounts.length,
    active: active,
    completed: completed,
    cancelled: cancelled,
    total: total,
    paid: paid,
    remaining: remaining,
    sessionsTotal: st,
    sessionsUsed: su,
    lastSaleName: lastName,
    lastSaleAt: lastAt,
  );
}

/// İPTAL ARŞİVİNİ panelin anladığı satış satırına çevirir (SAF FONKSİYON — ağ yok, test edilir).
///
/// <p>
/// İptal bir DAMGA değil TAŞIMA'dır: canlı satır silinir, anlık görüntü arşive gider. Panel ise
/// sekmeleri yalnız `saleStatus`e bakarak ayırır. Bu çeviri olmadan "İptal" sekmesi HER ZAMAN
/// boştu — hem burada hem web'deki `CariSalesWorkspace`'te aynı kusur vardı.
/// </p>
///
/// <p>
/// `id` ARŞİV SATIRININ DEĞİL, ASIL CARİNİN kimliğidir: "İptali geri al" düğmesi
/// `/api/admin/accounts/{id}/restore-sale` uçlarına gider; arşiv kimliği yazılsa geri alma
/// yanlış kaydı hedefler ya da 404 döner.
/// </p>
List<Map<String, dynamic>> cancelledToPseudoAccounts(
  List<Map<String, dynamic>> cancelled, {
  String? customerId,
}) {
  final rows = customerId == null || customerId.isEmpty
      ? cancelled
      : cancelled.where((c) => '${c['customerId']}' == customerId);
  return rows.map<Map<String, dynamic>>((c) {
    final original = '${c['originalAccountId'] ?? ''}';
    return <String, dynamic>{
      ...c,
      'id': original.isEmpty || original == 'null' ? '${c['id']}' : original,
      'saleStatus': 'Cancelled',
      // İptalde ALACAK KALMAZ; tahsil edilen tutar kurumda KALAN paradır.
      'paidAmount': numberOf(c, const ['retainedAmount']),
      'remainingAmount': 0,
    };
  }).toList();
}

/// Müşterinin panelde görünecek TÜM satışları: canlı cariler + arşivden geri kurulan iptaller.
///
/// <p>
/// TEK KAYNAK: sheet'in ilk açılışı da, her işlemden sonraki tazelemesi de buradan geçer. Ayrı
/// ayrı yazıldığında tazeleme yolu iptalleri düşürüyor ve sekme ilk işlemden sonra boşalıyordu.
/// Sayfalama `getAllPaged` iledir — tek sayfa çok satışı olan müşteride listeyi sessizce keser.
/// </p>
Future<CustomerSalesLoad> loadCustomerSalesAccounts(
  ApiClient api,
  String customerId,
) async {
  // CANLI + ARŞİV TEK İSTEKTE, TEK ANLIK GÖRÜNTÜDEN.
  //
  // İkisi ayrı ayrı çekilirken araya giren bir iptal aynı satışı hem canlıda hem arşivde
  // gösterip ÇİFT saydırabiliyor, ters sırada ise hiçbirinde göstermeyip KAYBEDİYORDU
  // (1.000 TL satış / 400 TL iadede 2.000 brüt · 1.600 tahsilat gibi imkânsız rakamlar).
  // Sunucu ikisini tek transaction'da okur; yarış penceresi kapanır.
  //
  // Tek istek olduğu için "arşiv ayrı çöktü" durumu da ARTIK YOK: ya ikisi de gelir ya hiçbiri.
  // Hata YUTULMAZ — boş liste "satış yok" demektir, oysa gerçek "veri alınamadı"dır.
  // SAYFA BOYUTU GÖNDERİLMEZ. Burada `pageSize: 500` vardı ve 500'den fazla canlı satışı olan
  // müşteride fazlası SESSİZCE kesiliyordu — üstelik sheet'in özet rakamları bu eksik listeden
  // hesaplanıyordu. Uç, müşteri kapsamında listenin TAMAMINI döndürür ya da açıkça reddeder;
  // sayfaları burada dolaşmak (getAllPaged) her sayfayı ayrı ana düşürüp tek-anlık-görüntü
  // garantisini bozardı.
  final res = await api.get('/api/admin/accounts/with-archive',
      query: {'customerId': customerId});

  final map = res is Map ? res.cast<String, dynamic>() : const <String, dynamic>{};
  final live = apiItems(map['live'])
      .where((a) => '${a['customerId']}' == customerId)
      .toList();
  final cancelled = cancelledToPseudoAccounts(
      apiItems(map['cancelled']), customerId: customerId);

  return CustomerSalesLoad(accounts: [...live, ...cancelled]);
}

/// Satış yükleme sonucu: satırlar + ARŞİVİN OKUNUP OKUNAMADIĞI.
///
/// Bayrak olmadan "arşiv okunamadı" ile "hiç iptal yok" ekranda AYNI görünüyordu; ikisi
/// birbirinden ayrılmadan kullanıcı eksik veriye güvenip işlem yapabilir.
class CustomerSalesLoad {
  const CustomerSalesLoad({required this.accounts, this.archiveUnavailable = false});

  final List<Map<String, dynamic>> accounts;

  /// `true` → iptal arşivi okunamadı; "İptal" sekmesi "yüklenemedi" demeli, "yok" değil.
  final bool archiveUnavailable;
}

/// Satış listesini ayrı bir tam sayfa sheet'te açar (web'deki `CustomerSalesModal` karşılığı).
Future<void> openCustomerSalesSheet(
  BuildContext context, {
  required ApiClient api,
  required String customerId,
  required String customerName,
  required List<Map<String, dynamic>> accounts,
  required Future<void> Function() onChanged,
  bool canManage = true,
  bool archiveUnavailable = false,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => CustomerSalesSheet(
      api: api,
      customerId: customerId,
      customerName: customerName,
      accounts: accounts,
      onChanged: onChanged,
      canManage: canManage,
      archiveUnavailable: archiveUnavailable,
    ),
  );
}

/// "Paket & Hizmet Satışları" sheet'i — müşteri kartında yalnız özet durur, tam liste burada.
class CustomerSalesSheet extends StatefulWidget {
  const CustomerSalesSheet({
    required this.api,
    required this.customerId,
    required this.customerName,
    required this.accounts,
    required this.onChanged,
    this.canManage = true,
    this.archiveUnavailable = false,
    super.key,
  });

  final ApiClient api;
  final String customerId;
  final String customerName;
  final List<Map<String, dynamic>> accounts;
  final Future<void> Function() onChanged;
  final bool canManage;

  /// İptal arşivi okunamadıysa `true` — "İptal" sekmesi "yüklenemedi" der, "yok" DEMEZ.
  final bool archiveUnavailable;

  @override
  State<CustomerSalesSheet> createState() => _CustomerSalesSheetState();
}

class _CustomerSalesSheetState extends State<CustomerSalesSheet> {
  late List<Map<String, dynamic>> _accounts = widget.accounts;
  late bool _archiveUnavailable = widget.archiveUnavailable;

  /// Son tazeleme başarısız mı? `true` iken liste BAYAT'tır ve işlem yapılmamalıdır.
  bool _stale = false;

  /// Sheet ana ekranın state'inden kopya taşır; satış değişince hem ana ekranı
  /// hem de kendi listesini tazeler (yoksa sheet eski veriyi göstermeye devam ederdi).
  ///
  /// Tazeleme AÇILIŞLA AYNI kaynaktan (`loadCustomerSalesAccounts`) okur. Eskiden burada canlı
  /// cariler tek sayfa ve arşivsiz çekiliyordu: "İptal" sekmesi açılışta doluyor, ilk işlemden
  /// sonra KENDİ KENDİNE boşalıyordu — iptal edilen satış gözden kayboluyordu.
  Future<void> _handleChanged() async {
    await widget.onChanged();
    try {
      final load = await loadCustomerSalesAccounts(widget.api, widget.customerId);
      if (mounted) {
        setState(() {
          _accounts = load.accounts;
          _archiveUnavailable = load.archiveUnavailable;
          _stale = false;
        });
      }
    } catch (_) {
      // TAZELEME BAŞARISIZ = EKRANDAKİ VERİ ARTIK GÜVENİLMEZ.
      //
      // Sessiz kalmak, iptal edilmiş bir satışı ekranda CANLI ve TAHSİL EDİLEBİLİR bırakıyordu:
      // kullanıcı kapanmış bir satıştan tahsilat almaya çalışabilir ya da aynı satışı ikinci kez
      // iptal etmeyi deneyebilirdi. Liste bayat işaretlenir; kullanıcı açıkça uyarılır.
      if (mounted) setState(() => _stale = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = salesSummaryOf(_accounts);
    return DraggableScrollableSheet(
      initialChildSize: .92,
      minChildSize: .5,
      maxChildSize: .96,
      expand: false,
      builder: (context, controller) => Container(
        decoration: const BoxDecoration(
          color: AppColors.background,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          children: [
            const SizedBox(height: 10),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.surfaceSoft,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            // Başlık + özet şeridi
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: AppColors.surfaceSoft,
                          borderRadius: BorderRadius.circular(13),
                          border: Border.all(color: AppColors.border),
                        ),
                        child: const Icon(Icons.inventory_2_rounded,
                            size: 20, color: AppColors.primaryDark),
                      ),
                      const SizedBox(width: 11),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Paket & Hizmet Satışları',
                                style: TextStyle(
                                    fontSize: 16.5,
                                    fontWeight: FontWeight.w900,
                                    color: AppColors.ink)),
                            Text('${widget.customerName} · ${s.count} satış kaydı',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontSize: 11.5, color: AppColors.muted)),
                          ],
                        ),
                      ),
                      IconButton(
                        tooltip: 'Kapat',
                        onPressed: () => Navigator.pop(context),
                        icon: const Icon(Icons.close_rounded),
                        color: AppColors.muted,
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(child: _summaryTile('Toplam', _money(s.total), AppColors.ink)),
                      const SizedBox(width: 8),
                      Expanded(child: _summaryTile('Tahsil', _money(s.paid), AppColors.success)),
                      const SizedBox(width: 8),
                      Expanded(child: _summaryTile('Kalan', _money(s.remaining),
                          s.remaining > .5 ? AppColors.danger : AppColors.success)),
                    ],
                  ),
                  if (s.total > 0) ...[
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: LinearProgressIndicator(
                              value: s.paidPct,
                              minHeight: 6,
                              backgroundColor: AppColors.rose,
                              valueColor: AlwaysStoppedAnimation(
                                  s.remaining > .5 ? AppColors.primary : AppColors.success),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text('%${(s.paidPct * 100).round()} tahsil edildi',
                            style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w800,
                                color: AppColors.ink)),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            const Divider(height: 1, color: AppColors.border),
            Expanded(
              child: ListView(
                controller: controller,
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
                children: [
                  // ARŞİV OKUNAMADI UYARISI: bayrak olmadan "iptal yok" ile "iptal listesi
                  // alınamadı" ekranda AYNI görünüyordu. Kullanıcı iptal edilmiş bir satışı
                  // göremediği için ikinci kez iptal/tahsilat işlemi yapabilirdi.
                  // BAYAT LİSTE UYARISI: iptal/tahsilat sonrası tazeleme başarısızsa ekrandaki
                  // satış hâlâ "canlı" görünür. Kullanıcı kapanmış bir satıştan tahsilat almaya
                  // kalkışmadan önce bunu bilmeli.
                  if (_stale)
                    Container(
                      margin: const EdgeInsets.only(bottom: 12),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: AppColors.warning.withValues(alpha: .10),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppColors.warning.withValues(alpha: .40)),
                      ),
                      child: const Text(
                        'Liste güncellenemedi — ekrandaki satışlar SON DURUMU göstermiyor olabilir. '
                        'İşlem yapmadan önce sayfayı kapatıp yeniden açın.',
                        style: TextStyle(
                            fontSize: 11.5, fontWeight: FontWeight.w700, color: AppColors.warning),
                      ),
                    ),
                  if (_archiveUnavailable)
                    Container(
                      margin: const EdgeInsets.only(bottom: 12),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: AppColors.danger.withValues(alpha: .08),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppColors.danger.withValues(alpha: .35)),
                      ),
                      child: const Text(
                        'İptal edilen satışlar YÜKLENEMEDİ — liste eksik olabilir. '
                        'İşlem yapmadan önce sayfayı yenileyin.',
                        style: TextStyle(
                            fontSize: 11.5, fontWeight: FontWeight.w700, color: AppColors.danger),
                      ),
                    ),
                  CustomerSalesPanel(
                    api: widget.api,
                    customerId: widget.customerId,
                    customerName: widget.customerName,
                    accounts: _accounts,
                    canManage: widget.canManage,
                    onChanged: _handleChanged,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _summaryTile(String label, String value, Color tone) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(13),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label.toUpperCase(),
                style: const TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    letterSpacing: .6,
                    color: AppColors.muted)),
            const SizedBox(height: 2),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(value,
                  style: TextStyle(
                      fontSize: 15, fontWeight: FontWeight.w900, color: tone)),
            ),
          ],
        ),
      );
}

class CustomerSalesPanel extends StatefulWidget {
  const CustomerSalesPanel({
    required this.api,
    required this.customerId,
    required this.customerName,
    required this.accounts,
    required this.onChanged,
    this.canManage = true,
    super.key,
  });

  final ApiClient api;
  final String customerId;
  final String customerName;
  final List<Map<String, dynamic>> accounts;
  final Future<void> Function() onChanged;
  final bool canManage;

  @override
  State<CustomerSalesPanel> createState() => _CustomerSalesPanelState();
}

class _CustomerSalesPanelState extends State<CustomerSalesPanel> {
  String _filter = 'all';

  @override
  Widget build(BuildContext context) {
    // Satış tarihine göre yeni → eski (geçmiş kayıtlar da doğru yere oturur).
    final sorted = [...widget.accounts]
      ..sort((a, b) => '${b['soldAtUtc'] ?? b['createdAtUtc'] ?? ''}'
          .compareTo('${a['soldAtUtc'] ?? a['createdAtUtc'] ?? ''}'));
    final counts = <String, int>{'all': sorted.length, 'Active': 0, 'Completed': 0, 'Cancelled': 0};
    for (final a in sorted) {
      counts[_saleStatus(a)] = (counts[_saleStatus(a)] ?? 0) + 1;
    }
    final visible = _filter == 'all' ? sorted : sorted.where((a) => _saleStatus(a) == _filter).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Expanded(
              child: Text(
                'Aktif, biten ve iptal edilen satışlar',
                style: TextStyle(color: AppColors.muted, fontSize: 11.5),
              ),
            ),
            if (widget.canManage)
              TextButton.icon(
                onPressed: _openHistoricalForm,
                icon: const Icon(Icons.history_rounded, size: 16),
                label: const Text('Geçmiş satış'),
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.primaryDark,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  visualDensity: VisualDensity.compact,
                ),
              ),
          ],
        ),
        if (sorted.isNotEmpty) ...[
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            children: [
              for (final f in [
                ('all', 'Tümü'),
                ('Active', 'Devam eden'),
                ('Completed', 'Biten'),
                ('Cancelled', 'İptal'),
              ])
                if (f.$1 == 'all' || (counts[f.$1] ?? 0) > 0)
                  ChoiceChip(
                    label: Text('${f.$2} ${counts[f.$1] ?? 0}'),
                    selected: _filter == f.$1,
                    labelStyle: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: _filter == f.$1 ? Colors.white : AppColors.muted,
                    ),
                    selectedColor: AppColors.primaryDark,
                    onSelected: (_) => setState(() => _filter = f.$1),
                  ),
            ],
          ),
        ],
        const SizedBox(height: 8),
        if (visible.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 12),
            decoration: BoxDecoration(
              color: AppColors.surfaceSoft,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Text(
              sorted.isEmpty
                  ? 'Paket veya hizmet satışı yok. Geçmiş satışları da buradan girebilirsiniz.'
                  : 'Bu durumda satış yok.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.muted, fontSize: 12),
            ),
          )
        else
          for (final a in visible) _saleRow(a),
      ],
    );
  }

  Widget _saleRow(Map<String, dynamic> a) {
    final status = _saleStatus(a);
    final (label, color) = _statusMeta[status]!;
    final total = numberOf(a, const ['totalAmount']);
    final paid = numberOf(a, const ['paidAmount']);
    final remaining = numberOf(a, const ['remainingAmount']);
    final st = numberOf(a, const ['sessionsTotal']).toInt();
    final su = numberOf(a, const ['sessionsUsed']).toInt();
    final pct = total > 0 ? (paid / total).clamp(0.0, 1.0) : 1.0;
    final staff = '${a['soldByStaffName'] ?? ''}'.trim();
    final applier = '${a['appliedByStaffName'] ?? ''}'.trim();
    final reason = '${a['cancellationReason'] ?? ''}'.trim();

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: status == 'Cancelled' ? AppColors.surfaceSoft : AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => _openDetail(a),
        child: Padding(
          padding: const EdgeInsets.all(11),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      valueOf(a, const ['name']),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
                    ),
                  ),
                  Text(_money(total),
                      style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13)),
                ],
              ),
              const SizedBox(height: 5),
              Wrap(
                spacing: 6,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  _pill(label, color),
                  if (a['isHistorical'] == true) _pill('Geçmiş kayıt', const Color(0xFF6B4AA0)),
                  _meta(Icons.event_rounded, _fmtDate(a['soldAtUtc'] ?? a['createdAtUtc'])),
                  if (staff.isNotEmpty) _meta(Icons.person_rounded, staff),
                  if (applier.isNotEmpty) _meta(Icons.auto_awesome_rounded, applier),
                  // "2/4 seans" hangi sayının kalan olduğunu söylemiyordu — cevap yazılır.
                  if (st > 0)
                    _meta(Icons.confirmation_number_rounded, '${st - su} seans kaldı'),
                ],
              ),
              if (status == 'Cancelled' && reason.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text('Gerekçe: $reason',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 10.5, fontStyle: FontStyle.normal, color: AppColors.danger)),
              ],
              const SizedBox(height: 7),
              Row(
                children: [
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(3),
                      child: LinearProgressIndicator(
                        value: pct,
                        minHeight: 5,
                        backgroundColor: AppColors.surfaceSoft,
                        valueColor: AlwaysStoppedAnimation(
                            remaining > 0.005 ? AppColors.primary : AppColors.success),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    remaining > 0.005 ? '${_money(remaining)} kalan' : 'Ödendi',
                    style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                      color: remaining > 0.005 ? AppColors.danger : AppColors.success,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _pill(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: .1),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: color.withValues(alpha: .35)),
        ),
        child: Text(text,
            style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: color)),
      );

  Widget _meta(IconData icon, String text) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11, color: AppColors.primaryDark),
          const SizedBox(width: 3),
          Text(text, style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
        ],
      );

  Future<void> _openDetail(Map<String, dynamic> account) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => SaleDetailSheet(
        api: widget.api,
        account: account,
        customerName: widget.customerName,
        canManage: widget.canManage,
      ),
    );
    if (changed == true) await widget.onChanged();
  }

  Future<void> _openHistoricalForm() async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => HistoricalSaleSheet(
        api: widget.api,
        customerId: widget.customerId,
        customerName: widget.customerName,
      ),
    );
    if (saved == true) await widget.onChanged();
  }
}

// ------------------------------------------------------------------ detay ---

/// Satış detayı: kapsam (hizmet adı + tutarı) ve aylık taksitler; aya dokununca ayrıntı + tahsilat.
class SaleDetailSheet extends StatefulWidget {
  const SaleDetailSheet({
    required this.api,
    required this.account,
    required this.customerName,
    this.canManage = true,
    super.key,
  });

  final ApiClient api;
  final Map<String, dynamic> account;
  final String customerName;
  final bool canManage;

  @override
  State<SaleDetailSheet> createState() => _SaleDetailSheetState();
}

class _SaleDetailSheetState extends State<SaleDetailSheet> {
  late Map<String, dynamic> _a = widget.account;
  String? _openInstallment;
  bool _busy = false;
  bool _changed = false;

  Future<void> _refresh() async {
    final res = await widget.api.get('/api/admin/accounts/${_a['id']}');
    if (res is Map && mounted) setState(() => _a = res.cast<String, dynamic>());
  }

  /// Taksit satırından tahsilat: ortak tahsilat sayfasını bu cariye kilitli açar
  /// (tutar kalan borçla dolar; kısmi tahsilat için kullanıcı düşürebilir).
  Future<void> _collectInstallment(double remaining) async {
    final saved = await showCollectionSheet(
      context,
      api: widget.api,
      accounts: [_a],
      initialAccountId: '${_a['id']}',
      lockAccount: true,
      title: 'Taksit tahsilatı',
    );
    if (saved == null || saved == 0) return;
    _changed = true;
    await _refresh();
  }

  Future<void> _run(Future<void> Function() fn) async {
    setState(() => _busy = true);
    try {
      await fn();
      _changed = true;
      await _refresh();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = _saleStatus(_a);
    final (label, color) = _statusMeta[status]!;
    final total = numberOf(_a, const ['totalAmount']);
    final paid = numberOf(_a, const ['paidAmount']);
    final remaining = numberOf(_a, const ['remainingAmount']);
    final st = numberOf(_a, const ['sessionsTotal']).toInt();
    final su = numberOf(_a, const ['sessionsUsed']).toInt();
    final items = apiItems(_a['items']);
    final installments = apiItems(_a['installments'])
      ..sort((x, y) => numberOf(x, const ['no']).compareTo(numberOf(y, const ['no'])));
    final staff = '${_a['soldByStaffName'] ?? ''}'.trim();
    final applier = '${_a['appliedByStaffName'] ?? ''}'.trim();

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.pop(context, _changed);
      },
      child: DraggableScrollableSheet(
        initialChildSize: .88,
        minChildSize: .5,
        maxChildSize: .95,
        expand: false,
        builder: (context, controller) => Container(
          decoration: const BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            children: [
              const SizedBox(height: 10),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.surfaceSoft,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              Expanded(
                child: ListView(
                  controller: controller,
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 20),
                  children: [
                    // Başlık
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: [
                        _chip(label, color),
                        if (_a['isHistorical'] == true) _chip('Geçmiş kayıt', const Color(0xFF6B4AA0)),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(valueOf(_a, const ['name']),
                        style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 12,
                      runSpacing: 4,
                      children: [
                        _metaRow(Icons.person_rounded, widget.customerName),
                        _metaRow(Icons.event_rounded, _fmtDate(_a['soldAtUtc'] ?? _a['createdAtUtc'])),
                        if (staff.isNotEmpty) _metaRow(Icons.badge_rounded, 'Satan: $staff'),
                        if (applier.isNotEmpty)
                          _metaRow(Icons.auto_awesome_rounded, 'Uygulayan: $applier'),
                      ],
                    ),

                    if (status == 'Cancelled') ...[
                      const SizedBox(height: 10),
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: AppColors.danger.withValues(alpha: .08),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppColors.danger.withValues(alpha: .3)),
                        ),
                        child: Text(
                          'İptal edildi · ${_fmtDate(_a['cancelledAtUtc'])}'
                          '${'${_a['cancellationReason'] ?? ''}'.trim().isEmpty ? '' : ' — ${_a['cancellationReason']}'}',
                          style: const TextStyle(fontSize: 11.5, color: AppColors.danger),
                        ),
                      ),
                    ],

                    const SizedBox(height: 14),
                    // SATIŞ ÖZETİ — web paritesi: kutular değil, başlıklı tablo.
                    _sectionTitle('Satış özeti', Icons.account_balance_wallet_rounded),
                    const SizedBox(height: 6),
                    _TableShell(
                      header: const ['TUTAR', 'TAHSİL', 'KALAN', 'SEANS'],
                      aligns: const [TextAlign.left, TextAlign.right, TextAlign.right, TextAlign.right],
                      flex: const [4, 3, 3, 3],
                      rows: [
                        _TableRowData(
                          cells: [
                            _money(total),
                            _money(paid),
                            _money(remaining),
                            st > 0 ? '${st - su}/$st' : '—',
                          ],
                          colors: [
                            null,
                            AppColors.success,
                            remaining > 0.005 ? AppColors.danger : AppColors.success,
                            null,
                          ],
                          bold: true,
                        ),
                      ],
                      footer: LinearProgressIndicator(
                        value: total > 0 ? (paid / total).clamp(0, 1).toDouble() : 1,
                        minHeight: 5,
                        backgroundColor: AppColors.surfaceSoft,
                        valueColor: AlwaysStoppedAnimation(
                          remaining > 0.005 ? AppColors.primary : AppColors.success,
                        ),
                      ),
                    ),

                    const SizedBox(height: 16),
                    _sectionTitle('Kapsam', Icons.content_cut_rounded),
                    const SizedBox(height: 6),
                    if (items.isEmpty)
                      _emptyBox('Kalem bilgisi yok.')
                    else
                      _TableShell(
                        header: const ['HİZMET', 'SEANS', 'KALAN', 'TUTAR'],
                        aligns: const [TextAlign.left, TextAlign.right, TextAlign.right, TextAlign.right],
                        flex: const [5, 2, 2, 3],
                        rows: [
                          for (final item in items)
                            _TableRowData(cells: [
                              valueOf(item, const ['name']),
                              numberOf(item, const ['sessionsTotal']) > 0
                                  ? '${numberOf(item, const ['sessionsUsed']).toInt()}/${numberOf(item, const ['sessionsTotal']).toInt()}'
                                  : '—',
                              numberOf(item, const ['sessionsTotal']) > 0
                                  ? '${(numberOf(item, const ['sessionsTotal']) - numberOf(item, const ['sessionsUsed'])).toInt()}'
                                  : '—',
                              _money(numberOf(item, const ['amount'])),
                            ], colors: const [null, null, AppColors.success, null]),
                        ],
                        totalRow: items.length > 1
                            ? _TableRowData(cells: [
                                'TOPLAM',
                                st > 0 ? '$su/$st' : '—',
                                st > 0 ? '${st - su}' : '—',
                                _money(total),
                              ], bold: true)
                            : null,
                      ),

                    const SizedBox(height: 14),
                    _sectionTitle('Aylık Taksitler', Icons.credit_card_rounded),
                    const SizedBox(height: 6),
                    if (installments.isEmpty)
                      _emptyBox('Taksit planı yok — satış peşin kaydedilmiş.')
                    else
                      _installmentTable(installments),

                    if ('${_a['notes'] ?? ''}'.trim().isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: AppColors.warning.withValues(alpha: .08),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text('Not: ${_a['notes']}',
                            style: const TextStyle(fontSize: 11.5, color: AppColors.ink)),
                      ),
                    ],

                    if (widget.canManage) ...[
                      const SizedBox(height: 16),
                      if (status == 'Cancelled')
                        OutlinedButton.icon(
                          // voidRefund=false: gerçekten ödenmiş bir iade varsa kasa çıkışı korunur.
                          // İadeyi de geri almak İptal Arşivi ekranından açıkça seçilir.
                          onPressed: _busy ? null : () => _run(() => widget.api.post(
                              '/api/admin/accounts/${_a['id']}/restore-sale',
                              const {'voidRefund': false})),
                          icon: const Icon(Icons.replay_rounded, size: 17),
                          label: const Text('İptali geri al'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: AppColors.primaryDark,
                            minimumSize: const Size.fromHeight(44),
                          ),
                        )
                      else
                        OutlinedButton.icon(
                          onPressed: _busy ? null : _askCancel,
                          icon: const Icon(Icons.cancel_rounded, size: 17),
                          label: const Text('Satışı iptal et'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: AppColors.danger,
                            minimumSize: const Size.fromHeight(44),
                          ),
                        ),
                      const SizedBox(height: 6),
                      const Text(
                        'İptalde tahsilat geçmişi korunur.',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 10.5, color: AppColors.muted),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Taksitler tablosu — başlık satırı + sıkı satırlar; satıra dokununca tahsilat şeridi açılır.
  Widget _installmentTable(List<Map<String, dynamic>> installments) {
    final totalAmount = installments.fold<double>(0, (a, i) => a + numberOf(i, const ['amount']));
    final totalPaid = installments.fold<double>(0, (a, i) => a + numberOf(i, const ['paidAmount']));
    final totalRemaining = (totalAmount - totalPaid).clamp(0, double.infinity).toDouble();

    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          const _TableHeader(
            labels: ['#', 'VADE', 'TUTAR', 'KALAN', ''],
            flex: [1, 4, 3, 3, 1],
            aligns: [TextAlign.left, TextAlign.left, TextAlign.right, TextAlign.right, TextAlign.right],
          ),
          for (final inst in installments) _installmentRow(inst),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: const BoxDecoration(
              color: AppColors.surfaceSoft,
              border: Border(top: BorderSide(color: AppColors.border)),
            ),
            child: Row(
              children: [
                const Expanded(
                  flex: 5,
                  child: Text('TOPLAM', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w900)),
                ),
                Expanded(
                  flex: 3,
                  child: Text(_money(totalAmount),
                      textAlign: TextAlign.right,
                      style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w900)),
                ),
                Expanded(
                  flex: 3,
                  child: Text(_money(totalRemaining),
                      textAlign: TextAlign.right,
                      style: const TextStyle(
                          fontSize: 11.5, fontWeight: FontWeight.w900, color: AppColors.danger)),
                ),
                const Expanded(flex: 1, child: SizedBox()),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _installmentRow(Map<String, dynamic> inst) {
    final id = '${inst['id']}';
    final isOpen = _openInstallment == id;
    final amount = numberOf(inst, const ['amount']);
    final paidAmount = numberOf(inst, const ['paidAmount']);
    final remaining = (amount - paidAmount).clamp(0, double.infinity).toDouble();
    final paid = '${inst['status']}' == 'Paid' || remaining <= 0.005;
    final due = '${inst['dueDate'] ?? ''}'.split('T').first;
    final dueDate = DateTime.tryParse(due);
    final overdue = !paid && dueDate != null && dueDate.isBefore(DateTime.now());

    return Column(
      children: [
        InkWell(
          onTap: () => setState(() => _openInstallment = isOpen ? null : id),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
            decoration: BoxDecoration(
              color: paid
                  ? AppColors.success.withValues(alpha: .05)
                  : overdue
                      ? AppColors.danger.withValues(alpha: .05)
                      : Colors.transparent,
              border: const Border(top: BorderSide(color: AppColors.border)),
            ),
            child: Row(
              children: [
                Expanded(
                  flex: 1,
                  child: Text('${numberOf(inst, const ['no']).toInt()}',
                      style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800)),
                ),
                Expanded(
                  flex: 4,
                  child: Text(
                    dueDate != null ? DateFormat('dd.MM.yyyy').format(dueDate) : '—',
                    style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: overdue ? FontWeight.w700 : FontWeight.w500,
                      color: overdue ? AppColors.danger : AppColors.ink,
                    ),
                  ),
                ),
                Expanded(
                  flex: 3,
                  child: Text(_money(amount),
                      textAlign: TextAlign.right,
                      style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                ),
                Expanded(
                  flex: 3,
                  child: Text(
                    paid ? 'Ödendi' : _money(remaining),
                    textAlign: TextAlign.right,
                    style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w700,
                      color: paid ? AppColors.success : AppColors.danger,
                    ),
                  ),
                ),
                Expanded(
                  flex: 1,
                  child: Icon(
                    paid ? Icons.check_circle_rounded : (isOpen ? Icons.expand_less : Icons.expand_more),
                    size: 16,
                    color: paid ? AppColors.success : AppColors.muted,
                  ),
                ),
              ],
            ),
          ),
        ),
        if (isOpen)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
            decoration: const BoxDecoration(color: AppColors.surfaceSoft),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Tahsil edilen: ${_money(paidAmount)}'
                  '${overdue ? ' · vadesi geçti' : ''}',
                  style: const TextStyle(fontSize: 11, color: AppColors.muted),
                ),
                if (!paid && widget.canManage && _saleStatus(_a) != 'Cancelled') ...[
                  const SizedBox(height: 8),
                  FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.success,
                      minimumSize: const Size.fromHeight(38),
                    ),
                    // Eskiden tek dokunuşta NAKİT + "şimdi" damgasıyla yazıyordu; artık ortak
                    // tahsilat sayfası açılır (yöntem kırılımı, tarih ve dekont seçilebilsin).
                    onPressed: _busy ? null : () => _collectInstallment(remaining),
                    icon: const Icon(Icons.account_balance_wallet_rounded, size: 16),
                    label: Text('Bu taksiti tahsil et (${_money(remaining)})'),
                  ),
                ],
              ],
            ),
          ),
      ],
    );
  }

  /// Satış iptali. Kayıt canlı tablolardan silinip iptal arşivine taşınır (finansal iz korunur,
  /// yer değiştirir). Tahsil edilmiş para varsa ne kadarının müşteriye iade edildiği sorulur:
  /// iade edilen kısım gelir raporlarından da düşer, kalan kurumda sayılmaya devam eder.
  Future<void> _askCancel() async {
    final reasonCtrl = TextEditingController();
    final refundCtrl = TextEditingController();
    final collected = (_a['paidAmount'] as num?)?.toDouble() ?? 0;
    // Paranın hangi kanaldan çıktığı. Gönderilmezse sunucu NAKİT varsayar ve kart/havale iadesi
    // kasa kırılımında nakit çıkışı gibi görünür.
    var method = 'cash';

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('Satışı iptal et'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('İptal gerekçesini yazın (kayıtta görünür).',
                    style: TextStyle(fontSize: 12.5)),
                const SizedBox(height: 10),
                TextField(
                  controller: reasonCtrl,
                  autofocus: true,
                  decoration: const InputDecoration(
                    hintText: 'örn. müşteri vazgeçti, paket iade edildi',
                  ),
                ),
                if (collected > 0.005) ...[
                  const SizedBox(height: 14),
                  Text('Müşteriye iade edilen tutar (tahsil edilmiş: ${_money(collected)})',
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: refundCtrl,
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          decoration: const InputDecoration(hintText: '0'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      TextButton(
                        onPressed: () => refundCtrl.text = collected.toStringAsFixed(2),
                        child: const Text('Tamamı'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  const Text('İade yöntemi',
                      style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: 6,
                    children: [
                      for (final option in const [
                        ('cash', 'Nakit'),
                        ('card', 'Kart'),
                        ('transfer', 'Havale/EFT'),
                      ])
                        ChoiceChip(
                          label: Text(option.$2, style: const TextStyle(fontSize: 11.5)),
                          selected: method == option.$1,
                          onSelected: (_) => setLocal(() => method = option.$1),
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  const Text(
                      'Boş bırakılırsa para kurumda kaldı sayılır ve gelirde görünmeye devam eder.',
                      style: TextStyle(fontSize: 10.5, color: AppColors.muted)),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Vazgeç')),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('İptal et'),
            ),
          ],
        ),
      ),
    );
    if (ok != true) return;

    // SESSİZ KIRPMA YOK: tahsil edileni aşan tutar sunucuda doğrulama hatası döner ve kullanıcı
    // ne kaydedilmediğini görür (eskiden fark ettirmeden tahsil edilene çekiliyordu).
    final parsed = double.tryParse(refundCtrl.text.trim().replaceAll(',', '.')) ?? 0;
    final refunded = parsed <= 0 ? 0.0 : parsed;
    await _run(() => widget.api.post(
          '/api/admin/accounts/${_a['id']}/cancel-sale',
          {
            'reason': reasonCtrl.text.trim(),
            'refundedAmount': refunded,
            'refundMethod': method,
          },
        ));
  }

  Widget _sectionTitle(String text, IconData icon) => Row(
        children: [
          Icon(icon, size: 15, color: AppColors.primaryDark),
          const SizedBox(width: 6),
          Text(text.toUpperCase(),
              style: const TextStyle(
                  fontSize: 10.5, fontWeight: FontWeight.w800, color: AppColors.primaryDark)),
        ],
      );

  Widget _metaRow(IconData icon, String text) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: AppColors.primaryDark),
          const SizedBox(width: 4),
          Text(text, style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
        ],
      );

  Widget _chip(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: .1),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: color.withValues(alpha: .35)),
        ),
        child: Text(text,
            style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: color)),
      );

  Widget _emptyBox(String text) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 10),
        decoration: BoxDecoration(
          color: AppColors.surfaceSoft,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(text,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
      );
}

// --------------------------------------------------------------- geçmiş ---

/// Geçmiş satış girişi: yazılıma geçmeden önce satılmış paket/hizmet kaydı.
class HistoricalSaleSheet extends StatefulWidget {
  const HistoricalSaleSheet({
    required this.api,
    required this.customerId,
    required this.customerName,
    this.needsCustomer = false,
    this.preset,
    super.key,
  });

  final ApiClient api;

  /// Müşteri kartından açılışta dolu; katalog kartından açılışta boş bırakılır
  /// ve müşteri bu sayfadan aranarak seçilir.
  final String customerId;
  final String customerName;

  /// true → müşteri bu sayfada seçilir (katalog/hizmet-paket kartı akışı).
  final bool needsCustomer;

  /// Katalogdan açılışta satılan paket/hizmet peşin seçilir ve değiştirilmez.
  final ({String kind, String id, String name, double price})? preset;

  @override
  State<HistoricalSaleSheet> createState() => _HistoricalSaleSheetState();
}

class _HistoricalSaleSheetState extends State<HistoricalSaleSheet> {
  late String _kind; // package | service | free
  String? _pickedCustomerId;
  String? _pickedCustomerName;
  List<Map<String, dynamic>> _packages = const [];
  List<Map<String, dynamic>> _services = const [];
  List<Map<String, dynamic>> _staff = const [];
  String? _packageId;
  String? _serviceId;
  String? _staffId;
  DateTime? _soldAt;
  DateTime? _firstDue;
  final _name = TextEditingController();
  final _total = TextEditingController();
  final _paid = TextEditingController();
  final _sessionsTotal = TextEditingController();
  final _sessionsUsed = TextEditingController();
  final _installments = TextEditingController(text: '3');
  final _notes = TextEditingController();
  bool _loading = true;
  bool _saving = false;
  String? _error;

  // --- ödeme geçmişi (web paritesi): peşin mi taksitli mi, hangi aylar ödendi ---
  String _payKind = 'cash'; // cash | installment
  String _method = 'cash'; // cash | card | transfer
  /// Vade sırasıyla kaç taksitin ödendiği.
  int _paidCount = 0;

  // --- seanslar: kim yaptı + geçmiş randevu kaydı (web paritesi) ---
  /// Kullanılmış seansları uygulayan personel.
  String? _appliedStaffId;
  /// Yapılan seanslar için tamamlanmış geçmiş randevu açılsın mı.
  bool _makeAppointments = true;

  /// SEANS SEANS düzenleme. Kapalıyken tarihler "satış günü + n × aralık" ile üretilir ve
  /// hepsini tek personel yapmış sayılır. Açılınca her seansın tarihi ve personeli ayrı girilir
  /// — gerçek geçmişte seansları farklı kişiler farklı günlerde yapmış olur.
  bool _perSession = false;
  final List<({DateTime? date, String? staffId})> _sessionRows = [];
  final _sessionInterval = TextEditingController(text: '15');

  @override
  void initState() {
    super.initState();
    final preset = widget.preset;
    _kind = preset?.kind ?? 'package';
    if (preset != null) {
      if (preset.kind == 'package') {
        _packageId = preset.id;
      } else {
        _serviceId = preset.id;
      }
      _name.text = preset.name;
      _total.text = '${preset.price.toInt()}';
    }
    _loadLookups();
  }

  @override
  void dispose() {
    for (final c in [_name, _total, _paid, _sessionsTotal, _sessionsUsed, _installments, _notes, _sessionInterval]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _loadLookups() async {
    final res = await Future.wait<dynamic>([
      widget.api.get('/api/admin/packages/', query: {'page': 1, 'pageSize': 200})
          .catchError((_) => const <dynamic>[]),
      widget.api.get('/api/admin/services/', query: {'page': 1, 'pageSize': 200})
          .catchError((_) => const <dynamic>[]),
      widget.api.get('/api/admin/staff/', query: {'page': 1, 'pageSize': 200})
          .catchError((_) => const <dynamic>[]),
    ]);
    if (!mounted) return;
    setState(() {
      _packages = apiItems(res[0]);
      _services = apiItems(res[1]);
      _staff = apiItems(res[2]);
      _loading = false;
    });
  }

  double get _totalNum => double.tryParse(_total.text.replaceAll(',', '.')) ?? 0;

  /// Peşin satışta girilen tahsilat; boş bırakılırsa "tamamı ödendi" sayılır.
  double get _cashPaid => _paid.text.trim().isEmpty
      ? _totalNum
      : (double.tryParse(_paid.text.replaceAll(',', '.')) ?? 0);

  int get _instCount => (int.tryParse(_installments.text) ?? 0).clamp(0, 36);

  int get _sessionsTotalNum => (int.tryParse(_sessionsTotal.text) ?? 0).clamp(0, 999);
  int get _sessionsUsedNum =>
      (int.tryParse(_sessionsUsed.text) ?? 0).clamp(0, _sessionsTotalNum);
  bool get _sessionsDone => _sessionsTotalNum > 0 && _sessionsUsedNum >= _sessionsTotalNum;
  int get _intervalNum => (int.tryParse(_sessionInterval.text) ?? 15).clamp(1, 365);

  /// Aralık kuralının o seans için önereceği tarih — satır varsayılanı.
  DateTime? _defaultSessionDate(int index) {
    final soldAt = _soldAt;
    if (soldAt == null) return null;
    final d = soldAt.add(Duration(days: _intervalNum * index));
    final now = DateTime.now();
    return d.isAfter(now) ? now : d;
  }

  /// Satır sayısını seans adedine eşitler; KULLANICI GİRDİSİ KORUNUR (baştan kurmak, seans
  /// sayısını artıran kullanıcının önceki satırlarda girdiği tarih/personeli siliyordu).
  void _syncSessionRows() {
    final want = _sessionsUsedNum;
    while (_sessionRows.length > want) {
      _sessionRows.removeLast();
    }
    while (_sessionRows.length < want) {
      _sessionRows.add((date: _defaultSessionDate(_sessionRows.length), staffId: null));
    }
  }

  /// Oluşacak geçmiş randevuların tarihleri (önizleme) — bugünü aşan tarih bugüne çekilir.
  List<DateTime> get _appointmentDates {
    final soldAt = _soldAt;
    if (!_makeAppointments || _sessionsUsedNum <= 0 || soldAt == null) return const [];
    final now = DateTime.now();
    return [
      for (var i = 0; i < (_sessionsUsedNum > 6 ? 6 : _sessionsUsedNum); i++)
        () {
          final d = soldAt.add(Duration(days: _intervalNum * i));
          return d.isAfter(now) ? now : d;
        }(),
    ];
  }

  /// Vade verilmezse backend satıştan bir ay sonrasını kullanır — önizleme de öyle gösterir.
  DateTime? get _effectiveFirstDue {
    if (_firstDue != null) return _firstDue;
    if (_soldAt == null) return null;
    return DateTime(_soldAt!.year, _soldAt!.month + 1, _soldAt!.day);
  }

  /// Taksit planı: backend `RebuildInstallments` ile aynı bölme (artan kuruş son takside).
  List<({int no, DateTime due, double amount})> get _plan {
    final first = _effectiveFirstDue;
    if (_payKind != 'installment' || _instCount <= 0 || _totalNum <= 0 || first == null) {
      return const [];
    }
    final per = (_totalNum / _instCount * 100).round() / 100;
    final drift = ((_totalNum - per * _instCount) * 100).round() / 100;
    return [
      for (var i = 0; i < _instCount; i++)
        (
          no: i + 1,
          due: DateTime(first.year, first.month + i, first.day),
          amount: i == _instCount - 1 ? per + drift : per,
        ),
    ];
  }

  double get _paidNum => _payKind == 'cash'
      ? _cashPaid.clamp(0, _totalNum)
      : _plan.take(_paidCount).fold<double>(0, (s, x) => s + x.amount);

  double get _remaining => (_totalNum - _paidNum.clamp(0, _totalNum)).clamp(0, double.infinity);

  Future<void> _save() async {
    final customerId = widget.needsCustomer ? _pickedCustomerId : widget.customerId;
    if (customerId == null || customerId.isEmpty) {
      setState(() => _error = 'Müşteri seçin.');
      return;
    }
    final name = _name.text.trim();
    if (name.isEmpty) { setState(() => _error = 'Paket / hizmet adı zorunludur.'); return; }
    if (_soldAt == null) { setState(() => _error = 'Satış tarihi zorunludur.'); return; }
    if (_totalNum <= 0) { setState(() => _error = 'Tutar sıfırdan büyük olmalı.'); return; }
    if (_payKind == 'cash' && _cashPaid > _totalNum) {
      setState(() => _error = 'Tahsil edilen tutar toplamdan fazla olamaz.');
      return;
    }
    if (_payKind == 'installment' && _instCount <= 0) {
      setState(() => _error = 'Taksitli satışta taksit sayısı en az 1 olmalı.');
      return;
    }
    final st = int.tryParse(_sessionsTotal.text) ?? 0;
    final su = int.tryParse(_sessionsUsed.text) ?? 0;
    if (su > st) { setState(() => _error = 'Kullanılan seans toplamdan fazla olamaz.'); return; }
    // Seans takibi bir hizmete bağlıdır (paket seçilirse kalemlerinden gelir).
    if (st > 0 && _kind != 'package' && _serviceId == null) {
      setState(() => _error = 'Seans takibi için hizmet seçin.');
      return;
    }

    setState(() { _saving = true; _error = null; });
    try {
      await widget.api.post('/api/admin/accounts/historical', {
        'customerId': customerId,
        'name': name,
        'soldAtUtc': DateTime.utc(_soldAt!.year, _soldAt!.month, _soldAt!.day, 12).toIso8601String(),
        'totalAmount': _totalNum,
        'paidAmount': _paidNum.clamp(0, _totalNum),
        'soldByStaffMemberId': _staffId,
        'servicePackageId': _kind == 'package' ? _packageId : null,
        'serviceDefinitionId': _kind != 'package' ? _serviceId : null,
        'sessionsTotal': st,
        'sessionsUsed': su,
        'installmentCount': _payKind == 'installment' ? _instCount : 0,
        'firstDueDate': _payKind == 'installment' && _firstDue != null
            ? DateFormat('yyyy-MM-dd').format(_firstDue!)
            : null,
        // Ödeme geçmişi: ödenen aylar kendi vade tarihleriyle tahsilata yazılır →
        // geçmiş satış geçmiş cariye de düşer.
        'paidInstallmentCount': _payKind == 'installment' ? _paidCount : 0,
        'paymentMethod': _method,
        // Seansı kim yaptı + yapılan seanslar randevu geçmişine işlensin mi.
        'appliedByStaffMemberId': _appliedStaffId,
        'createSessionAppointments': _makeAppointments && su > 0,
        'sessionIntervalDays': _intervalNum,
        // SEANS DETAYLARI yalnız kullanıcı açtıysa gider; kapalıyken sunucu eski davranışa
        // (eşit aralık + tek personel) düşer. Boş alan null gider ve varsayılana düşer.
        if (_perSession && _makeAppointments && su > 0)
          'sessions': [
            for (final r in _sessionRows.take(su))
              {
                'performedAtUtc': r.date == null
                    ? null
                    : DateTime(r.date!.year, r.date!.month, r.date!.day, 12)
                        .toUtc()
                        .toIso8601String(),
                'staffMemberId': r.staffId,
              },
          ],
        'notes': _notes.text.trim().isEmpty ? null : _notes.text.trim(),
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // Sayfa neredeyse tam ekran açılır: seans seans tarih/personel girilirken .9'luk
    // yükseklikte form sürekli kaydırılıyordu (web modalinin genişletilmesinin karşılığı).
    return DraggableScrollableSheet(
      initialChildSize: .95,
      minChildSize: .5,
      maxChildSize: .98,
      expand: false,
      builder: (context, controller) => Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : Column(
                children: [
                  const SizedBox(height: 10),
                  Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.surfaceSoft,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  Expanded(
                    child: ListView(
                      controller: controller,
                      padding: const EdgeInsets.fromLTRB(16, 14, 16, 20),
                      children: [
                        const Text('Geçmiş satış ekle',
                            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
                        const SizedBox(height: 2),
                        Text(
                          '${widget.customerName} · yazılıma geçmeden önce yapılmış satışı sisteme işleyin',
                          style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
                        ),
                        const SizedBox(height: 14),

                        // Katalogdan açıldığında müşteri burada aranarak seçilir.
                        if (widget.needsCustomer) ...[
                          CustomerSelectField(
                            api: widget.api,
                            onSelected: (picked) => setState(() {
                              _pickedCustomerId = picked.id;
                              _pickedCustomerName = picked.name;
                            }),
                          ),
                          if (_pickedCustomerName != null)
                            Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: Text('Seçili: $_pickedCustomerName',
                                  style: const TextStyle(fontSize: 11, color: AppColors.muted)),
                            ),
                          const SizedBox(height: 12),
                        ],

                        // Katalogdan açılışta satılan kayıt sabittir; seçim gösterilmez.
                        if (widget.preset != null)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            decoration: BoxDecoration(
                              color: AppColors.primary.withValues(alpha: .08),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Row(
                              children: [
                                Icon(
                                  widget.preset!.kind == 'package'
                                      ? Icons.inventory_2_rounded
                                      : Icons.spa_rounded,
                                  size: 17,
                                  color: AppColors.primaryDark,
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(widget.preset!.name,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                                ),
                                Text(_money(widget.preset!.price),
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w700,
                                        fontSize: 12,
                                        color: AppColors.primaryDark)),
                              ],
                            ),
                          )
                        else
                          SegmentedButton<String>(
                            segments: const [
                              ButtonSegment(value: 'package', label: Text('Paket')),
                              ButtonSegment(value: 'service', label: Text('Hizmet')),
                              ButtonSegment(value: 'free', label: Text('Elle yaz')),
                            ],
                            selected: {_kind},
                            showSelectedIcon: false,
                            onSelectionChanged: (s) => setState(() => _kind = s.first),
                          ),
                        const SizedBox(height: 10),

                        // Satış modalindeki gibi kategori + alt kategori + aramalı seçici
                        // (düz dropdown'da 200 kalemli katalogda arama yoktu).
                        if (widget.preset == null && _kind == 'package')
                          CatalogPickerField(
                            items: _packages,
                            selectedId: _packageId,
                            label: 'Paket',
                            emptyText: 'Paket bulunamadı.',
                            clearable: true,
                            onChanged: (v) => setState(() {
                              _packageId = v;
                              final p = _packages.firstWhere((x) => '${x['id']}' == v,
                                  orElse: () => const {});
                              if (p.isNotEmpty) {
                                _name.text = valueOf(p, const ['name']);
                                if (_total.text.isEmpty) {
                                  _total.text = '${numberOf(p, const ['totalPrice']).toInt()}';
                                }
                              }
                            }),
                          ),
                        if (widget.preset == null && _kind == 'service')
                          CatalogPickerField(
                            items: _services,
                            selectedId: _serviceId,
                            label: 'Hizmet',
                            emptyText: 'Hizmet bulunamadı.',
                            clearable: true,
                            onChanged: (v) => setState(() {
                              _serviceId = v;
                              final s = _services.firstWhere((x) => '${x['id']}' == v,
                                  orElse: () => const {});
                              if (s.isNotEmpty) {
                                _name.text = valueOf(s, const ['name']);
                                if (_total.text.isEmpty) {
                                  _total.text = '${numberOf(s, const ['price']).toInt()}';
                                }
                              }
                            }),
                          ),
                        if (widget.preset == null) ...[
                          const SizedBox(height: 10),
                          TextField(
                            controller: _name,
                            decoration: const InputDecoration(
                              labelText: 'Paket / hizmet adı *',
                              hintText: 'örn. 2023 Lazer Epilasyon Paketi',
                            ),
                          ),
                        ],
                        const SizedBox(height: 10),

                        _dateField('Satış tarihi *', _soldAt, (d) => setState(() => _soldAt = d),
                            lastDate: DateTime.now()),
                        const SizedBox(height: 10),
                        DropdownButtonFormField<String>(
                          initialValue: _staffId,
                          isExpanded: true,
                          decoration: const InputDecoration(labelText: 'Satan personel'),
                          items: [
                            const DropdownMenuItem(value: null, child: Text('Belirtilmedi')),
                            for (final s in _staff)
                              DropdownMenuItem(
                                value: '${s['id']}',
                                child: Text(valueOf(s, const ['fullName', 'name']),
                                    overflow: TextOverflow.ellipsis),
                              ),
                          ],
                          onChanged: (v) => setState(() => _staffId = v),
                        ),
                        const SizedBox(height: 10),

                        TextField(
                          controller: _total,
                          keyboardType: TextInputType.number,
                          onChanged: (_) => setState(() {}),
                          decoration: const InputDecoration(labelText: 'Toplam tutar (₺) *'),
                        ),
                        const SizedBox(height: 14),

                        // NASIL ÖDENDİ — peşin mi, taksitliyse hangi aylar ödendi (web paritesi).
                        _paymentSection(),
                        const SizedBox(height: 14),
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _sessionsTotal,
                                keyboardType: TextInputType.number,
                                onChanged: (_) => setState(() {}),
                                decoration: const InputDecoration(labelText: 'Toplam seans'),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: TextField(
                                controller: _sessionsUsed,
                                keyboardType: TextInputType.number,
                                // Seans adedi değişince detay satırları da eşitlenir; yoksa
                                // 3'ten 5'e çıkan kullanıcıya hâlâ 3 satır gösterilirdi.
                                onChanged: (_) => setState(_syncSessionRows),
                                decoration: const InputDecoration(labelText: 'Kullanılan seans'),
                              ),
                            ),
                          ],
                        ),
                        if (_sessionsTotalNum > 0) _sessionsExtra(),

                        // Serbest kayıtta seans girilecekse hangi hizmetten düşeceği seçilir.
                        if (_kind == 'free' && (int.tryParse(_sessionsTotal.text) ?? 0) > 0) ...[
                          const SizedBox(height: 10),
                          DropdownButtonFormField<String>(
                            initialValue: _serviceId,
                            isExpanded: true,
                            decoration: const InputDecoration(
                              labelText: 'Seanslar hangi hizmetten düşülsün? *',
                            ),
                            items: [
                              for (final s in _services)
                                DropdownMenuItem(
                                  value: '${s['id']}',
                                  child: Text(valueOf(s, const ['name']),
                                      overflow: TextOverflow.ellipsis),
                                ),
                            ],
                            onChanged: (v) => setState(() => _serviceId = v),
                          ),
                        ],

                        const SizedBox(height: 10),
                        TextField(
                          controller: _notes,
                          decoration: const InputDecoration(labelText: 'Not (opsiyonel)'),
                        ),

                        if (_error != null) ...[
                          const SizedBox(height: 10),
                          Text(_error!,
                              style: const TextStyle(color: AppColors.danger, fontSize: 11.5)),
                        ],

                        const SizedBox(height: 16),
                        FilledButton.icon(
                          onPressed: _saving ? null : _save,
                          icon: _saving
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white))
                              : const Icon(Icons.check_rounded, size: 18),
                          label: const Text('Kaydet'),
                          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(46)),
                        ),
                        const SizedBox(height: 6),
                        const Text('Kayıt "Geçmiş kayıt" olarak işaretlenir.',
                            textAlign: TextAlign.center,
                            style: TextStyle(fontSize: 10.5, color: AppColors.muted)),
                      ],
                    ),
                  ),
                ],
              ),
      ),
    );
  }

  /// Seans durumu + "kim yaptı" + yapılan seansların randevu geçmişine işlenmesi.
  Widget _sessionsExtra() {
    final dates = _appointmentDates;
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Seanslar bitti mi? Tek dokunuşla "hepsi yapıldı".
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
            decoration: BoxDecoration(
              color: AppColors.surfaceSoft.withValues(alpha: .45),
              borderRadius: BorderRadius.circular(13),
              border: Border.all(color: AppColors.border),
            ),
            child: Row(
              children: [
                Icon(Icons.check_circle_rounded,
                    size: 17,
                    color: _sessionsDone ? AppColors.success : AppColors.muted),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _sessionsDone
                        ? 'Tüm seanslar tamamlandı'
                        : '$_sessionsUsedNum/$_sessionsTotalNum seans yapıldı · ${_sessionsTotalNum - _sessionsUsedNum} kaldı',
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                  ),
                ),
                TextButton(
                  onPressed: () => setState(() => _sessionsUsed.text =
                      _sessionsDone ? '0' : '$_sessionsTotalNum'),
                  style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      foregroundColor:
                          _sessionsDone ? AppColors.muted : AppColors.success),
                  child: Text(_sessionsDone ? 'Sıfırla' : 'Tümü tamam',
                      style: const TextStyle(fontSize: 11.5)),
                ),
              ],
            ),
          ),
          if (_sessionsUsedNum > 0) ...[
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _appliedStaffId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Seansları uygulayan personel'),
              items: [
                const DropdownMenuItem(value: null, child: Text('Belirtilmedi')),
                for (final s in _staff)
                  DropdownMenuItem(
                    value: '${s['id']}',
                    child: Text(valueOf(s, const ['fullName', 'name']),
                        overflow: TextOverflow.ellipsis),
                  ),
              ],
              onChanged: (v) => setState(() => _appliedStaffId = v),
            ),
            const SizedBox(height: 10),
            // Geçmiş seanslar randevular sayfasında da görünsün.
            Container(
              padding: const EdgeInsets.all(11),
              decoration: BoxDecoration(
                color: AppColors.surfaceSoft.withValues(alpha: .45),
                borderRadius: BorderRadius.circular(13),
                border: Border.all(color: AppColors.border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    controlAffinity: ListTileControlAffinity.leading,
                    dense: true,
                    value: _makeAppointments,
                    onChanged: (v) => setState(() => _makeAppointments = v ?? false),
                    title: const Text('Yapılan seanslar randevu geçmişine işlensin',
                        style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                    subtitle: Text(
                      '$_sessionsUsedNum adet tamamlanmış geçmiş randevu açılır; randevular '
                      'sayfasında görünür. Ciro iki kez sayılmasın diye tutarı 0 yazılır.',
                      style: const TextStyle(fontSize: 11, color: AppColors.muted, height: 1.35),
                    ),
                  ),
                  if (_makeAppointments) ...[
                    const SizedBox(height: 8),
                    // SEANS SEANS mi, eşit aralık mı? Varsayılan eşit aralık — çoğu geçmiş
                    // kayıtta kullanıcı tek tek tarih girmek istemiyor.
                    Wrap(
                      spacing: 6,
                      children: [
                        ChoiceChip(
                          selected: !_perSession,
                          onSelected: (_) => setState(() => _perSession = false),
                          label: const Text('Eşit aralıkla üret',
                              style: TextStyle(fontSize: 11.5)),
                        ),
                        ChoiceChip(
                          selected: _perSession,
                          onSelected: (_) => setState(() {
                            _perSession = true;
                            _syncSessionRows();
                          }),
                          label: const Text('Seansları tek tek gir',
                              style: TextStyle(fontSize: 11.5)),
                        ),
                      ],
                    ),
                    if (!_perSession) ...[
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          SizedBox(
                            width: 120,
                            child: TextField(
                              controller: _sessionInterval,
                              keyboardType: TextInputType.number,
                              onChanged: (_) => setState(() {}),
                              decoration: const InputDecoration(
                                  isDense: true, labelText: 'Aralık (gün)'),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              dates.isEmpty
                                  ? 'Satış tarihini girin.'
                                  : dates
                                      .map((d) => DateFormat('d MMM yyyy', 'tr_TR').format(d))
                                      .join(' · '),
                              style: const TextStyle(fontSize: 11, color: AppColors.muted),
                            ),
                          ),
                        ],
                      ),
                    ] else ...[
                      const SizedBox(height: 6),
                      const Text(
                          'Her seansın ne zaman ve kim tarafından yapıldığını girin. Boş bıraktığınız alan varsayılana düşer.',
                          style: TextStyle(
                              fontSize: 11, color: AppColors.muted, height: 1.35)),
                      const SizedBox(height: 8),
                      // HEPSİNE UYGULA — seansların çoğunu tek kişi yapmışsa satır satır
                      // seçtirmek gereksiz iş. Seçim sonrası tek tek düzeltilebilir.
                      if (_staff.isNotEmpty && _sessionRows.length > 1) ...[
                        DropdownButtonFormField<String>(
                          initialValue: null,
                          isExpanded: true,
                          decoration: const InputDecoration(
                            isDense: true,
                            labelText: 'Hepsini yapan personel',
                            helperText: 'Seçince tüm seanslara uygulanır',
                          ),
                          items: [
                            for (final st in _staff)
                              DropdownMenuItem(
                                value: valueOf(st, const ['id']),
                                child: Text(valueOf(st, const ['fullName', 'name']),
                                    overflow: TextOverflow.ellipsis),
                              ),
                          ],
                          onChanged: (v) {
                            if (v == null) return;
                            setState(() {
                              for (var i = 0; i < _sessionRows.length; i++) {
                                _sessionRows[i] =
                                    (date: _sessionRows[i].date, staffId: v);
                              }
                            });
                          },
                        ),
                        const SizedBox(height: 10),
                      ],
                      // Satır: sıra + seçili personel rozeti üstte, tarih ve personel altta
                      // ALT ALTA. Telefonda yan yana konunca personel adı kırpılıyordu.
                      for (var i = 0; i < _sessionRows.length; i++)
                        Builder(builder: (_) {
                          final staffName = _staff
                              .where((st) =>
                                  valueOf(st, const ['id']) == _sessionRows[i].staffId)
                              .map((st) => valueOf(st, const ['fullName', 'name']))
                              .firstOrNull;
                          return Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: AppColors.border),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Container(
                                      width: 22,
                                      height: 22,
                                      alignment: Alignment.center,
                                      decoration: const BoxDecoration(
                                        color: AppColors.primary,
                                        shape: BoxShape.circle,
                                      ),
                                      child: Text('${i + 1}',
                                          style: const TextStyle(
                                              fontSize: 10.5,
                                              fontWeight: FontWeight.w800,
                                              color: Colors.white)),
                                    ),
                                    const SizedBox(width: 8),
                                    Text('${i + 1}. seans',
                                        style: const TextStyle(
                                            fontSize: 11.5,
                                            fontWeight: FontWeight.w700)),
                                    const Spacer(),
                                    // Seçilen personel ROZETLE de yazılır: dar açılır listede
                                    // ad kırpılınca kimin seçildiği okunmuyordu.
                                    Flexible(
                                      child: Text(staffName ?? 'Varsayılan personel',
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          textAlign: TextAlign.right,
                                          style: TextStyle(
                                              fontSize: 10.5,
                                              fontWeight: FontWeight.w700,
                                              color: staffName == null
                                                  ? AppColors.muted
                                                  : AppColors.primaryDark)),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 6),
                                SizedBox(
                                  width: double.infinity,
                                  child: OutlinedButton.icon(
                                    onPressed: () async {
                                      final picked = await showDatePicker(
                                        context: context,
                                        initialDate: _sessionRows[i].date ??
                                            _defaultSessionDate(i) ??
                                            DateTime.now(),
                                        firstDate: DateTime(2015),
                                        lastDate: DateTime.now(),
                                      );
                                      if (picked == null) return;
                                      setState(() => _sessionRows[i] = (
                                            date: picked,
                                            staffId: _sessionRows[i].staffId
                                          ));
                                    },
                                    style: OutlinedButton.styleFrom(
                                        visualDensity: VisualDensity.compact),
                                    icon: const Icon(Icons.event_rounded, size: 15),
                                    label: Text(
                                        _sessionRows[i].date == null
                                            ? 'Tarih seç'
                                            : DateFormat('d MMM yyyy', 'tr_TR')
                                                .format(_sessionRows[i].date!),
                                        style: const TextStyle(fontSize: 11.5)),
                                  ),
                                ),
                                const SizedBox(height: 6),
                                DropdownButtonFormField<String>(
                                  initialValue: _sessionRows[i].staffId,
                                  isExpanded: true,
                                  decoration: const InputDecoration(
                                      isDense: true, labelText: 'Seansı yapan'),
                                  items: [
                                    const DropdownMenuItem(
                                        value: null, child: Text('Varsayılan personel')),
                                    for (final st in _staff)
                                      DropdownMenuItem(
                                        value: valueOf(st, const ['id']),
                                        child: Text(
                                            valueOf(st, const ['fullName', 'name']),
                                            overflow: TextOverflow.ellipsis),
                                      ),
                                  ],
                                  onChanged: (v) => setState(() => _sessionRows[i] =
                                      (date: _sessionRows[i].date, staffId: v)),
                                ),
                              ],
                            ),
                          );
                        }),
                    ],
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// "Nasıl ödendi?" bloğu: peşin / taksitli + yöntem + hangi ayların ödendiği.
  Widget _paymentSection() {
    final plan = _plan;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceSoft.withValues(alpha: .45),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.account_balance_wallet_rounded,
                  size: 15, color: AppColors.primary),
              const SizedBox(width: 6),
              const Expanded(
                child: Text('Nasıl ödendi?',
                    style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                        color: AppColors.primaryDark)),
              ),
              DropdownButton<String>(
                value: _method,
                underline: const SizedBox.shrink(),
                isDense: true,
                style: const TextStyle(fontSize: 12.5, color: AppColors.ink),
                items: const [
                  DropdownMenuItem(value: 'cash', child: Text('Nakit')),
                  DropdownMenuItem(value: 'card', child: Text('Kart')),
                  DropdownMenuItem(value: 'transfer', child: Text('Havale/EFT')),
                ],
                onChanged: (v) => setState(() => _method = v ?? 'cash'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(
                  value: 'cash', label: Text('Peşin'), icon: Icon(Icons.payments_rounded, size: 15)),
              ButtonSegment(
                  value: 'installment',
                  label: Text('Taksitli'),
                  icon: Icon(Icons.credit_card_rounded, size: 15)),
            ],
            selected: {_payKind},
            showSelectedIcon: false,
            onSelectionChanged: (s) => setState(() => _payKind = s.first),
          ),
          const SizedBox(height: 10),

          if (_payKind == 'cash') ...[
            TextField(
              controller: _paid,
              keyboardType: TextInputType.number,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                labelText: 'Tahsil edilen (₺)',
                hintText: _totalNum > 0 ? '${_totalNum.toInt()} (tamamı)' : '0',
              ),
            ),
            const SizedBox(height: 6),
            const Text('Boş bırakırsanız tamamı ödendi sayılır; tahsilat satış tarihine yazılır.',
                style: TextStyle(fontSize: 11, color: AppColors.muted)),
          ] else ...[
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _installments,
                    keyboardType: TextInputType.number,
                    onChanged: (_) => setState(() {
                      if (_paidCount > _instCount) _paidCount = _instCount;
                    }),
                    decoration: const InputDecoration(labelText: 'Taksit sayısı *'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _dateField('İlk taksit ayı', _firstDue,
                      (d) => setState(() => _firstDue = d),
                      lastDate: DateTime.now().add(const Duration(days: 3650))),
                ),
              ],
            ),
            const SizedBox(height: 10),
            if (plan.isEmpty)
              const Text('Plan için satış tarihi, tutar ve taksit sayısını girin.',
                  style: TextStyle(fontSize: 11.5, color: AppColors.muted))
            else ...[
              Row(
                children: [
                  Expanded(
                    child: Text('Hangi aylar ödendi? $_paidCount/${plan.length}',
                        style: const TextStyle(
                            fontSize: 12, fontWeight: FontWeight.w800, color: AppColors.ink)),
                  ),
                  TextButton(
                    onPressed: () => setState(() => _paidCount = plan.length),
                    style: TextButton.styleFrom(
                        foregroundColor: AppColors.success,
                        visualDensity: VisualDensity.compact,
                        padding: const EdgeInsets.symmetric(horizontal: 8)),
                    child: const Text('Tümü', style: TextStyle(fontSize: 11.5)),
                  ),
                  TextButton(
                    onPressed: () => setState(() => _paidCount = 0),
                    style: TextButton.styleFrom(
                        foregroundColor: AppColors.muted,
                        visualDensity: VisualDensity.compact,
                        padding: const EdgeInsets.symmetric(horizontal: 8)),
                    child: const Text('Hiçbiri', style: TextStyle(fontSize: 11.5)),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              // Bir aya dokununca o ay ve öncesi ödenmiş sayılır (taksitler vade sırasıyla kapanır).
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final p in plan)
                    InkWell(
                      borderRadius: BorderRadius.circular(11),
                      onTap: () => setState(
                          () => _paidCount = _paidCount == p.no ? p.no - 1 : p.no),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                        decoration: BoxDecoration(
                          color: p.no <= _paidCount
                              ? AppColors.success.withValues(alpha: .10)
                              : AppColors.surface,
                          borderRadius: BorderRadius.circular(11),
                          border: Border.all(
                              color: p.no <= _paidCount
                                  ? AppColors.success.withValues(alpha: .45)
                                  : AppColors.border),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              p.no <= _paidCount
                                  ? Icons.check_circle_rounded
                                  : Icons.circle_outlined,
                              size: 15,
                              color: p.no <= _paidCount ? AppColors.success : AppColors.muted,
                            ),
                            const SizedBox(width: 6),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(DateFormat('MMM yyyy', 'tr_TR').format(p.due),
                                    style: const TextStyle(
                                        fontSize: 11.5, fontWeight: FontWeight.w800)),
                                Text(_money(p.amount),
                                    style: TextStyle(
                                        fontSize: 10.5,
                                        color: p.no <= _paidCount
                                            ? AppColors.success
                                            : AppColors.muted)),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 8),
              const Text(
                  'Bir aya dokununca o ay ve öncesi ödenmiş sayılır; ödemeler kendi vade tarihiyle cariye işlenir.',
                  style: TextStyle(fontSize: 11, color: AppColors.muted)),
            ],
          ],

          const SizedBox(height: 10),
          const Divider(height: 1, color: AppColors.border),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Text('Tahsil edilen ${_money(_paidNum)}',
                    style: const TextStyle(fontSize: 12, color: AppColors.muted)),
              ),
              Text(
                _remaining > .5 ? '${_money(_remaining)} kalan' : 'Borç kalmadı',
                style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: _remaining > .5 ? AppColors.danger : AppColors.success),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _dateField(String label, DateTime? value, ValueChanged<DateTime> onPick,
      {DateTime? lastDate}) {
    return InkWell(
      onTap: () async {
        final now = DateTime.now();
        final picked = await showDatePicker(
          context: context,
          initialDate: value ?? now,
          firstDate: DateTime(2000),
          lastDate: lastDate ?? now,
        );
        if (picked != null) onPick(picked);
      },
      child: InputDecorator(
        decoration: InputDecoration(labelText: label),
        child: Text(
          value == null ? 'Seçiniz' : DateFormat('d MMMM yyyy', 'tr_TR').format(value),
          style: TextStyle(
            fontSize: 13,
            color: value == null ? AppColors.muted : AppColors.ink,
          ),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------ tablo parçaları ---

/// Tablo başlık satırı (küçük, harf aralıklı, gri).
class _TableHeader extends StatelessWidget {
  const _TableHeader({required this.labels, required this.flex, required this.aligns});

  final List<String> labels;
  final List<int> flex;
  final List<TextAlign> aligns;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      color: AppColors.primary.withValues(alpha: .06),
      child: Row(
        children: [
          for (var i = 0; i < labels.length; i++)
            Expanded(
              flex: flex[i],
              child: Text(
                labels[i],
                textAlign: aligns[i],
                style: const TextStyle(
                  fontSize: 9,
                  fontWeight: FontWeight.w800,
                  letterSpacing: .7,
                  color: AppColors.muted,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Tek tablo satırının verisi (hücre metinleri + isteğe bağlı renkler).
class _TableRowData {
  const _TableRowData({required this.cells, this.colors, this.bold = false});

  final List<String> cells;
  final List<Color?>? colors;
  final bool bold;
}

/// Başlıklı, çerçeveli basit tablo — satış detayında özet ve kapsam blokları için.
class _TableShell extends StatelessWidget {
  const _TableShell({
    required this.header,
    required this.rows,
    required this.flex,
    required this.aligns,
    this.totalRow,
    this.footer,
  });

  final List<String> header;
  final List<_TableRowData> rows;
  final List<int> flex;
  final List<TextAlign> aligns;
  final _TableRowData? totalRow;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    Widget line(_TableRowData row, {bool total = false}) => Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
          decoration: BoxDecoration(
            color: total ? AppColors.surfaceSoft : Colors.transparent,
            border: const Border(top: BorderSide(color: AppColors.border)),
          ),
          child: Row(
            children: [
              for (var i = 0; i < row.cells.length; i++)
                Expanded(
                  flex: flex[i],
                  child: Text(
                    row.cells[i],
                    textAlign: aligns[i],
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: row.bold ? FontWeight.w900 : FontWeight.w600,
                      color: row.colors != null && i < row.colors!.length
                          ? (row.colors![i] ?? AppColors.ink)
                          : AppColors.ink,
                    ),
                  ),
                ),
            ],
          ),
        );

    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          _TableHeader(labels: header, flex: flex, aligns: aligns),
          for (final row in rows) line(row),
          if (totalRow != null) line(totalRow!, total: true),
          if (footer != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 0, 10, 10),
              child: ClipRRect(borderRadius: BorderRadius.circular(4), child: footer),
            ),
        ],
      ),
    );
  }
}
