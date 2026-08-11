import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/payment_method.dart';
import '../appointments/calendar_theme.dart';
import 'account_grouping.dart';
import 'account_installments.dart';
import 'payment_schedule_grid.dart';

/// MÜŞTERİ CARİ DEFTERİ — Ön Muhasebe tablosundan açılan TAM EKRAN sayfa (web
/// `CustomerLedgerModal` paritesi).
///
/// Liste satırı müşteridir; bu sayfa o müşterinin BÜTÜN satışlarını tek yerde toplar:
///  · Ay ay taksit takvimi (yeşil ödendi / kırmızı gecikmiş)
///  · Satış satırları — her biri kendi cari kartı, tahsilat oraya yazılır
///  · Birleşik ekstre (tüm satışların tahsilatları, tarih sırasıyla)
///
/// TAHSİLAT HÂLÂ SATIŞ BAZINDA: gruplama yalnız GÖRÜNÜMdür. Müşteri düzeyinde tek bir
/// "hepsini öde" düğmesi, parayı hangi satışa yazacağını bilemezdi (sunucu tahsilatı hesaba
/// yazar ve vade sırasıyla dağıtır).
Future<void> openCustomerLedgerSheet(
  BuildContext context, {
  required CustomerAccountGroup group,
  /// Bu müşterinin İPTAL arşivi — iptal edilen satışın tahsilat/iadesi canlı listede YOKTUR.
  List<Map<String, dynamic>> cancelledSales = const [],
  required Future<void> Function(Map<String, dynamic> account) onCollect,
  required Future<void> Function(Map<String, dynamic> account) onOpenSale,
  required Future<void> Function() onOpenSalesWorkspace,
  /// Defterin KENDİ verisini tazelemesi için: tahsilat sonrası açık kalan sayfa eski rakamları
  /// göstermesin (aşağıdaki `_refresh`). Verilmezse sayfa anlık görüntüyle çalışır.
  Future<LedgerRefresh> Function()? onRefresh,
}) {
  return Navigator.of(context).push<void>(MaterialPageRoute(
    fullscreenDialog: true,
    builder: (_) => CustomerLedgerScreen(
      group: group,
      cancelledSales: cancelledSales,
      onCollect: onCollect,
      onOpenSale: onOpenSale,
      onOpenSalesWorkspace: onOpenSalesWorkspace,
      onRefresh: onRefresh,
    ),
  ));
}

/// Defter tazeleme SONUCU — "veri geldi", "satış kalmadı" ve "okunamadı" AYRI durumlardır.
///
/// <p>
/// Üçü de eskiden `null` ile ifade ediliyordu ve ekran hepsinde eski satırları OLDUĞU GİBİ
/// göstermeye devam ediyordu. Somut sonuç: satış başka bir cihazda iptal/iade edilmişken açık
/// defter o satışı CANLI ve TAHSİL EDİLEBİLİR göstermeyi sürdürüyor, kullanıcı kapanmış bir
/// satıştan tahsilat almaya kalkabiliyordu. Sessiz bayat veri, para ekranında boş ekrandan
/// tehlikelidir: kullanıcı gördüğü rakama güvenerek işlem yapar.
/// </p>
class LedgerRefresh {
  /// Taze veri geldi.
  const LedgerRefresh.loaded(CustomerAccountGroup this.group)
      : failed = false,
        gone = false;

  /// Sunucuda bu müşterinin CANLI satışı kalmadı (iptal edilmiş/silinmiş).
  const LedgerRefresh.gone()
      : group = null,
        failed = false,
        gone = true;

  /// Tazeleme başarısız — ekrandaki veri BAYAT; doğruluğu bilinmiyor.
  const LedgerRefresh.failed()
      : group = null,
        failed = true,
        gone = false;

  final CustomerAccountGroup? group;
  final bool failed;
  final bool gone;

  /// Ekrandaki rakamlara güvenilemez → para işlemleri kapatılır.
  bool get blocksActions => failed || gone;
}

class CustomerLedgerScreen extends StatefulWidget {
  const CustomerLedgerScreen({
    required this.group,
    this.cancelledSales = const [],
    required this.onCollect,
    required this.onOpenSale,
    required this.onOpenSalesWorkspace,
    this.onRefresh,
    super.key,
  });

  final CustomerAccountGroup group;

