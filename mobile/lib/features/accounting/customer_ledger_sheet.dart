import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../appointments/calendar_theme.dart';
import 'account_grouping.dart';
import 'account_installments.dart';
import 'account_statement.dart';
import 'payment_schedule_grid.dart';
import 'statement_pdf.dart';

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
  /// Ekstre belgesinin antetindeki kurum bilgisi bu istemciden okunur.
  required ApiClient api,
  /// Bu müşterinin İPTAL arşivi — iptal edilen satışın tahsilat/iadesi canlı listede YOKTUR.
  List<Map<String, dynamic>> cancelledSales = const [],
  /// Cariye henüz işlenmemiş açık fişler — ekstrede bilgi şeridi olarak görünür.
  List<Map<String, dynamic>> pendingSales = const [],
  required Future<void> Function(Map<String, dynamic> account) onCollect,
  /// "Tümünden tahsilat al" — sayfa TÜMÜ seçili açılır, para satışlara vade sırasıyla bölünür.
  required Future<void> Function() onCollectAll,
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
      api: api,
      cancelledSales: cancelledSales,
      pendingSales: pendingSales,
      onCollect: onCollect,
      onCollectAll: onCollectAll,
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
    required this.api,
    this.cancelledSales = const [],
    this.pendingSales = const [],
    required this.onCollect,
    required this.onCollectAll,
    required this.onOpenSale,
    required this.onOpenSalesWorkspace,
    this.onRefresh,
    super.key,
  });

  final CustomerAccountGroup group;

  /// Ekstre belgesinin antetindeki kurum bilgisi (ad/telefon/e-posta) buradan okunur.
  final ApiClient api;

  /// İptal arşivi: satırları canlı tablodan silinir, parası yalnız buradan okunur.
  final List<Map<String, dynamic>> cancelledSales;

  /// CARİYE HENÜZ İŞLENMEMİŞ SATIŞLAR (açık fişler) — `{'id','amount','openedAtUtc'}`.
  ///
  /// Peşinatsız hizmet/paket satışı cari kartı AÇMAZ: fiş açık kalır, müşteri ilk randevusunu
  /// tamamlayınca otomatik işlenir. Belgeye SATIR olarak girmez (ortada henüz borç kaydı yok,
  /// yürüyen bakiye bozulurdu); ekstrenin üstünde bilgi şeridi olarak görünür.
  final List<Map<String, dynamic>> pendingSales;
  final Future<void> Function(Map<String, dynamic> account) onCollect;
  final Future<void> Function() onCollectAll;
  final Future<void> Function(Map<String, dynamic> account) onOpenSale;
  final Future<void> Function() onOpenSalesWorkspace;

  /// Tahsilat sonrası defteri tazeler (bkz. `_refresh`).
  final Future<LedgerRefresh> Function()? onRefresh;

  @override
  State<CustomerLedgerScreen> createState() => _CustomerLedgerScreenState();
}

class _CustomerLedgerScreenState extends State<CustomerLedgerScreen> {
  int _tab = 0;

  /// TAKVİM KAPSAMI — `null` = Tümü (bütün satışların taksitleri tek listede birleşir).
  String? _scheduleAccountId;

  /// Ekranda GÖSTERİLEN grup. Tahsilat sonrası tazelenir; başlangıçta çağıranın verdiği anlık
  /// görüntüdür.
  late CustomerAccountGroup _group = widget.group;

  // --- EKSTRE BELGESİ ---
  /// Belgenin dönem süzgeci (`YYYY-MM-DD`); null = tüm hareketler.
  String? _stmtFrom;
  String? _stmtTo;
  bool _sharingStatement = false;

  /// Belge anteti — kurum adı/iletişimi (KVKK ve onam PDF'leriyle AYNI kaynak).
  String _institution = '';
  String? _institutionPhone;
  String? _institutionEmail;

  @override
  void initState() {
    super.initState();
    _loadInstitution();
  }