  /// İptal arşivi: satırları canlı tablodan silinir, parası yalnız buradan okunur.
  final List<Map<String, dynamic>> cancelledSales;
  final Future<void> Function(Map<String, dynamic> account) onCollect;
  final Future<void> Function(Map<String, dynamic> account) onOpenSale;
  final Future<void> Function() onOpenSalesWorkspace;

  /// Tahsilat sonrası defteri tazeler (bkz. `_refresh`).
  final Future<LedgerRefresh> Function()? onRefresh;

  @override
  State<CustomerLedgerScreen> createState() => _CustomerLedgerScreenState();
}

class _CustomerLedgerScreenState extends State<CustomerLedgerScreen> {
  int _tab = 0;

  /// Ekranda GÖSTERİLEN grup. Tahsilat sonrası tazelenir; başlangıçta çağıranın verdiği anlık
  /// görüntüdür.
  late CustomerAccountGroup _group = widget.group;

  /// Tazeleme başarısız oldu ya da satış artık yok → ekrandaki rakamlar BAYAT.
  LedgerRefresh? _staleReason;

  /// TAHSİLAT SONRASI DEFTER TAZELENİR. Sayfa açık kalırken tahsilat alınınca KPI'lar, taksit
  /// takvimi ve ekstre eski rakamları göstermeye devam ediyordu (kullanıcı "para işlenmedi mi"
  /// diye ikinci kez tahsilat almaya kalkabilirdi).
  ///
  /// BAŞARISIZLIK ARTIK YUTULMAZ. Eskiden tazeleme hatası da "satış kalmadı" durumu da sessizce
  /// eski veriyi bırakıyordu: iptal/iade edilmiş bir satış ekranda CANLI ve TAHSİL EDİLEBİLİR
  /// kalıyor, kullanıcı kapanmış bir satıştan para almaya kalkabiliyordu. Artık ekran bayat
  /// olduğunu SÖYLER ve para düğmelerini KAPATIR — yenilenene kadar.
  Future<void> _refresh() async {
    final next = await widget.onRefresh?.call();
    if (next == null || !mounted) return;
    setState(() {
      _staleReason = next.blocksActions ? next : null;
      final fresh = next.group;
      if (fresh != null) _group = fresh;
    });
  }

  /// Bayatken para işlemleri kapalıdır (bkz. `_refresh`).
  bool get _blocked => _staleReason?.blocksActions == true;

  /// "Bu ekran güncel değil" şeridi — iki farklı sebep, iki farklı cümle.
  Widget _staleBanner() {
    final gone = _staleReason?.gone == true;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF1F2),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFFECDD3)),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Icon(Icons.warning_amber_rounded, size: 18, color: Color(0xFFB91C1C)),
        const SizedBox(width: 8),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(
              gone ? 'Bu satış artık açık değil' : 'Ekran güncellenemedi',
              style: const TextStyle(
                  fontSize: 12.5, fontWeight: FontWeight.w800, color: Color(0xFF9F1239)),
            ),
            const SizedBox(height: 2),
            Text(
              gone
                  ? 'Satış iptal edilmiş ya da kaldırılmış olabilir. Aşağıdaki rakamlar son '
                      'görüntüdür; tahsilat kapatıldı. Sayfayı kapatıp listeyi yenileyin.'
                  : 'Veriler sunucudan alınamadı; aşağıdaki rakamlar ESKİ olabilir. Yanlış '
                      'tutardan tahsilat alınmasın diye para işlemleri kapatıldı.',
              style: const TextStyle(fontSize: 11.5, color: Color(0xFF9F1239), height: 1.35),
            ),
            const SizedBox(height: 6),
            SizedBox(
              height: 30,
              child: OutlinedButton.icon(
                onPressed: _refresh,
                icon: const Icon(Icons.refresh_rounded, size: 15),
                label: const Text('Yeniden dene', style: TextStyle(fontSize: 11.5)),
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFF9F1239),
                  side: const BorderSide(color: Color(0xFFFECDD3)),
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  visualDensity: VisualDensity.compact,
                ),
              ),
            ),
          ]),
        ),
      ]),
    );
  }

  String get _todayIso {
    final d = DateTime.now();
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }

  /// "3 Ağu 2026" — ekstre satırının dar tarih sütunu.
  static String _shortDay(DateTime d) =>
      '${d.day} ${CalendarText.months[d.month - 1].substring(0, 3)} ${d.year}';

  @override
  Widget build(BuildContext context) {
    final g = _group;
    final cells = buildMonthlySchedule(g, _todayIso);
    final paidPct = g.totalAmount > 0 ? ((g.paidAmount / g.totalAmount) * 100).round().clamp(0, 100) : 0;
    final initials = g.customerName
        .trim()
        .split(RegExp(r'\s+'))
        .where((w) => w.isNotEmpty)
        .take(2)
        .map((w) => w[0])
        .join()
        .toUpperCase();

    return Scaffold(
      backgroundColor: AppColors.surfaceSoft,
      appBar: AppBar(
        title: Text(g.customerName, maxLines: 1, overflow: TextOverflow.ellipsis),
        leading: IconButton(
          icon: const Icon(Icons.close_rounded),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
        children: [
          // ---------------- BAYAT VERİ UYARISI ----------------
          // Boş ekran değil, YANLIŞ ekran tehlikelidir: rakamlar duruyor ama artık doğru
          // olmayabilir. Uyarı görünürken tahsilat düğmeleri de kapalıdır.
          if (_blocked) _staleBanner(),
          // ---------------- KİMLİK + KPI ----------------
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Container(
                    width: 44,
                    height: 44,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(colors: [Color(0xFF3A1A2A), Color(0xFFC85776)]),
                      borderRadius: BorderRadius.circular(13),
                    ),
                    child: Text(initials.isEmpty ? '—' : initials,
                        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(g.customerName,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, height: 1.15)),
                      const SizedBox(height: 2),
                      Text(
                        [
                          '${g.saleCount} satış',
                          if (g.customerPhone.isNotEmpty) g.customerPhone,
                        ].join(' · '),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
                      ),
                    ]),
                  ),
                ]),
                const SizedBox(height: 10),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  if (g.hasOverdue)
                    _pill('Gecikmiş ${CalendarText.tl(g.overdueAmount)}', AppColors.danger),
                  if (g.hasInstallmentPlan) _pill('Taksitli', const Color(0xFF7C3AED)),
                  if (g.nextDueDate != null && g.remainingAmount > 0.005)
                    _pill('Sıradaki vade ${g.nextDueDate!.substring(0, 10)} · ${CalendarText.tl(g.nextDueAmount)}',
                        AppColors.primaryDark),
                ]),
                const SizedBox(height: 12),
                Row(children: [
                  // İPTAL EDİLENLER DE SAYILIR: "Tahsil Edilen" arşivi sayarken bu kart saymazsa
                  // iki kart birbirini yalanlar (web paritesi).
                  Expanded(
                      child: _kpi('Toplam Satış',
                          CalendarText.tl(g.totalAmount + _cancelledTotal), AppColors.ink,
                          sub: _cancelledCount > 0 ? '$_cancelledCount iptal dahil' : null)),
                  const SizedBox(width: 8),
                  Expanded(
                      child: _kpi('Tahsil Edilen',
                          CalendarText.tl(g.paidAmount + _cancelledRetained), AppColors.success,
                          sub: _cancelledRetained > 0.5
                              ? '${CalendarText.tl(_cancelledRetained)} iptalden'
                              : "satışın %$paidPct'i")),
                ]),
                const SizedBox(height: 8),
                Row(children: [
                  Expanded(child: _kpi('Kalan Borç', CalendarText.tl(g.remainingAmount),
                      g.remainingAmount > 0.005 ? AppColors.danger : AppColors.success)),
                  const SizedBox(width: 8),
                  Expanded(child: _kpi('Kalan Seans', '${g.sessionsRemaining}', AppColors.ink,
                      sub: g.sessionsTotal > 0 ? '${g.sessionsTotal} seanslık' : 'seanssız')),
                ]),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // ---------------- SEKMELER ----------------
          Row(children: [
            _tabBtn(0, Icons.calendar_month_rounded, 'Takvim'),
            const SizedBox(width: 6),
            _tabBtn(1, Icons.inventory_2_rounded, 'Satışlar (${g.saleCount})'),
            const SizedBox(width: 6),
            _tabBtn(2, Icons.receipt_long_rounded, 'Ekstre'),
          ]),
          const SizedBox(height: 12),

          if (_tab == 0) _scheduleTab(cells),
          if (_tab == 1) ..._salesTab(g),
          if (_tab == 2) _ledgerTab(g),
        ],
      ),
    );
  }

  Widget _scheduleTab(List<MonthCell> cells) => _section(
        'Aylık Taksit Takvimi',
        Icons.calendar_month_rounded,
        // KAPSAM UYARISI: peşinat ve peşin satış taksit satırı üretmez, bu yüzden takvim
        // toplamı üstteki "Tahsil Edilen" KPI'ından KÜÇÜK olabilir.
        'Yalnız TAKSİTLER — peşinat ve peşin satışlar bu takvimde yer almaz.',
        PaymentScheduleGrid(cells: cells, todayKey: _todayIso.substring(0, 7)),
      );

  List<Widget> _salesTab(CustomerAccountGroup g) => [
        for (final a in g.accounts) _saleRow(a),
        const SizedBox(height: 4),
        OutlinedButton.icon(
          onPressed: () async { await widget.onOpenSalesWorkspace(); await _refresh(); },
          icon: const Icon(Icons.inventory_2_outlined, size: 17),
          label: const Text('Satış yönetimi — geçmiş satış, iptal', style: TextStyle(fontSize: 12)),
        ),
      ];

  Widget _ledgerTab(CustomerAccountGroup g) {
    // Birleşik ekstre: tüm satışların tahsilatları tek listede (hangi satıştan geldiği yazılı).
    final rows = <Map<String, dynamic>>[];
    for (final a in g.accounts) {
      for (final p in (a['payments'] as List? ?? const [])) {
        if (p is! Map) continue;
        final m = p.cast<String, dynamic>();
        rows.add({
          'at': parseUtcToLocal(m['occurredAtUtc']),
          'sale': valueOf(a, const ['servicePackageName', 'name'], fallback: 'Satış'),
          'method': paymentMethodLabel('${m['method'] ?? ''}'),
          'amount': numberOf(m, const ['amount']),
          'refund': false,
        });
      }
    }
    // İPTAL EDİLEN SATIŞIN PARASI DA BURADA (web paritesi): iptalde tahsilat satırları canlı
    // tablodan silinip arşive taşınır, bu yüzden `accounts` üzerinden hiç görünmezdi — müşteri
    // ödeme yapmış ama ekstre boş çıkıyordu. Gerçek tarih/yöntem arşiv kopyalarından okunur.
    for (final c in widget.cancelledSales) {
      final name = valueOf(c, const ['name'], fallback: 'Satış');
      final pays = (c['payments'] as List? ?? const []).whereType<Map>().toList();
      if (pays.isNotEmpty) {
        for (final raw in pays) {
          final m = raw.cast<String, dynamic>();
          rows.add({
            'at': parseUtcToLocal(m['occurredAtUtc']),
            'sale': '$name · İPTAL',
            'method': paymentMethodLabel('${m['method'] ?? ''}'),
            'amount': numberOf(m, const ['amount']),
            'refund': false,
          });
        }
      } else if (numberOf(c, const ['collectedAmount']) > 0.005) {
        // Eski arşiv kaydı (tahsilat kopyası yok) — tek satırda özetlenir. YÖNTEM SÜTUNUNA
        // yöntem olmayan metin yazılmaz; kanal gerçekten bilinmiyor.
        rows.add({
          'at': parseUtcToLocal(c['cancelledAtUtc'] ?? c['soldAtUtc']),
          'sale': '$name · İPTAL',
          'method': paymentMethodLabel(''),
          'amount': numberOf(c, const ['collectedAmount']),
          'refund': false,
        });
      }

      // GERÇEK İADE SATIRLARI: paranın çıktığı KANAL gösterilir (web paritesi). Burası
      // "müşteriye geri ödendi" diye sentetik metin yazıyordu; kart iadesi ile nakit iade
      // ayırt edilemiyor, kasa kırılımı tutmuyordu.
      final refunds = (c['refunds'] as List? ?? const []).whereType<Map>().toList();
      if (refunds.isNotEmpty) {
        for (final raw in refunds) {
          final r = raw.cast<String, dynamic>();
          rows.add({
            'at': parseUtcToLocal(r['refundedAtUtc']),
            'sale': '$name · İADE',
            'method': paymentMethodLabel('${r['method'] ?? ''}'),
            'amount': numberOf(r, const ['amount']),
            'refund': true,
          });
        }
      } else if (numberOf(c, const ['refundedAmount']) > 0.005) {
        // Eski arşiv kaydı (iade satırı yok) — kanal BİLİNMİYOR; uydurma yapılmaz.
        rows.add({
          'at': parseUtcToLocal(c['cancelledAtUtc']),
          'sale': '$name · İADE',
          'method': paymentMethodLabel(''),
          'amount': numberOf(c, const ['refundedAmount']),
          'refund': true,
        });
      }
    }
    rows.sort((x, y) {
      final ax = (x['at'] as DateTime?)?.millisecondsSinceEpoch ?? 0;
      final ay = (y['at'] as DateTime?)?.millisecondsSinceEpoch ?? 0;
      return ay.compareTo(ax);
    });

    return _section(
      'Tahsilat Ekstresi',
      Icons.receipt_long_rounded,
      '${rows.length} hareket · net ${CalendarText.tl(_ledgerNet(rows))}',
      rows.isEmpty
          ? const Padding(
              padding: EdgeInsets.symmetric(vertical: 18),
              child: Text('Bu müşteriden henüz tahsilat alınmamış.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12, color: AppColors.muted)),
            )
          : Column(
              children: [
                for (final r in rows)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Row(children: [
                      SizedBox(
                        width: 74,
                        child: Text(
                          (r['at'] as DateTime?) == null
                              ? '—'
                              : _shortDay(r['at'] as DateTime),
                          style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
                        ),
                      ),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${r['sale']}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                          Text('${r['method']}',
                              style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
                        ]),
                      ),
                      Text(
                          '${r['refund'] == true ? '−' : '+'}${CalendarText.tl(r['amount'] as double)}',
                          style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w800,
                              color: r['refund'] == true ? AppColors.danger : AppColors.success)),
                    ]),
                  ),
                // TOPLAM SATIRI: tahsilat − iade = net (web paritesi, kullanıcı isteği).
                const Divider(height: 18),
                Row(children: [
                  const Expanded(
                    child: Text('TOPLAM',
                        style: TextStyle(
                            fontSize: 11, fontWeight: FontWeight.w900, letterSpacing: .5)),
                  ),
                  if (_ledgerRefunded(rows) > 0.005)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: Text(
                        'İade ${CalendarText.tl(_ledgerRefunded(rows))}',
                        style: const TextStyle(fontSize: 10.5, color: AppColors.danger),
                      ),
                    ),
                  Text(CalendarText.tl(_ledgerNet(rows)),
                      style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w800,
                          color: _ledgerNet(rows) >= 0 ? AppColors.success : AppColors.danger)),
                ]),
              ],
            ),
    );
  }

  /// İptal arşivi özetleri — KPI'lar canlı + arşiv toplamını gösterir.
  int get _cancelledCount => widget.cancelledSales.length;
  double get _cancelledTotal => widget.cancelledSales
      .fold<double>(0, (s, c) => s + numberOf(c, const ['totalAmount']));
  double get _cancelledRetained => widget.cancelledSales
      .fold<double>(0, (s, c) => s + numberOf(c, const ['retainedAmount']));

  /// Ekstre toplamları SATIRLARIN KENDİSİNDEN türetilir: özet ile satırlar farklı kaynaktan
  /// gelince "2 tahsilat · toplam 0" gibi çelişkiler çıkıyordu.
  static double _ledgerNet(List<Map<String, dynamic>> rows) => rows.fold<double>(
      0,
      (s, r) => s + ((r['refund'] == true ? -1 : 1) * (r['amount'] as double)));

  static double _ledgerRefunded(List<Map<String, dynamic>> rows) => rows
      .where((r) => r['refund'] == true)
      .fold<double>(0, (s, r) => s + (r['amount'] as double));

  /// Tek satış satırı — kendi cari kartı; tahsilat buradan alınır (para doğru satışa yazılsın).
  Widget _saleRow(Map<String, dynamic> a) {
    final insts = parseInstallments(a).where((i) => !i.cancelled).toList();
    final isInstallment = insts.length > 1;
    final remaining = numberOf(a, const ['remainingAmount']);
    final total = numberOf(a, const ['totalAmount']);
    final paid = numberOf(a, const ['paidAmount']);
    final isOpen = remaining > 0.005;
    final overdue = insts.any((i) => i.overdue);
    final pct = total > 0 ? (paid / total).clamp(0.0, 1.0) : 0.0;
    final paidCount = insts.where((i) => i.isPaid).length;
    final sessionsTotal = numberOf(a, const ['sessionsTotal']).toInt();

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: overdue
              ? AppColors.danger.withValues(alpha: .35)
              : isOpen
                  ? AppColors.border
                  : AppColors.success.withValues(alpha: .35),
        ),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(
            child: InkWell(
              onTap: () => widget.onOpenSale(a),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(valueOf(a, const ['servicePackageName', 'name'], fallback: 'Satış'),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
                const SizedBox(height: 3),
                Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                  _tag(isInstallment ? 'TAKSİTLİ · ${insts.length} AY' : 'PEŞİN',
                      isInstallment ? const Color(0xFF7C3AED) : const Color(0xFF0369A1)),
                  if (overdue) _tag('GECİKMİŞ', AppColors.danger),
                  if (sessionsTotal > 0)
                    Text('${numberOf(a, const ['sessionsRemaining']).toInt()} seans kaldı',
                        style: const TextStyle(fontSize: 11, color: AppColors.muted)),
                ]),
              ]),
            ),
          ),
          const SizedBox(width: 8),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text(CalendarText.tl(remaining),
                style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: isOpen ? AppColors.primaryDark : AppColors.success)),
            Text(isOpen ? 'kalan borç' : 'kapandı',
                style: const TextStyle(fontSize: 9.5, color: AppColors.muted)),
          ]),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: pct,
                minHeight: 5,
                backgroundColor: AppColors.surfaceSoft,
                valueColor: AlwaysStoppedAnimation(isOpen ? AppColors.primary : AppColors.success),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Text(isInstallment ? '$paidCount/${insts.length} taksit' : '%${(pct * 100).round()} ödendi',
              style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
        ]),
        if (isOpen) ...[
          const SizedBox(height: 9),
          Row(children: [
            // BAYAT EKRANDA PARA DÜĞMESİ YOK: `onPressed: null` düğmeyi hem işlevsiz hem
            // GÖRSEL OLARAK pasif yapar (kullanıcı neden çalışmadığını yukarıdaki şeritten
            // okur). Yalnız gizlemek yetmezdi — kullanıcı düğmeyi arar, bulamayınca listeye
            // döner ve orada da eski veriyi görürdü.
            // TEK BUTON: tahsilat sayfası taksitli satışta planı, devri ve "bu ay
            // ödenmesi gereken" tutarı kendisi getirir (aylık/genel ayrımı kaldırıldı).
            Expanded(
              child: FilledButton.icon(
                onPressed: _blocked
                    ? null
                    : () async { await widget.onCollect(a); await _refresh(); },
                style: FilledButton.styleFrom(visualDensity: VisualDensity.compact),
                icon: const Icon(Icons.payments_rounded, size: 15),
                label: const Text('Tahsilat al', style: TextStyle(fontSize: 11.5)),
              ),
            ),
          ]),
        ],
      ]),
    );
  }

  // ------------------------------------------------------------------ parçalar

  Widget _tabBtn(int idx, IconData icon, String label) {
    final on = _tab == idx;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _tab = idx),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 9),
          decoration: BoxDecoration(
            color: on ? AppColors.primary : Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: on ? AppColors.primary : AppColors.border),
          ),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, size: 16, color: on ? Colors.white : AppColors.muted),
            const SizedBox(height: 2),
            Text(label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    color: on ? Colors.white : AppColors.muted)),
          ]),
        ),
      ),
    );
  }

  Widget _section(String title, IconData icon, String hint, Widget child) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(icon, size: 15, color: AppColors.primary),
            const SizedBox(width: 6),
            Text(title.toUpperCase(),
                style: const TextStyle(
                    fontSize: 10.5, fontWeight: FontWeight.w900, letterSpacing: .6, color: AppColors.primary)),
          ]),
          const SizedBox(height: 3),
          Text(hint, style: const TextStyle(fontSize: 11, color: AppColors.muted)),
          const SizedBox(height: 12),
          child,
        ]),
      );

  Widget _kpi(String label, String value, Color tone, {String? sub}) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: AppColors.surfaceSoft,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label.toUpperCase(),
              style: const TextStyle(
                  fontSize: 9, fontWeight: FontWeight.w800, letterSpacing: .4, color: AppColors.muted)),
          const SizedBox(height: 2),
          Text(value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: tone)),
          if (sub != null)
            Text(sub, style: const TextStyle(fontSize: 9.5, color: AppColors.muted)),
        ]),
      );

  Widget _pill(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: .10),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: color.withValues(alpha: .3)),
        ),
        child: Text(text,
            style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: color)),
      );

  Widget _tag(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: color.withValues(alpha: .10),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(text,
            style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: color)),
      );
}