  /// Kurum bilgisi belgenin ANTETİDİR; hata YUTULUR — ekstre kurum adı olmadan da açılmalı
  /// (personel rolünde bu uç 403 dönebilir), yalnız başlık "Kurum" kalır.
  Future<void> _loadInstitution() async {
    try {
      final res = await widget.api.get('/api/admin/tenant/');
      if (!mounted || res is! Map) return;
      final map = res.cast<String, dynamic>();
      final name = '${map['name'] ?? map['tenantName'] ?? ''}'.trim();
      setState(() {
        if (name.isNotEmpty) _institution = name;
        final phone = '${map['phone'] ?? ''}'.trim();
        final email = '${map['email'] ?? ''}'.trim();
        _institutionPhone = phone.isEmpty ? null : phone;
        _institutionEmail = email.isEmpty ? null : email;
      });
    } catch (_) {
      // yut: belge yine açılır
    }
  }

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

  @override
  Widget build(BuildContext context) {
    final g = _group;
    // Taksit planı OLAN satışlar — seçicide yalnız bunlar listelenir (peşin satışın vadesi yok).
    final planAccounts = g.accounts
        .where((a) => parseInstallments(a, _todayIso).any((i) => !i.cancelled))
        .toList();
    // Seçili satış listeden düşerse (iptal/tahsilat sonrası tazeleme) Tümü'ye dön: yoksa
    // takvim sessizce boş görünür ve kullanıcı "plan kayboldu" sanır.
    if (_scheduleAccountId != null &&
        !planAccounts.any((a) => '${a['id'] ?? ''}' == _scheduleAccountId)) {
      _scheduleAccountId = null;
    }
    final scheduleRows = buildDueDateSchedule(g, _todayIso, _scheduleAccountId);
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
                      gradient: const LinearGradient(colors: [Color(0xFF3A1A2A), Color(0xFFA5556E)]),
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

          if (_tab == 0) _scheduleTab(scheduleRows, planAccounts),
          if (_tab == 1) ..._salesTab(g),
          if (_tab == 2) _ledgerTab(g),
        ],
      ),
    );
  }

  Widget _scheduleTab(List<DueDateRow> rows, List<Map<String, dynamic>> planAccounts) => _section(
        'Taksit Takvimi',
        Icons.calendar_month_rounded,
        // KAPSAM UYARISI: peşinat ve peşin satış taksit satırı üretmez, bu yüzden takvim
        // toplamı üstteki "Tahsil Edilen" KPI'ından KÜÇÜK olabilir.
        'Yalnız TAKSİTLER — peşinat ve peşin satışlar bu takvimde yer almaz. '
            'Satır = vade günü; aynı güne düşen taksitler toplanır.',
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // İŞLEM SEÇİCİ — tahsilat sayfasındaki satış seçicisinin karşılığı. Tek taksitli
            // satışı olan müşteride gösterilmez: "Tümü" birebir aynı listeyi verir.
            if (planAccounts.length > 1) ...[
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  _scopeChip('Tümü', null, count: planAccounts.length),
                  for (final a in planAccounts)
                    _scopeChip(saleDisplayName(a), '${a['id'] ?? ''}'),
                ],
              ),
              const SizedBox(height: 10),
            ],
            PaymentScheduleGrid(
              rows: rows,
              todayIso: _todayIso,
              // Kaynak dökümü yalnız Tümü'de anlamlı: tek satış seçiliyken kaynak zaten belli.
              showSources: _scheduleAccountId == null,
            ),
          ],
        ),
      );

  /// Takvim kapsam seçeneği ("Tümü" ya da tek satış). Seçili olan dolu, diğerleri çerçeveli.
  Widget _scopeChip(String label, String? accountId, {int? count}) {
    final active = _scheduleAccountId == accountId;
    return InkWell(
      onTap: () => setState(() => _scheduleAccountId = accountId),
      borderRadius: BorderRadius.circular(20),
      child: Container(
        constraints: const BoxConstraints(maxWidth: 240),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: active ? AppColors.primaryDark : Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: active ? AppColors.primaryDark : AppColors.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                  color: active ? Colors.white : AppColors.ink,
                ),
              ),
            ),
            if (count != null) ...[
              const SizedBox(width: 5),
              Text('$count',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    color: active ? Colors.white70 : AppColors.muted,
                  )),
            ],
          ],
        ),
      ),
    );
  }

  List<Widget> _salesTab(CustomerAccountGroup g) => [
        // TOPLAM — satış satırlarının üstünde, müşterinin bütün satışlarının özeti. Buradan
        // alınan tahsilat TEK satışa değil tümüne vade sırasıyla bölünür. Tek satışlı
        // müşteride gösterilmez: toplam ile tek satır birebir aynı rakamları yazardı.
        if (g.accounts.where((a) => numberOf(a, const ['remainingAmount']) > 0.005).length > 1)
          _totalCard(g),
        for (final a in g.accounts) _saleRow(a),
        const SizedBox(height: 4),
        OutlinedButton.icon(
          onPressed: () async { await widget.onOpenSalesWorkspace(); await _refresh(); },
          icon: const Icon(Icons.inventory_2_outlined, size: 17),
          label: const Text('Satış yönetimi — geçmiş satış, iptal', style: TextStyle(fontSize: 12)),
        ),
      ];

  /// Müşterinin BÜTÜN satışlarının özeti + "Tümünden tahsilat al".
  Widget _totalCard(CustomerAccountGroup g) => Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.surfaceSoft,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.primaryDark.withValues(alpha: .35)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.layers_rounded, size: 16, color: AppColors.primaryDark),
                const SizedBox(width: 6),
                Expanded(
                  child: Text('Toplam · ${g.saleCount} satış',
                      style: const TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w800,
                          color: AppColors.primaryDark)),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(CalendarText.tl(g.remainingAmount),
                        style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w900,
                            color: AppColors.danger)),
                    const Text('toplam kalan',
                        style: TextStyle(fontSize: 9.5, color: AppColors.muted)),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 10,
              runSpacing: 4,
              children: [
                Text('Satış ${CalendarText.tl(g.totalAmount)}',
                    style: const TextStyle(fontSize: 11.5)),
                Text('Tahsil ${CalendarText.tl(g.paidAmount)}',
                    style: const TextStyle(fontSize: 11.5, color: AppColors.success)),
                if (g.hasOverdue)
                  Text('${CalendarText.tl(g.overdueAmount)} gecikmiş',
                      style: const TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w800,
                          color: AppColors.danger)),
              ],
            ),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _blocked
                    ? null
                    : () async { await widget.onCollectAll(); await _refresh(); },
                style: FilledButton.styleFrom(visualDensity: VisualDensity.compact),
                icon: const Icon(Icons.payments_rounded, size: 16),
                label: const Text('Tümünden tahsilat al', style: TextStyle(fontSize: 12)),
              ),
            ),
          ],
        ),
      );

  /// CARİ HESAP EKSTRESİ — çift taraflı, paylaşılabilir belge (web `AccountStatementSheet`
  /// paritesi). Tahsilat listesi değil: satışın doğurduğu borç (peşinat, taksitler), müşterinin
  /// ödediği alacak ve her satırdan sonraki yürüyen bakiye.
  ///
  /// DAR EKRAN: altı sütunlu tablo telefona sığmaz, bu yüzden her hareket bir KART satırıdır
  /// (tarih + tür + açıklama üstte, borç/alacak/bakiye altta). PDF çıktısı yine tam tablodur.
  Widget _ledgerTab(CustomerAccountGroup g) {
    final doc = buildAccountStatement(
      group: g,
      cancelledSales: widget.cancelledSales,
      todayIso: _todayIso,
      from: _stmtFrom,
      to: _stmtTo,
    );
    final filtered = _stmtFrom != null || _stmtTo != null;
    final periodLabel = filtered
        ? '${formatDocDate(_stmtFrom ?? doc.firstDate)} - ${formatDocDate(_stmtTo ?? doc.lastDate)}'
        : (doc.firstDate == null
            ? '—'
            : '${formatDocDate(doc.firstDate)} - ${formatDocDate(doc.lastDate)}');
    final closingDebt = doc.closing >= 0;

    return Column(children: [
      // ---------------- ARAÇ ÇUBUĞU ----------------
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(children: [
          Row(children: [
            const Icon(Icons.date_range_rounded, size: 15, color: AppColors.primary),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                filtered ? periodLabel : 'Tüm hareketler',
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
              ),
            ),
            // Row içindeki düğmelerde AppButtons.inline ZORUNLU: tema minimumSize'ı sonsuz
            // genişlik verir ve etiket harf harf alt alta düşer.
            OutlinedButton.icon(
              onPressed: () => _pickStatementRange(doc),
              icon: const Icon(Icons.tune_rounded, size: 15),
              label: const Text('Dönem', style: TextStyle(fontSize: 11.5)),
              style: AppButtons.inline(height: 32),
            ),
            if (filtered) ...[
              const SizedBox(width: 6),
              OutlinedButton.icon(
                onPressed: () => setState(() {
                  _stmtFrom = null;
                  _stmtTo = null;
                }),
                icon: const Icon(Icons.restart_alt_rounded, size: 15),
                label: const Text('Tümü', style: TextStyle(fontSize: 11.5)),
                style: AppButtons.inline(height: 32),
              ),
            ],
          ]),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            height: 36,
            child: FilledButton.icon(
              onPressed: _sharingStatement ? null : () => _shareStatement(doc, periodLabel),
              icon: _sharingStatement
                  ? const SizedBox(
                      width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.picture_as_pdf_rounded, size: 16),
              label: Text(_sharingStatement ? 'Hazırlanıyor…' : 'PDF olarak paylaş',
                  style: const TextStyle(fontSize: 12)),
            ),
          ),
        ]),
      ),
      const SizedBox(height: 10),

      // BEKLEYEN SATIŞ: peşinatsız satış cari kartı açmaz, ilk randevu tamamlanınca işlenir.
      // Belgeye satır olarak GİRMEZ (ortada henüz borç kaydı yok, yürüyen bakiye bozulurdu);
      // ama "sattım, neden ekstrede yok" sorusu burada yanıtlanır.
      if (widget.pendingSales.isNotEmpty)
        Container(
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: const Color(0xFFF2F7FD),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFBCD6F2)),
          ),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.schedule_rounded, size: 16, color: Color(0xFF1E4E8C)),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                '${widget.pendingSales.length} satış cariye henüz işlenmedi (toplam '
                '${formatStatementAmount(widget.pendingSales.fold<double>(0, (s, p) => s + numberOf(p, const ['amount'])))} TL). '
                'Peşinat alınmadığı için fiş açık: müşteri ilk randevusunu tamamlayınca peşinat '
                've taksitler bu ekstreye otomatik düşer.',
                style: const TextStyle(fontSize: 11, color: Color(0xFF1E4E8C), height: 1.35),
              ),
            ),
          ]),
        ),

      // KREDİ BAKİYESİ UYARISI: belge NET bakiye yazar (yürüyen sütun toplanabilir olmalı),
      // üstteki "Kalan Borç" KPI'ı ise cari BAŞINA sıfırlanır.
      if (doc.clampDifference.abs() > 0.5)
        Container(
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: const Color(0xFFFFF8EC),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFF6D9A8)),
          ),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.info_outline_rounded, size: 16, color: Color(0xFF7A4A12)),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'Bir satışta fazla ödeme var: ekstre net bakiyeyi '
                '(${formatStatementAmount(doc.closing)} TL) yazar, "Kalan Borç" kartı her satışı '
                'ayrı sayar (fark ${formatStatementAmount(doc.clampDifference.abs())} TL).',
                style: const TextStyle(fontSize: 11, color: Color(0xFF7A4A12), height: 1.35),
              ),
            ),
          ]),
        ),

      // ---------------- BELGE ----------------
      Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFFE7DCE2)),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          // Kurum başlığı
          Text(_institution.isEmpty ? 'Kurum' : _institution,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Color(0xFF241C21))),
          const SizedBox(height: 6),
          Container(height: 1.6, color: AppColors.primary),
          const SizedBox(height: 14),
          const Center(
            child: Text('CARİ HESAP EKSTRESİ',
                style: TextStyle(
                    fontSize: 15, fontWeight: FontWeight.w900, letterSpacing: .6, color: Color(0xFF241C21))),
          ),
          const SizedBox(height: 14),

          // Cari bilgileri
          _stmtInfo('Cari Kodu', cariCode(g.customerId)),
          _stmtInfo('Adı Soyadı', g.customerName),
          _stmtInfo('Telefon', g.customerPhone.isEmpty ? '—' : g.customerPhone),
          _stmtInfo('Tarih Aralığı', periodLabel),
          _stmtInfo('Düzenleme Tarihi', formatDocDateTime(DateTime.now())),
          _stmtInfo('Para Birimi', 'TL'),
          const SizedBox(height: 12),

          // Sütun başlıkları (kart satırların anlamı)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            decoration: const BoxDecoration(
              color: Color(0xFFF4EFF1),
              border: Border(bottom: BorderSide(color: AppColors.primary, width: 1.4)),
            ),
            child: const Row(children: [
              Expanded(
                child: Text('Tarih · İşlem Türü',
                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, letterSpacing: .3)),
              ),
              Text('Borç / Alacak · Bakiye',
                  style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, letterSpacing: .3)),
            ]),
          ),

          if (doc.rows.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 22),
              child: Text(
                filtered
                    ? 'Seçilen dönemde hareket bulunmuyor.'
                    : widget.pendingSales.isNotEmpty
                        ? 'Cariye işlenmiş hareket yok — yukarıdaki bekleyen satış onaylanınca '
                            'peşinat ve taksitler buraya düşer.'
                        : 'Bu müşteride henüz cari hareket yok. Satış yapıldığında peşinat ve '
                            'taksitler buraya düşer.',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 12, color: AppColors.muted, height: 1.4),
              ),
            ),
          for (var i = 0; i < doc.rows.length; i++) _stmtRow(doc.rows[i], i.isOdd),

          if (doc.rows.isNotEmpty) ...[
            const Divider(height: 18),
            Row(children: [
              const Expanded(
                child: Text('Toplam',
                    style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w900)),
              ),
              Text(
                'Borç ${formatStatementAmount(doc.totalDebit)} · '
                'Alacak ${formatStatementAmount(doc.totalCredit)}',
                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.muted),
              ),
            ]),
            const SizedBox(height: 6),
            Row(children: [
              const Expanded(
                child: Text('Bakiye', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w900)),
              ),
              Text('${formatStatementAmount(doc.closing.abs())} TL',
                  style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                      color: closingDebt ? AppColors.danger : AppColors.success)),
            ]),
            const SizedBox(height: 10),
            RichText(
              text: TextSpan(children: [
                const TextSpan(
                    text: 'Yalnız ', style: TextStyle(fontSize: 11.5, color: AppColors.muted)),
                TextSpan(
                  text: turkishAmountInWords(doc.closing.abs()),
                  style: const TextStyle(
                      fontSize: 12, fontWeight: FontWeight.w800, color: Color(0xFF241C21)),
                ),
                if (!closingDebt)
                  const TextSpan(
                      text: ' (müşteri alacaklı)',
                      style: TextStyle(fontSize: 11.5, color: AppColors.muted)),
              ]),
            ),
          ],
          const SizedBox(height: 8),
          const Text('Not: Bu belge bilgilendirme amaçlıdır.',
              style: TextStyle(fontSize: 10.5, color: AppColors.muted)),
        ]),
      ),
    ]);
  }

  /// Belge bilgi satırı — "Etiket : Değer".
  Widget _stmtInfo(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(
            width: 104,
            child: Text(label, style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
          ),
          const Text(': ', style: TextStyle(fontSize: 11.5, color: AppColors.muted)),
          Expanded(
            child: Text(value,
                style: const TextStyle(
                    fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF241C21))),
          ),
        ]),
      );

  /// Tek hareket satırı — dar ekranda iki katlı kart (tablo yerine).
  Widget _stmtRow(StatementRow row, bool zebra) {
    final money = row.debit > 0.005
        ? '+${formatStatementAmount(row.debit)}'
        : '−${formatStatementAmount(row.credit)}';
    final moneyColor = row.debit > 0.005 ? AppColors.danger : AppColors.success;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
      decoration: BoxDecoration(
        color: zebra ? const Color(0xFFFBF8F9) : null,
        border: const Border(bottom: BorderSide(color: Color(0xFFEFE7EB), width: .6)),
      ),
      // İŞLEM TÜRÜ ile AÇIKLAMA tek metinde birleşti (`row.label`). Dar ekranda tutar üst
      // satırda tek başına durur; birleşik etiket alta iki satır yer bulur — yan yana
      // sıkıştırılsaydı "Tahsilat (Nakit · 9-D · Belge: …)" hemen kırpılırdı.
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text(formatDocDate(row.date),
              style: const TextStyle(fontSize: 11, color: Color(0xFF4a3a44))),
          const Spacer(),
          Text(money,
              style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: moneyColor)),
        ]),
        const SizedBox(height: 2),
        Row(children: [
          Expanded(
            child: Text(row.label,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: _stmtTypeTone(row.kind),
                    height: 1.3)),
          ),
          const SizedBox(width: 8),
          Text('Bakiye ${formatStatementAmount(row.balance)}',
              style: const TextStyle(
                  fontSize: 10.5, fontWeight: FontWeight.w700, color: Color(0xFF241C21))),
        ]),
      ]),
    );
  }

  /// İşlem türüne göre renk: para girişi yeşil, çıkış/iptal kırmızı, borç satırları nötr.
  static Color _stmtTypeTone(StatementKind kind) {
    switch (kind) {
      case StatementKind.collection:
        return AppColors.success;
      case StatementKind.refund:
      case StatementKind.cancelled:
        return AppColors.danger;
      case StatementKind.opening:
        return const Color(0xFF1E4E8C);
      default:
        return const Color(0xFF4a3a44);
    }
  }

  /// Dönem seçimi — belgenin tarih aralığı (web'deki iki tarih alanının karşılığı).
  Future<void> _pickStatementRange(AccountStatement doc) async {
    final first = DateTime.tryParse(doc.firstDate ?? '') ?? DateTime(DateTime.now().year - 3);
    final last = DateTime.tryParse(doc.lastDate ?? '') ?? DateTime(DateTime.now().year + 3);
    final range = await showDateRangePicker(
      context: context,
      firstDate: DateTime(first.year - 1),
      lastDate: DateTime(last.year + 1),
      initialDateRange: _stmtFrom != null && _stmtTo != null
          ? DateTimeRange(start: DateTime.parse(_stmtFrom!), end: DateTime.parse(_stmtTo!))
          : null,
      helpText: 'Ekstre dönemi',
      saveText: 'Uygula',
    );
    if (range == null || !mounted) return;
    String iso(DateTime d) =>
        '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    setState(() {
      _stmtFrom = iso(range.start);
      _stmtTo = iso(range.end);
    });
  }

  /// Belgeyi PDF olarak paylaşır — ekrandaki rakamların AYNISI (tek hesaplayıcı).
  Future<void> _shareStatement(AccountStatement doc, String periodLabel) async {
    setState(() => _sharingStatement = true);
    try {
      await StatementPdf.share(
        doc: doc,
        institutionName: _institution.isEmpty ? 'Kurum' : _institution,
        institutionPhone: _institutionPhone,
        institutionEmail: _institutionEmail,
        customerCode: cariCode(_group.customerId),
        customerName: _group.customerName,
        customerPhone: _group.customerPhone,
        saleCount: _group.saleCount,
        periodLabel: periodLabel,
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Ekstre PDF oluşturulamadı: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _sharingStatement = false);
    }
  }

  /// İptal arşivi özetleri — KPI'lar canlı + arşiv toplamını gösterir.
  int get _cancelledCount => widget.cancelledSales.length;
  double get _cancelledTotal => widget.cancelledSales
      .fold<double>(0, (s, c) => s + numberOf(c, const ['totalAmount']));
  double get _cancelledRetained => widget.cancelledSales
      .fold<double>(0, (s, c) => s + numberOf(c, const ['retainedAmount']));

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
