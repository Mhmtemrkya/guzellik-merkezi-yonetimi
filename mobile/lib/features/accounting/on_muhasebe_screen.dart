import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/theme/responsive.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../consent/consent_warning_banner.dart';
import '../../shared/crud/crud_options.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/guide/guide_content.dart';
import '../../shared/guide/page_guide.dart';
import '../../shared/json_helpers.dart';
import '../../shared/payment_method.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import '../../shared/widgets/period_selector.dart';
import '../appointments/calendar_theme.dart';
// Cari satırından açılan satış sheet'i — müşteri kartındakiyle AYNI bileşen.
import '../customers/customer_sales_panel.dart';
import 'account_grouping.dart';
import 'account_installments.dart';
import 'customer_ledger_sheet.dart';
import 'adisyon_detail_sheet.dart';
import 'collection_sheet.dart';
import 'expense_form_sheet.dart';
import 'adisyon_receipt_sheet.dart';
import 'daily_adisyon_sheet.dart';
import 'salary_payment_sheet.dart';

const _expenseCategories = [
  CrudOption('Salary', 'Maaş'),
  CrudOption('Tax', 'Vergi'),
  CrudOption('Rent', 'Kira'),
  CrudOption('Utilities', 'Faturalar'),
  CrudOption('Supplies', 'Sarf Malzeme'),
  CrudOption('Inventory', 'Stok/Ürün'),
  CrudOption('Marketing', 'Pazarlama'),
  CrudOption('Maintenance', 'Bakım'),
  CrudOption('Professional', 'Danışmanlık'),
  CrudOption('Equipment', 'Ekipman'),
  CrudOption('Office', 'Ofis'),
  CrudOption('Other', 'Diğer'),
];
enum _Tab { overview, adisyon, accounts, expenses, salary }

/// Ön Muhasebe — web sayfasının özellik karşılığı:
/// Genel Bakış · Adisyon · Cari Hesaplar · Giderler · Personel Maaşları,
/// ay navigasyonu ve tüm tahsilat/gider/adisyon aksiyonlarıyla.
class OnMuhasebeScreen extends StatefulWidget {
  const OnMuhasebeScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<OnMuhasebeScreen> createState() => _OnMuhasebeScreenState();
}

class _OnMuhasebeScreenState extends State<OnMuhasebeScreen> {
  _Tab _tab = _Tab.overview;
  PeriodValue _period = PeriodValue(kind: PeriodKind.month, anchor: DateTime.now());
  String _adisyonFilter = 'all'; // all/Open/Approved/Cancelled
  /// Adisyon arama kutusu (müşteri veya kalem adı) — web ön muhasebe paritesi.
  String _adisyonQuery = '';
  /// "Nasıl işler?" — üç adımlık akış anlatımı kalıcı şerit değil, istendiğinde açılır.
  bool _adisyonFlowOpen = false;
  String _accountFilter = 'all'; // all/overdue/upcoming/installment/closed
  String _accountQuery = '';
  late Future<_AccData> _future;
  _AccData? _last;

  DateTime get _rangeStart => _period.localRange().start;
  DateTime get _rangeEnd => _period.localRange().end;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_AccData> _load() async {
    final results = await Future.wait([
      // CANLI CARİLER + İPTAL ARŞİVİ TEK İSTEKTE, TEK ANLIK GÖRÜNTÜDEN.
      //
      // İkisi AYRI çekiliyordu; tablo müşteri bazında gruplanıp para topladığı için araya giren
      // bir iptal aynı satışı hem canlıda hem arşivde gösterip ÇİFT saydırabiliyor, ters sırada
      // ise hiçbirinde göstermeyip 0'a düşürüyordu. Sunucu ikisini tek transaction'da okur.
      //
      // Sayfalama da SUNUCUDA: uç listenin TAMAMINI döndürür ya da açıkça reddeder — bu yüzden
      // `getAllPaged` gerekmez (o, her sayfayı ayrı ana düşürüp yarışı geri getirirdi).
      // HATA YUTULMAZ: boş sonuç "cari yok" demektir, oysa gerçek "veri alınamadı"dır. Gruplama
      // eksik veriyle YANLIŞ TOPLAM üretir — ekran hata göstersin ki kullanıcı rakama güvenmesin.
      widget.api.get('/api/admin/accounts/with-archive'),
      widget.api.get('/api/admin/expenses/', query: {
        'fromUtc': _rangeStart.toUtc().toIso8601String(),
        'toUtc': _rangeEnd.toUtc().toIso8601String(),
        'page': 1,
        'pageSize': 300,
      }).catchError((_) => const <dynamic>[]),
      widget.api
          .get('/api/admin/adisyonlar/', query: {'page': 1, 'pageSize': 200})
          .catchError((_) => const <dynamic>[]),
      widget.api
          .get('/api/admin/staff/', query: {'page': 1, 'pageSize': 100})
          .catchError((_) => const <dynamic>[]),
    ]);
    // Canlı cariler ve iptal arşivi AYNI yanıttan çözülür: artık "arşiv ayrı çöktü" durumu YOK —
    // ya ikisi de gelir ya hiçbiri (istek patlarsa _load fırlar, ekran hata gösterir).
    final sales = results[0] is Map
        ? (results[0] as Map).cast<String, dynamic>()
        : const <String, dynamic>{};
    final data = _AccData(
      accounts: apiItems(sales['live']),
      expenses: apiItems(results[1]),
      adisyonlar: apiItems(results[2]),
      staff: apiItems(results[3]),
      cancelled: apiItems(sales['cancelled']),
    );
    // Son yüklenen veri FAB'lardan da erişilebilir olsun (maaş sayfası personel listesi ister).
    _last = data;
    return data;
  }

  void _reload() => setState(() { _future = _load(); });

  bool _inMonth(dynamic iso) {
    final d = DateTime.tryParse('$iso')?.toLocal();
    if (d == null) return false;
    return !d.isBefore(_rangeStart) && d.isBefore(_rangeEnd);
  }

  /// Sayfa kılavuzu düğmesi (web Topbar'daki kitap simgesi).
  Widget _guideButton(String key) => IconButton(
        tooltip: 'Sayfa kılavuzu',
        color: AppColors.primaryDark,
        onPressed: () {
          final guide = GuideContent.forKey(key);
          if (guide == null) return;
          showPageGuide(context,
              pageKey: key,
              uid: widget.api.auth?.user?.email ?? 'anon',
              content: guide);
        },
        icon: const Icon(Icons.menu_book_rounded),
      );

  /// Onaylanmış gideri geçersiz kılmak için ZORUNLU gerekçeyi sorar.
  Future<String?> _askExpenseVoidReason() {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Gideri geçersiz kıl'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
                'Onaylanmış gider silinemez. Kayıt iz olarak kalır, toplamlardan düşer.'),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Gerekçe (zorunlu)',
                hintText: 'ör. yanlış girildi, para çıkmadı',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Vazgeç')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text),
            child: const Text('Geçersiz kıl'),
          ),
        ],
      ),
    );
  }

  Future<void> _guard(Future<void> Function() task, String ok) async {
    try {
      await task();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(ok)));
      }
      _reload();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$e')));
      }
      // HATADA DA TAZELE. Başarısız bir istek "hiçbir şey olmadı" demek DEĞİLDİR: sunucu işi
      // yapmış ama yanıt yolda kopmuş olabilir. Eskiden yalnız başarıda yenileniyordu; hata
      // sonrası ekran bayat kalıyor ve kullanıcı aynı tahsilatı ikinci kez almaya kalkabiliyordu.
      _reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        floatingActionButton: _fab(),
        body: SafeArea(
          child: FutureBuilder<_AccData>(
            future: _future,
            builder: (context, snapshot) {
              return Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 18, 16, 0),
                    child: Column(
                      children: [
                        PageHeader(
                          eyebrow: 'Finans',
                          title: 'Ön Muhasebe',
                          subtitle: _period.label(),
                          action: _guideButton('accounting'),
                        ),
                        const SizedBox(height: 12),
                        PeriodSelector(
                          value: _period,
                          showYear: true,
                          onChanged: (v) => setState(() {
                            _period = v;
                            _future = _load();
                          }),
                        ),
                        const SizedBox(height: 10),
                        _tabBar(),
                      ],
                    ),
                  ),
                  if (snapshot.connectionState != ConnectionState.done)
                    const Expanded(
                      child: Center(child: CircularProgressIndicator()),
                    )
                  else if (snapshot.hasError)
                    Expanded(child: Center(child: Text('${snapshot.error}')))
                  else
                    Expanded(child: _body(snapshot.data!)),
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  Widget? _fab() {
    switch (_tab) {
      case _Tab.adisyon:
        return FloatingActionButton.extended(
          onPressed: _createAdisyon,
          icon: const Icon(Icons.add_rounded),
          label: const Text('Adisyon aç'),
        );
      case _Tab.accounts:
        return FloatingActionButton.extended(
          onPressed: _createAccount,
          icon: const Icon(Icons.add_rounded),
          label: const Text('Cari hesap'),
        );
      case _Tab.expenses:
        return FloatingActionButton.extended(
          onPressed: () => _createExpense(salary: false),
          icon: const Icon(Icons.add_rounded),
          label: const Text('Yeni gider'),
        );
      case _Tab.salary:
        return FloatingActionButton.extended(
          onPressed: () => _createExpense(salary: true),
          icon: const Icon(Icons.add_rounded),
          label: const Text('Maaş öde'),
        );
      case _Tab.overview:
        return null;
    }
  }

  Widget _tabBar() {
    const items = [
      [_Tab.overview, 'Genel Bakış'],
      [_Tab.adisyon, 'Adisyon'],
      [_Tab.accounts, 'Cari Hesaplar'],
      [_Tab.expenses, 'Giderler'],
      [_Tab.salary, 'Maaşlar'],
    ];
    return SizedBox(
      height: 38,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          for (final it in items)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: GestureDetector(
                onTap: () => setState(() => _tab = it[0] as _Tab),
                child: Container(
                  alignment: Alignment.center,
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  decoration: BoxDecoration(
                    color: _tab == it[0] ? AppColors.primary : Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(
                        color: _tab == it[0]
                            ? AppColors.primary
                            : AppColors.border),
                  ),
                  child: Text(it[1] as String,
                      style: TextStyle(
                        color: _tab == it[0] ? Colors.white : AppColors.ink,
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                      )),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _body(_AccData data) {
    switch (_tab) {
      case _Tab.overview:
        return _overview(data);
      case _Tab.adisyon:
        return _adisyonList(data);
      case _Tab.accounts:
        return _accountList(data);
      case _Tab.expenses:
        return _expenseList(data, salary: false);
      case _Tab.salary:
        return _expenseList(data, salary: true);
    }
  }

  // ---- Overview ----
  Widget _overview(_AccData data) {
    double income = 0;
    for (final a in data.accounts) {
      for (final p in (a['payments'] as List? ?? const [])) {
        if (p is Map && _inMonth(p['occurredAtUtc'])) {
          income += (p['amount'] as num?)?.toDouble() ?? 0;
        }
      }
    }
    final expenseTotal = data.expenses.fold<double>(
        0, (s, e) => s + ((e['amount'] as num?)?.toDouble() ?? 0));
    final salaryTotal = data.expenses
        .where((e) => '${e['category']}' == 'Salary')
        .fold<double>(0, (s, e) => s + ((e['amount'] as num?)?.toDouble() ?? 0));
    final receivables = data.accounts.fold<double>(
        0, (s, a) => s + ((a['remainingAmount'] as num?)?.toDouble() ?? 0));
    var openNet = 0.0;
    for (final ad in data.adisyonlar) {
      if ('${ad['status']}' == 'Open') {
        openNet += ((ad['chargeTotal'] as num?)?.toDouble() ?? 0) -
            ((ad['paymentTotal'] as num?)?.toDouble() ?? 0);
      }
    }
    final cards = [
      ['Bu ay tahsilat', income, const Color(0xFF2A7A50), Icons.trending_up_rounded],
      ['Bu ay gider', expenseTotal, const Color(0xFFB23252), Icons.trending_down_rounded],
      ['Net', income - expenseTotal, AppColors.primaryDark, Icons.account_balance_wallet_rounded],
      ['Toplam alacak', receivables, const Color(0xFFB5772A), Icons.request_quote_rounded],
      ['Açık adisyon', openNet, const Color(0xFF2F5FA6), Icons.receipt_long_rounded],
      ['Personel maaş yükü', salaryTotal, const Color(0xFF8C4460), Icons.groups_rounded],
    ];
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 110),
      children: [
        AdaptiveStatGrid(
          phoneCols: 2,
          height: 112,
          children: [
            for (final c in cards)
              _metric(c[0] as String, c[1] as double, c[2] as Color,
                  c[3] as IconData),
          ],
        ),
      ],
    );
  }

  Widget _metric(String label, double value, Color color, IconData icon) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Icon(icon, color: color, size: 20),
          Text(label,
              style: const TextStyle(fontSize: 11, color: AppColors.muted)),
          Text(CalendarText.tl(value),
              style: TextStyle(
                  fontWeight: FontWeight.w800, fontSize: 18, color: color)),
        ],
      ),
    );
  }

  // ---- Adisyon ----
  /// ADİSYON KOKPİTİ — web ön muhasebe sekmesindeki sadeleştirmenin karşılığı.
  /// Sayaç ve süzgeç TEK nesnedir: durumlar hem sayılır hem tıklanınca listeyi süzer.
  /// Üstteki tek kart açık fiş sayısını ve paranın nereye gittiğini söyler; üç adımlık
  /// akış anlatımı kalıcı şerit değil, istendiğinde açılır.
  Widget _adisyonList(_AccData data) {
    final query = _adisyonQuery.trim().toLowerCase();
    final counts = <String, int>{'all': data.adisyonlar.length, 'Open': 0, 'Approved': 0, 'Cancelled': 0};
    var openNet = 0.0;
    var charge = 0.0;
    var payment = 0.0;
    for (final a in data.adisyonlar) {
      final st = '${a['status']}';
      counts[st] = (counts[st] ?? 0) + 1;
      final c = (a['chargeTotal'] as num?)?.toDouble() ?? 0;
      final p = (a['paymentTotal'] as num?)?.toDouble() ?? 0;
      if (st == 'Open') openNet += c - p;
      if (st == 'Approved') {
        charge += c;
        payment += p;
      }
    }

    final filtered = data.adisyonlar.where((a) {
      if (_adisyonFilter != 'all' && '${a['status']}' != _adisyonFilter) return false;
      if (query.isEmpty) return true;
      final items = (a['items'] as List? ?? const [])
          .map((i) => i is Map ? '${i['description'] ?? ''}' : '')
          .join(' ');
      return '${a['customerName'] ?? ''} $items'.toLowerCase().contains(query);
    }).toList();

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 110),
      children: [
        _adisyonCockpit(counts, openNet, charge, payment),
        const SizedBox(height: 12),
        if (filtered.isEmpty)
          _adisyonEmpty()
        else
          for (var i = 0; i < filtered.length; i++)
            // Kartlar sırayla süzülerek girer — liste süzgeç değişince canlı hissedilsin.
            TweenAnimationBuilder<double>(
              key: ValueKey('${filtered[i]['id']}-$_adisyonFilter'),
              tween: Tween(begin: 0, end: 1),
              duration: Duration(milliseconds: 260 + (i.clamp(0, 8) * 26)),
              curve: Curves.easeOutCubic,
              builder: (_, v, child) => Opacity(
                opacity: v,
                child: Transform.translate(offset: Offset(0, (1 - v) * 12), child: child),
              ),
              child: _adisyonCard(filtered[i]),
            ),
      ],
    );
  }

  Widget _adisyonCockpit(Map<String, int> counts, double openNet, double charge, double payment) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Marka bandı: açık fiş sayısı + paranın üç gerçeği.
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
            color: AppColors.primary,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.receipt_long_rounded, color: Colors.white, size: 18),
                    const SizedBox(width: 8),
                    Text(
                        'ADİSYON · ${DateFormat('MMMM yyyy', 'tr_TR').format(_rangeStart).toUpperCase()}',
                        style: const TextStyle(
                            fontSize: 10.5,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 1.2,
                            color: Colors.white)),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('${counts['Open'] ?? 0}',
                        style: const TextStyle(
                            fontSize: 38,
                            height: 1,
                            fontWeight: FontWeight.w800,
                            color: Colors.white)),
                    const SizedBox(width: 8),
                    const Padding(
                      padding: EdgeInsets.only(bottom: 4),
                      child: Text('açık fiş',
                          style: TextStyle(fontSize: 12, color: Colors.white)),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    _cockpitFact('Bekleyen net', openNet),
                    _cockpitFact('Cariye', charge),
                    _cockpitFact('Kasaya', payment),
                  ],
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Sayaç ve süzgeç tek şeydir — birine dokunun, liste süzülsün.',
                    style: TextStyle(fontSize: 11.5, color: AppColors.muted)),
                const SizedBox(height: 9),
                _filterChips(
                  {
                    'all': 'Tümü ${counts['all'] ?? 0}',
                    'Open': 'Açık ${counts['Open'] ?? 0}',
                    'Approved': 'Onaylı ${counts['Approved'] ?? 0}',
                    'Cancelled': 'İptal ${counts['Cancelled'] ?? 0}',
                  },
                  _adisyonFilter,
                  (v) => setState(() => _adisyonFilter = v),
                ),
                const SizedBox(height: 10),
                TextField(
                  onChanged: (v) => setState(() => _adisyonQuery = v),
                  decoration: InputDecoration(
                    isDense: true,
                    hintText: 'Müşteri veya kalem ara…',
                    prefixIcon: const Icon(Icons.search_rounded, size: 18),
                    suffixIcon: _adisyonQuery.isEmpty
                        ? null
                        : IconButton(
                            icon: const Icon(Icons.close_rounded, size: 16),
                            onPressed: () => setState(() => _adisyonQuery = ''),
                          ),
                  ),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => showModalBottomSheet<void>(
                          context: context,
                          isScrollControlled: true,
                          useSafeArea: true,
                          backgroundColor: Colors.transparent,
                          builder: (_) => DailyAdisyonSheet(api: widget.api),
                        ),
                        icon: const Icon(Icons.today_rounded, size: 17),
                        label: const Text('Bugünün Kartı', overflow: TextOverflow.ellipsis),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => setState(() => _adisyonFlowOpen = !_adisyonFlowOpen),
                        icon: const Icon(Icons.help_outline_rounded, size: 17),
                        label: const Text('Nasıl işler?', overflow: TextOverflow.ellipsis),
                      ),
                    ),
                  ],
                ),
                // Akış anlatımı: her gün aynı ekrana bakan kullanıcı için gürültü,
                // yeni kullanıcı için gerekli — isteyen açar.
                AnimatedCrossFade(
                  firstChild: const SizedBox(width: double.infinity),
                  secondChild: Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: Column(
                      children: [
                        for (final step in const [
                          ('1', 'Adisyon açılır, kalemler toplanır', Color(0xFFB88938)),
                          ('2', 'Yönetici onaylar', AppColors.success),
                          ('3', 'Borç cariye, tahsilat kasaya işlenir', AppColors.danger),
                        ])
                          Padding(
                            padding: const EdgeInsets.only(bottom: 6),
                            child: Row(
                              children: [
                                Container(
                                  width: 18,
                                  height: 18,
                                  alignment: Alignment.center,
                                  decoration: BoxDecoration(
                                    color: step.$3.withValues(alpha: .14),
                                    shape: BoxShape.circle,
                                  ),
                                  child: Text(step.$1,
                                      style: TextStyle(
                                          fontSize: 9.5,
                                          fontWeight: FontWeight.w900,
                                          color: step.$3)),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(step.$2,
                                      style: const TextStyle(
                                          fontSize: 11.5, color: AppColors.ink)),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                  crossFadeState: _adisyonFlowOpen
                      ? CrossFadeState.showSecond
                      : CrossFadeState.showFirst,
                  duration: const Duration(milliseconds: 240),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _cockpitFact(String label, double value) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .20),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text('$label: ${CalendarText.tl(value)}',
            style: const TextStyle(
                fontSize: 11, fontWeight: FontWeight.w700, color: Colors.white)),
      );

  Widget _adisyonEmpty() {
    final filtering = _adisyonQuery.isNotEmpty || _adisyonFilter != 'all';
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 34, horizontal: 18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          Container(
            width: 46,
            height: 46,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: .12),
              borderRadius: BorderRadius.circular(15),
            ),
            child: const Icon(Icons.receipt_long_rounded,
                color: AppColors.primaryDark, size: 24),
          ),
          const SizedBox(height: 10),
          Text(filtering ? 'Süzgeçle eşleşen adisyon yok.' : 'Bu dönemde adisyon yok.',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text(
            filtering
                ? 'Aramayı temizleyin ya da başka bir durum seçin.'
                : 'Aşağıdaki “Adisyon aç” ile ilk fişi açabilirsiniz.',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
          ),
          if (filtering) ...[
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => setState(() {
                _adisyonQuery = '';
                _adisyonFilter = 'all';
              }),
              child: const Text('Süzgeci temizle'),
            ),
          ],
        ],
      ),
    );
  }

  /// Adisyon kartı (web `AdisyonPanel` kart diliyle): durum tonlu ikon çipi,
  /// müşteri + tarih/kalem satırı, üç haneli borç/tahsilat/kalan şeridi.
  /// Dokunma: açık adisyon düzenlenebilir sayfaya, kapanmış adisyon fişe gider.
  Widget _adisyonCard(Map<String, dynamic> a) {
    final status = '${a['status']}';
    final open = status == 'Open';
    final cancelled = status == 'Cancelled';
    final charge = (a['chargeTotal'] as num?)?.toDouble() ?? 0;
    final payment = (a['paymentTotal'] as num?)?.toDouble() ?? 0;
    final net = charge - payment;
    final items = (a['items'] as List? ?? const []);
    final opened = parseUtcToLocal(a['openedAtUtc']);

    final (Color bg, Color ink, String label) = open
        ? (const Color(0xFFE7F3FF), const Color(0xFF2F6BA6), 'AÇIK')
        : cancelled
        ? (const Color(0xFFFFE1E6), const Color(0xFFC0405F), 'İPTAL')
        : (const Color(0xFFDCF5E7), const Color(0xFF2F7D54), 'ONAYLI');

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: () => _openAdisyon(a),
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              children: [
                Row(
                  children: [
                    Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: bg,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Icon(
                        open
                            ? Icons.receipt_long_rounded
                            : cancelled
                            ? Icons.cancel_rounded
                            : Icons.check_circle_rounded,
                        size: 19,
                        color: ink,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            valueOf(
                              a,
                              const ['customerName'],
                              fallback: 'Müşteri',
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 13.5,
                            ),
                          ),
                          const SizedBox(height: 1),
                          Text(
                            '${opened != null ? DateFormat('d MMM yyyy', 'tr_TR').format(opened) : '—'}'
                            '${items.isNotEmpty ? ' · ${items.length} kalem' : ''}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 11,
                              color: AppColors.muted,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 7,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: bg,
                        borderRadius: BorderRadius.circular(7),
                      ),
                      child: Text(
                        label,
                        style: TextStyle(
                          fontSize: 9.5,
                          fontWeight: FontWeight.w900,
                          color: ink,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Container(
                  decoration: BoxDecoration(
                    color: AppColors.surfaceSoft,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  padding: const EdgeInsets.symmetric(vertical: 7),
                  child: Row(
                    children: [
                      _adisyonTotal('Borç', charge, AppColors.ink),
                      _adisyonTotal(
                        'Tahsilat',
                        payment,
                        const Color(0xFF2F7D54),
                      ),
                      _adisyonTotal(
                        net >= 0 ? 'Kalan' : 'Fazla',
                        net.abs(),
                        net > 0 ? const Color(0xFFC0405F) : AppColors.ink,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _adisyonTotal(String label, double value, Color color) => Expanded(
    child: Column(
      children: [
        Text(
          label.toUpperCase(),
          style: const TextStyle(
            fontSize: 9.5,
            letterSpacing: .6,
            fontWeight: FontWeight.w800,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: 1),
        Text(
          CalendarText.tl(value),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w900,
            color: color,
          ),
        ),
      ],
    ),
  );

  /// Açık adisyon düzenlenebilir sayfada, kapanmış adisyon okunur fişte açılır
  /// (web'deki AdisyonModal ↔ AdisyonReceiptModal ayrımı).
  Future<void> _openAdisyon(Map<String, dynamic> a) async {
    final id = '${a['id'] ?? ''}'.trim();
    if (id.isEmpty || id.toLowerCase() == 'null') {
      await _openCustomerDetail(a);
      return;
    }
    if ('${a['status']}' == 'Open') {
      await showModalBottomSheet<bool>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        backgroundColor: Colors.transparent,
        builder: (_) => AdisyonDetailSheet(api: widget.api, adisyonId: id),
      );
      if (mounted) _reload();
      return;
    }
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => AdisyonReceiptSheet(
        api: widget.api,
        adisyonId: id,
        onShowCustomer: () => _openCustomerDetail(a),
      ),
    );
    if (mounted) _reload();
  }

  /// Adisyon/cari karta dokununca web'deki gibi tam müşteri detayını
  /// (Adisyon sekmesi) açar.
  Future<void> _openCustomerDetail(Map<String, dynamic> row) async {
    final id = '${row['customerId'] ?? ''}'.trim();
    if (id.isEmpty || id.toLowerCase() == 'null') {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Müşteri bilgisi bulunamadı.')));
      return;
    }
    await context.push('/customer-detail', extra: {
      'customerId': id,
      'customer': {'id': id, 'fullName': row['customerName'] ?? row['name']},
      'initialTab': 'adisyon',
    });
    if (mounted) _reload();
  }

  Future<void> _createAdisyon() async {
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: 'Adisyon aç',
        icon: Icons.receipt_long_rounded,
        fields: [
          CrudField(
            key: 'customerId',
            label: 'Müşteri',
            type: CrudFieldType.select,
            required: true,
            searchLoader: CrudOptions(widget.api).customerSearch,
          ),
          // SATIŞ TARİHİ — geçmişe dönük giriş (ör. ürün dün satıldı, bugün kaydediliyor).
          // Onayda açılan carinin satış tarihi ve peşinat tahsilatı bu güne yazılır.
          const CrudField(
            key: 'saleDateUtc',
            label: 'Satış tarihi',
            type: CrudFieldType.date,
            dateOnly: false,
            defaultValue: 'today',
          ),
          const CrudField(
              key: 'notes', label: 'Not', type: CrudFieldType.multiline),
        ],
      ),
    );
    if (result?.body == null) return;
    await _guard(
      () => widget.api.post('/api/admin/adisyonlar/', {
        'branchId': widget.api.auth?.user?.branchId,
        'customerId': result!.body!['customerId'],
        'customerAccountId': null,
        'notes': result.body!['notes'],
        'saleDateUtc': result.body!['saleDateUtc'],
      }),
      'Adisyon açıldı.',
    );
  }

  // ---- Accounts ----
  /// Cari hesaplar — web'deki yeni tasarımın karşılığı: arama + filtre,
  /// peşin/taksitli ayrımı, sıradaki vade ve karttan doğrudan tahsilat.
  Widget _accountList(_AccData data) {
    // İptal edilen satış borç/vade akışının DIŞINDADIR: kayıt arşive taşındığı için listede
    // zaten görünmez. Aşağıdaki süzgeç, migration'ı henüz uygulanmamış kurumlarda kalan eski
    // damgalı satırlara karşı savunma olarak durur.
    // İPTAL ÖLÇÜTÜ İKİ KAYNAKTAN: damga (saleStatus/cancelledAtUtc) VE iptal arşivi. Yalnız
    // damgaya bakmak, damgası eksik kalmış satışı canlı ve TAHSİLAT ALINABİLİR bırakıyordu —
    // arşivde iptal görünen bir satışa para yazılabilirdi (web paritesi).
    final cancelledIds = data.cancelled
        .map((c) => '${c['originalAccountId'] ?? ''}')
        .where((id) => id.isNotEmpty && id != 'null')
        .toSet();
    bool cancelled(Map<String, dynamic> a) =>
        '${a['saleStatus']}' == 'Cancelled' ||
        '${a['cancelledAtUtc'] ?? ''}'.replaceAll('null', '').isNotEmpty ||
        cancelledIds.contains('${a['id']}');
    final live = data.accounts.where((a) => !cancelled(a)).toList();
    final cancelledCount = data.cancelled.length;
    // İADE: iptal edilirken müşteriye para geri ödenmiş kayıtlar.
    final refundedRows = data.cancelled
        .where((c) => numberOf(c, const ['refundedAmount']) > 0.005)
        .toList();
    final refundedCount = refundedRows.length;
    final refundedTotal =
        refundedRows.fold<double>(0, (s, c) => s + numberOf(c, const ['refundedAmount']));

    bool hasOverdue(Map<String, dynamic> a) =>
        parseInstallments(a).any((i) => i.overdue);

    final counts = {
      'all': live.length,
      'overdue': live.where(hasOverdue).length,
      'upcoming': live
          .where((a) => numberOf(a, const ['remainingAmount']) > 0.005 && !hasOverdue(a))
          .length,
      'installment': live.where(isInstallmentAccount).length,
      'closed':
          live.where((a) => numberOf(a, const ['remainingAmount']) <= 0.005).length,
    };

    final query = _accountQuery.trim().toLowerCase();
    final filtered = live.where((a) {
      final remaining = numberOf(a, const ['remainingAmount']);
      if (_accountFilter == 'overdue' && !hasOverdue(a)) return false;
      if (_accountFilter == 'upcoming' && !(remaining > 0.005 && !hasOverdue(a))) return false;
      if (_accountFilter == 'installment' && !isInstallmentAccount(a)) return false;
      if (_accountFilter == 'closed' && remaining > 0.005) return false;
      if (query.isEmpty) return true;
      final hay = [
        valueOf(a, const ['customerName'], fallback: ''),
        valueOf(a, const ['name'], fallback: ''),
        valueOf(a, const ['servicePackageName'], fallback: ''),
        valueOf(a, const ['customerPhone'], fallback: ''),
      ].join(' ').toLowerCase();
      return hay.contains(query);
    }).toList()
      // SIRALAMA: EN YENİ CARİ HER ZAMAN EN ÜSTTE (web paritesi).
      //
      // Eskiden gecikenler önce, sonra açık hesaplar (en yakın vade) diye diziliyordu: yeni açılan
      // bir satış listenin ortasına düşüyor, "az önce yaptığım satış nerede" diye aranıyordu.
      // Geciken/açık/kapalı ayrımı zaten üstteki süzgeç çipleriyle yapılıyor; sıralamanın taşıması
      // gereken bilgi TAZELİK. Aynı anda açılan kayıtlarda vade sırası ikincil ölçüt kalır.
      ..sort((a, b) {
        final at = DateTime.tryParse(valueOf(a, const ['createdAtUtc'], fallback: ''));
        final bt = DateTime.tryParse(valueOf(b, const ['createdAtUtc'], fallback: ''));
        final am = at?.millisecondsSinceEpoch ?? 0;
        final bm = bt?.millisecondsSinceEpoch ?? 0;
        if (am != bm) return bm.compareTo(am);
        return valueOf(a, const ['nextDueDate'], fallback: '9999')
            .compareTo(valueOf(b, const ['nextDueDate'], fallback: '9999'));
      });

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 110),
      children: [
        TextField(
          onChanged: (v) => setState(() => _accountQuery = v),
          decoration: InputDecoration(
            isDense: true,
            hintText: 'Müşteri, paket veya telefon ara…',
            prefixIcon: const Icon(Icons.search_rounded, size: 18),
            suffixIcon: _accountQuery.isEmpty
                ? null
                : IconButton(
                    icon: const Icon(Icons.close_rounded, size: 18),
                    onPressed: () => setState(() => _accountQuery = ''),
                  ),
          ),
        ),
        const SizedBox(height: 10),
        _filterChips(
          {
            'all': 'Tümü ${counts['all']}',
            'overdue': 'Geciken ${counts['overdue']}',
            'upcoming': 'Bekleyen ${counts['upcoming']}',
            'installment': 'Taksitli ${counts['installment']}',
            'closed': 'Kapanan ${counts['closed']}',
          },
          _accountFilter,
          (v) => setState(() => _accountFilter = v),
        ),
        const SizedBox(height: 8),
        // NOT: "arşiv ayrı çöktü" uyarısı KALDIRILDI çünkü o durum artık OLUŞAMAZ — canlı
        // cariler ve iptal arşivi tek istekten gelir; istek patlarsa ekranın tamamı hata
        // gösterir, sessiz "İptal edilenler · 0" mümkün değildir.
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton.icon(
              onPressed: () => _openCancelledSales(data.cancelled),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.danger,
                side: BorderSide(color: AppColors.danger.withValues(alpha: .35)),
                visualDensity: VisualDensity.compact,
              ),
              icon: const Icon(Icons.block_rounded, size: 16),
              label: Text(
                cancelledCount > 0 ? 'İptal edilenler · $cancelledCount' : 'İptal edilenler',
                style: const TextStyle(fontSize: 12),
              ),
            ),
            // İADE = müşteriye para geri ödenmiş iptaller; ayrı buton, iade sekmesini açar.
            OutlinedButton.icon(
              onPressed: () => _openCancelledSales(data.cancelled, refundTab: true),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.warning,
                side: BorderSide(color: AppColors.warning.withValues(alpha: .35)),
                visualDensity: VisualDensity.compact,
              ),
              icon: const Icon(Icons.undo_rounded, size: 16),
              label: Text(
                refundedTotal > 0.005
                    ? 'İade edilenler · $refundedCount · ${CalendarText.tl(refundedTotal)}'
                    : 'İade edilenler',
                style: const TextStyle(fontSize: 12),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        if (filtered.isEmpty)
          _empty(_accountQuery.isEmpty
              ? 'Bu kapsamda cari hesap yok.'
              : 'Aramaya uyan cari hesap yok.'),
        // MÜŞTERİ BAZINDA GRUPLAMA (web paritesi): aynı müşterinin birden çok satışı TEK
        // satırda toplanır; satıra dokununca müşterinin cari defteri (tam ekran) açılır.
        // Süzgeç önce hesap düzeyinde uygulanır (çipler hesap sayar), sonra gruplanır.
        for (final g in _groupsOf(filtered)) _customerRow(g),
      ],
    );
  }

  /// Süzülmüş hesapları müşteriye göre gruplar + listeleme sırasını verir.
  List<CustomerAccountGroup> _groupsOf(List<Map<String, dynamic>> accounts) {
    final groups = groupAccountsByCustomer(accounts);
    groups.sort((a, b) {
      // Geciken müşteri üstte: ön muhasebede ilk iş "kim ödemedi" bakmaktır.
      if (a.hasOverdue != b.hasOverdue) return a.hasOverdue ? -1 : 1;
      // Sonra tazelik (yeni satış hemen görünsün), eşitse en yakın vade.
      final t = b.lastSaleAtUtc.compareTo(a.lastSaleAtUtc);
      if (t != 0) return t;
      return (a.nextDueDate ?? '9999').compareTo(b.nextDueDate ?? '9999');
    });
    return groups;
  }

  /// Müşteri satırı — tablo görünümü: ad · satış adedi · tutarlar · ilerleme · vade.
  Widget _customerRow(CustomerAccountGroup g) {
    final isOpen = g.remainingAmount > 0.005;
    final pct = g.totalAmount > 0 ? (g.paidAmount / g.totalAmount).clamp(0.0, 1.0) : 0.0;
    final initials = g.customerName
        .trim()
        .split(RegExp(r'\s+'))
        .where((w) => w.isNotEmpty)
        .take(2)
        .map((w) => w[0])
        .join()
        .toUpperCase();

    return InkWell(
      // DEFTER SÜZGEÇTEN BAĞIMSIZ: "Geciken" çipi ya da arama açıkken grup yalnız EŞLEŞEN
      // satışı taşır; defter müşterinin gerçeğini değil süzgecin kalıntısını gösterirdi.
      onTap: () => _openCustomerLedger(_unfilteredGroupOf(g)),
      borderRadius: BorderRadius.circular(16),
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: g.hasOverdue
                ? AppColors.danger.withValues(alpha: .35)
                : isOpen
                    ? AppColors.border
                    : AppColors.success.withValues(alpha: .35),
          ),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
              width: 36,
              height: 36,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.rose,
                borderRadius: BorderRadius.circular(11),
              ),
              child: Text(initials.isEmpty ? '—' : initials,
                  style: const TextStyle(
                      fontSize: 11, fontWeight: FontWeight.w800, color: AppColors.primaryDark)),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(g.customerName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                Text(
                  g.saleCount == 1
                      ? valueOf(g.accounts.first, const ['servicePackageName', 'name'], fallback: '')
                      : '${g.saleCount} satış',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
                ),
              ]),
            ),
            const SizedBox(width: 8),
            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text(CalendarText.tl(g.remainingAmount),
                  style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                      color: isOpen
                          ? (g.hasOverdue ? AppColors.danger : AppColors.primaryDark)
                          : AppColors.success)),
              Text(isOpen ? 'kalan borç' : 'kapandı',
                  style: const TextStyle(fontSize: 9.5, color: AppColors.muted)),
            ]),
          ]),
          const SizedBox(height: 8),
          // Tutar üçlüsü — tabloda sütun olan bilgiler dar ekranda satır içinde.
          Row(children: [
            Expanded(child: _miniStat('Toplam', CalendarText.tl(g.totalAmount), AppColors.ink)),
            Expanded(child: _miniStat('Tahsil', CalendarText.tl(g.paidAmount), AppColors.success)),
            Expanded(child: _miniStat('Satış', '${g.saleCount}', AppColors.muted)),
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
                  valueColor:
                      AlwaysStoppedAnimation(isOpen ? AppColors.primary : AppColors.success),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Text('%${(pct * 100).round()}',
                style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
          ]),
          const SizedBox(height: 8),
          Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
            if (g.hasOverdue) _tag('GECİKMİŞ', AppColors.danger),
            if (g.hasInstallmentPlan && !g.hasOverdue) _tag('TAKSİTLİ', const Color(0xFF7C3AED)),
            if (isOpen && g.nextDueDate != null)
              Text('${shortDay(g.nextDueDate!)} · ${CalendarText.tl(g.nextDueAmount)}',
                  style: const TextStyle(fontSize: 11, color: AppColors.muted)),
            // ÇOK SATIŞLIDA DA VAR: hedef artık belirsiz değil — tahsilat sayfası o
            // müşterinin satışlarını listeleyip seçtiriyor (web paritesi).
            if (isOpen)
              TextButton.icon(
                onPressed: () => _collectForGroup(g),
                style: AppButtons.inline(),
                icon: const Icon(Icons.payments_rounded, size: 15),
                label: Text(
                    g.accounts.where((a) => numberOf(a, const ['remainingAmount']) > 0.005).length > 1
                        ? 'Tahsilat al · ${g.accounts.where((a) => numberOf(a, const ['remainingAmount']) > 0.005).length} satış'
                        : 'Tahsilat al',
                    style: const TextStyle(fontSize: 11.5)),
              ),
          ]),
        ]),
      ),
    );
  }

  Widget _miniStat(String label, String value, Color tone) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label.toUpperCase(),
              style: const TextStyle(
                  fontSize: 8.5, fontWeight: FontWeight.w800, letterSpacing: .4, color: AppColors.muted)),
          Text(value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: tone)),
        ],
      );

  /// ÇOK SATIŞLI MÜŞTERİDE TAHSİLAT — sayfa o müşterinin satışlarına daraltılır.
  ///
  /// Açılışta seçili gelen satış EN ACİL olandır: gecikmişi olan, yoksa vadesi en yakın,
  /// yoksa borcu en büyük. Tahsilat tek satışın carisine yazılır (bölüştürülmez), kullanıcı
  /// isterse sayfadaki seçiciden başka satışa geçer.
  Future<void> _collectForGroup(CustomerAccountGroup g, {bool all = false}) async {
    final open = g.accounts
        .where((a) => numberOf(a, const ['remainingAmount']) > 0.005)
        .toList();
    final pool = open.isNotEmpty ? open : g.accounts;
    if (pool.isEmpty) return;
    final sorted = [...pool]..sort((a, b) {
        final ao = a['hasOverdue'] == true, bo = b['hasOverdue'] == true;
        if (ao != bo) return ao ? -1 : 1;
        final ad = valueOf(a, const ['nextDueDate'], fallback: '9999-12-31');
        final bd = valueOf(b, const ['nextDueDate'], fallback: '9999-12-31');
        final c = (ad.isEmpty ? '9999-12-31' : ad).compareTo(bd.isEmpty ? '9999-12-31' : bd);
        if (c != 0) return c;
        return numberOf(b, const ['remainingAmount'])
            .compareTo(numberOf(a, const ['remainingAmount']));
      });
    final saved = await showCollectionSheet(
      context,
      api: widget.api,
      accounts: pool,
      initialAccountId: '${sorted.first['id']}',
      defaultAll: all,
      title: 'Tahsilat al',
    );
    if (saved == null || saved == 0) return;
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Tahsilat kaydedildi.')));
    }
    _reload();
  }

  /// MÜŞTERİ CARİ DEFTERİ — tam ekran. Taksit takvimi burada; tahsilat hâlâ TEK BİR SATIŞIN
  /// carisine yazılır (para doğru yere gitsin diye satış satırından açılır).
  Future<void> _openCustomerLedger(CustomerAccountGroup g) async {
    await openCustomerLedgerSheet(
      context,
      group: g,
      // Ekstre belgesinin antetindeki kurum bilgisi bu istemciden okunur.
      api: widget.api,
      // İPTAL ARŞİVİ: iptal edilen satışın tahsilat/iadesi canlı listede YOKTUR (arşive taşınır),
      // defterde hiç görünmüyordu.
      cancelledSales: (_last?.cancelled ?? const <Map<String, dynamic>>[])
          .where((c) => '${c['customerId']}' == g.customerId)
          .toList(),
      // CARİYE HENÜZ İŞLENMEMİŞ SATIŞLAR: peşinatsız hizmet/paket satışı cari kartı açmaz,
      // fiş Açık kalır (ilk randevu tamamlanınca işlenir). Ekstrede uyarı olarak görünür ki
      // "sattım ama ekstrede yok" sorusu yanıtsız kalmasın.
      pendingSales: (_last?.adisyonlar ?? const <Map<String, dynamic>>[])
          .where((a) =>
              '${a['customerId']}' == g.customerId &&
              '${a['status'] ?? ''}'.toLowerCase() == 'open' &&
              numberOf(a, const ['chargeTotal']) > 0.005)
          .map((a) => {
                'id': '${a['id'] ?? ''}',
                'amount': numberOf(a, const ['chargeTotal']),
                'openedAtUtc': '${a['openedAtUtc'] ?? ''}',
              })
          .toList(),
      onCollect: (a) async => _openAccountDetail(a),
      // TÜMÜ: sayfa müşterinin bütün satışlarıyla ve TÜMÜ seçili açılır.
      onCollectAll: () async => _collectForGroup(g, all: true),
      onOpenSale: (a) async => _openAccountDetail(a),
      onOpenSalesWorkspace: () async {
        if (g.accounts.isEmpty) return;
        await _openCustomerSales(g.accounts.first);
      },
      // TAHSİLAT SONRASI DEFTER TAZELENİR: sayfa açık kalırken alınan tahsilat sonrası KPI ve
      // takvim eski rakamları göstermeye devam ediyordu. Veri SUNUCUDAN yeniden çekilir —
      // ekrandaki listeden süzmek, ekranın kendisi bayatken işe yaramaz.
      onRefresh: () => _reloadLedgerGroup(g.customerId),
    );
    if (mounted) _reload();
  }

  /// İptal edilmiş mi? Damga VEYA arşiv kaydı — ikisinden biri yeterli (bkz. `cancelled`).
  bool _isCancelledAccount(Map<String, dynamic> a) {
    if ('${a['saleStatus']}' == 'Cancelled') return true;
    if ('${a['cancelledAtUtc'] ?? ''}'.replaceAll('null', '').isNotEmpty) return true;
    return (_last?.cancelled ?? const <Map<String, dynamic>>[])
        .any((c) => '${c['originalAccountId']}' == '${a['id']}');
  }

  /// Süzgeçli satırdan, müşterinin TÜM canlı satışlarını taşıyan grubu kurar.
  /// (Kimlik süzgeçli listeden gelir; içerik tam listeden.)
  CustomerAccountGroup _unfilteredGroupOf(CustomerAccountGroup g) {
    if (g.customerId.isEmpty) return g;
    final all = (_last?.accounts ?? const <Map<String, dynamic>>[])
        .where((a) => !_isCancelledAccount(a) && '${a['customerId']}' == g.customerId)
        .toList();
    if (all.length <= g.accounts.length) return g;
    final groups = groupAccountsByCustomer(all);
    return groups.isEmpty ? g : groups.first;
  }

  /// Defterin kendi verisini tazeler: müşterinin TÜM carileri sunucudan yeniden okunur.
  ///
  /// ÜÇ SONUÇ AYRIDIR (bkz. [LedgerRefresh]). Eskiden üçü de `null` dönüyordu ve defter her
  /// durumda eski satırları göstermeye devam ediyordu: "tazeleme başarısız" ile "satış iptal
  /// edildi" ekranda AYNI görünüyor, iptal edilmiş 1.000 TL'lik satış canlı ve TAHSİL
  /// EDİLEBİLİR duruyordu. Hata yutmak, para ekranında eksik veriyi doğru göstermektir.
  Future<LedgerRefresh> _reloadLedgerGroup(String customerId) async {
    if (customerId.isEmpty) return const LedgerRefresh.failed();
    try {
      final res = await widget.api
          .getAllPaged('/api/admin/accounts/', query: {'customerId': customerId}, pageSize: 200);
      final live = apiItems(res).where((a) => !_isCancelledAccount(a)).toList();
      // Canlı satış kalmadı = satış iptal/silinmiş. "Okunamadı" DEĞİLDİR; ayrı söylenir.
      if (live.isEmpty) return const LedgerRefresh.gone();
      final groups = groupAccountsByCustomer(live);
      return groups.isEmpty
          ? const LedgerRefresh.gone()
          : LedgerRefresh.loaded(groups.first);
    } catch (_) {
      return const LedgerRefresh.failed();
    }
  }


  Widget _tag(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: color.withValues(alpha: .10),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(text,
            style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: color)),
      );

  /// CARİ → MÜŞTERİNİN SATIŞLARI. Müşteri kartındaki sheet'in AYNISI açılır (iki ayrı liste
  /// değil). Hesaplar müşteri başına TAZE çekilir: ekrandaki cari listesi sayfalı ve iptalleri
  /// dışlıyor, oysa sheet'in "İptal" sekmesi onları göstermek zorunda.
  Future<void> _openCustomerSales(Map<String, dynamic> account) async {
    final customerId = '${account['customerId'] ?? ''}';
    if (customerId.isEmpty) return;
    final name = '${account['customerName'] ?? account['name'] ?? 'Müşteri'}';

    CustomerSalesLoad load = const CustomerSalesLoad(accounts: []);
    try {
      // Canlı cariler (sayfalı) + İPTAL ARŞİVİ tek kaynaktan: iptal edilen satır canlı tabloda
      // YOKTUR, arşivsiz çekildiğinde sheet'in "İptal" sekmesi hep boş kalıyordu.
      // Arşiv okunamazsa liste yine gelir ama BAYRAK taşınır (sessiz "iptal yok" yasak).
      load = await loadCustomerSalesAccounts(widget.api, customerId);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Satışlar alınamadı: $e')));
      }
      return;
    }
    if (!mounted) return;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => CustomerSalesSheet(
        api: widget.api,
        customerId: customerId,
        customerName: name,
        accounts: load.accounts,
        archiveUnavailable: load.archiveUnavailable,
        onChanged: () async => _reload(),
      ),
    );
  }

  Future<void> _openAccountDetail(Map<String, dynamic> account) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => AccountDetailSheet(
        api: widget.api,
        account: account,
        onChanged: _reload,
      ),
    );
  }

  Future<void> _openCancelledSales(
    List<Map<String, dynamic>> cancelled, {
    bool refundTab = false,
  }) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CancelledSalesSheet(
        sales: cancelled,
        initialRefundTab: refundTab,
        // Geri alma arşivdeki yedekten cari, taksit, tahsilat ve seansları yeniden kurar.
        // voidRefund=true yalnızca "iade fiilen yapılmamıştı" denildiğinde kasa çıkışını da siler.
        onRestore: (originalAccountId, voidRefund, voidReason) => widget.api.post(
            '/api/admin/accounts/$originalAccountId/restore-sale',
            {'voidRefund': voidRefund, 'voidReason': voidReason}),
      ),
    );
  }

  Future<void> _createAccount() async {
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: 'Yeni cari hesap',
        icon: Icons.account_balance_rounded,
        fields: [
          CrudField(
            key: 'customerId',
            label: 'Müşteri',
            type: CrudFieldType.select,
            required: true,
            searchLoader: CrudOptions(widget.api).customerSearch,
          ),
          const CrudField(key: 'name', label: 'Hesap/Paket adı', required: true),
          const CrudField(
              key: 'totalAmount',
              label: 'Toplam tutar',
              type: CrudFieldType.decimal,
              required: true),
          const CrudField(
              key: 'depositAmount',
              label: 'Peşinat',
              type: CrudFieldType.decimal,
              defaultValue: 0),
          const CrudField(
              key: 'installmentCount',
              label: 'Taksit sayısı',
              type: CrudFieldType.number,
              defaultValue: 1),
          const CrudField(
              key: 'firstDueDate',
              label: 'İlk vade',
              type: CrudFieldType.date,
              defaultValue: 'today',
              required: true),
          const CrudField(
              key: 'notes', label: 'Notlar', type: CrudFieldType.multiline),
        ],
      ),
    );
    if (result?.body == null) return;
    final body = {...result!.body!, 'branchId': widget.api.auth?.user?.branchId};
    await _guard(
        () => widget.api.post('/api/admin/accounts/', body), 'Cari hesap açıldı.');
  }

  // ---- Expenses / Salary ----
  Widget _expenseList(_AccData data, {required bool salary}) {
    final list = data.expenses
        .where((e) =>
            salary ? '${e['category']}' == 'Salary' : '${e['category']}' != 'Salary')
        .toList();
    final total =
        list.fold<double>(0, (s, e) => s + ((e['amount'] as num?)?.toDouble() ?? 0));
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 110),
      children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('${list.length} kalem',
                  style: const TextStyle(fontWeight: FontWeight.w700)),
              Text('Toplam ${CalendarText.tl(total)}',
                  style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      color: AppColors.primaryDark)),
            ],
          ),
        ),
        const SizedBox(height: 10),
        if (list.isEmpty)
          _empty(salary
              ? 'Bu ay maaş ödemesi yok. "Maaş öde" ile ekleyin.'
              : 'Bu ay gider yok. "Yeni gider" ile ekleyin.'),
        for (final e in list)
          Dismissible(
            key: ValueKey(e['id']),
            direction: DismissDirection.endToStart,
            background: Container(
              alignment: Alignment.centerRight,
              padding: const EdgeInsets.only(right: 20),
              margin: const EdgeInsets.only(bottom: 8),
              decoration: BoxDecoration(
                  color: Colors.red.shade400,
                  borderRadius: BorderRadius.circular(16)),
              child: const Icon(Icons.delete_rounded, color: Colors.white),
            ),
            confirmDismiss: (_) async {
              // ONAYLANMIŞ GİDER SİLİNMEZ: gerekçeli void (web ile aynı kural). Silme, gerçekleşmiş
              // kasa çıkışını raporlardan düşürüyordu; kayıt artık iz olarak kalıyor.
              if (e['isApproved'] == true) {
                final reason = await _askExpenseVoidReason();
                if (reason == null || reason.trim().isEmpty) return false;
                await _guard(
                    () => widget.api.post(
                        '/api/admin/expenses/${e['id']}/void', {'reason': reason.trim()}),
                    'Gider geçersiz kılındı.');
                return false;
              }
              await _guard(
                  () => widget.api.delete('/api/admin/expenses/${e['id']}'),
                  'Gider silindi.');
              return false;
            },
            child: _expenseCard(e, salary: salary),
          ),
      ],
    );
  }

  /// Gider/maaş satırı: kategori tonlu ikon çipi + tutar + onay rozeti.
  /// Yönetici kaydı sunucuda anında onaylanır; personel kaydı "onay bekliyor" kalır.
  Widget _expenseCard(Map<String, dynamic> e, {required bool salary}) {
    final approved = e['isApproved'] == true;
    final amount = (e['amount'] as num?)?.toDouble() ?? 0;
    final date = parseUtcToLocal(e['occurredAtUtc']);
    final staff = valueOf(e, const ['staffName'], fallback: '');
    final period = valueOf(e, const ['periodLabel'], fallback: '');
    final tone = salary ? const Color(0xFFEFE7FF) : const Color(0xFFF6DFE6);
    final ink = salary ? const Color(0xFF6B45C0) : const Color(0xFFC0405F);

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: tone,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              salary ? Icons.groups_rounded : Icons.receipt_long_rounded,
              size: 18,
              color: ink,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  valueOf(
                    e,
                    const ['description', 'category'],
                    fallback: 'Gider',
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  [
                    if (salary && staff.isNotEmpty) staff,
                    if (!salary) _catLabel('${e['category']}'),
                    _methodLabel('${e['paymentMethod']}'),
                    if (date != null)
                      DateFormat('d MMM', 'tr_TR').format(date),
                    if (salary && period.isNotEmpty) period,
                  ].join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppColors.muted,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 6),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                CalendarText.tl(amount),
                style: const TextStyle(
                  fontWeight: FontWeight.w900,
                  fontSize: 13.5,
                ),
              ),
              const SizedBox(height: 3),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 6,
                  vertical: 2,
                ),
                decoration: BoxDecoration(
                  color: approved
                      ? const Color(0xFFE6F7EE)
                      : const Color(0xFFFFF3DC),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  approved ? 'Onaylı' : 'Onay bekliyor',
                  style: TextStyle(
                    fontSize: 9.5,
                    fontWeight: FontWeight.w800,
                    color: approved
                        ? const Color(0xFF2F7D54)
                        : const Color(0xFFA3701F),
                  ),
                ),
              ),
              // ONAYLA — personelin girdiği gider yönetici onayına düşer; web'de olan bu
              // aksiyon mobilde yoktu ve kayıt onaysız kalıyordu.
              if (!approved && !(widget.api.auth?.user?.isStaff ?? false)) ...[
                const SizedBox(height: 4),
                SizedBox(
                  height: 26,
                  child: FilledButton.icon(
                    onPressed: () => _approveExpense(e),
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.success,
                      // Tema Size.fromHeight(52) ile sonsuz genişlik ister; bu satırda
                      // soldaki açıklamayı 0 piksele düşürüp harfleri alt alta diziyordu.
                      minimumSize: const Size(0, 26),
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      visualDensity: VisualDensity.compact,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    icon: const Icon(Icons.check_rounded, size: 13),
                    label: const Text('Onayla', style: TextStyle(fontSize: 10.5)),
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }

  /// Bekleyen gideri onaylar (web'deki "ONAYLA" aksiyonunun karşılığı).
  Future<void> _approveExpense(Map<String, dynamic> e) async {
    await _guard(
      () => widget.api.patch('/api/admin/expenses/${e['id']}/approve', const {}),
      'Gider onaylandı.',
    );
  }

  Future<void> _createExpense({required bool salary}) async {
    // Maaş ödemesi kendi sayfasında açılır (web SalaryPaymentDialog paritesi):
    // personel kartlardan seçilir, bu dönemde ne ödendiği kartın üstünde görünür.
    if (salary) {
      final payload = await showModalBottomSheet<Map<String, dynamic>>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        backgroundColor: Colors.transparent,
        builder: (_) => SalaryPaymentSheet(
          staff: _last?.staff ?? const [],
          salaryExpenses: (_last?.expenses ?? const [])
              .where((e) => '${e['category']}' == 'Salary')
              .toList(),
          defaultPeriod: DateFormat('MMMM yyyy', 'tr_TR').format(_rangeStart),
        ),
      );
      if (payload == null) return;
      await _guard(
        () => widget.api.post('/api/admin/expenses/', {
          ...payload,
          'branchId': widget.api.auth?.user?.branchId,
        }),
        'Maaş ödemesi eklendi.',
      );
      return;
    }
    // Gider formu web ExpenseFormDialog paritesi: kategori kartları, "Diğer"de kurumun
    // özel gider kategorileri (ekle/seç/sil), dönem etiketi ve fiş/fatura no.
    final payload = await showExpenseFormSheet(context, api: widget.api);
    if (payload == null) return;
    final body = {
      ...payload,
      'branchId': widget.api.auth?.user?.branchId,
    };
    await _guard(
        () => widget.api.post('/api/admin/expenses/', body), 'Gider eklendi.');
  }

  // ---- shared bits ----
  Widget _filterChips(
    Map<String, String> options,
    String selected,
    ValueChanged<String> onSelect,
  ) {
    return SizedBox(
      height: 34,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          for (final e in options.entries)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: GestureDetector(
                onTap: () => onSelect(e.key),
                child: Container(
                  alignment: Alignment.center,
                  padding: const EdgeInsets.symmetric(horizontal: 13),
                  decoration: BoxDecoration(
                    color: selected == e.key
                        ? AppColors.primary
                        : Colors.white,
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(
                        color: selected == e.key
                            ? AppColors.primary
                            : AppColors.border),
                  ),
                  child: Text(e.value,
                      style: TextStyle(
                        color:
                            selected == e.key ? Colors.white : AppColors.ink,
                        fontWeight: FontWeight.w700,
                        fontSize: 12,
                      )),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _empty(String text) => Padding(
        padding: const EdgeInsets.all(28),
        child: Center(
            child: Text(text,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.muted))),
      );

  String _catLabel(String key) =>
      _expenseCategories.firstWhere((c) => c.value == key,
          orElse: () => CrudOption(key, key)).label;
  String _methodLabel(String key) => paymentMethodLabel(key);
}

class _AccData {
  _AccData({
    required this.accounts,
    required this.expenses,
    required this.adisyonlar,
    required this.staff,
    required this.cancelled,
  });
  final List<Map<String, dynamic>> accounts;
  final List<Map<String, dynamic>> expenses;
  final List<Map<String, dynamic>> adisyonlar;
  final List<Map<String, dynamic>> staff;

  /// İptal arşivi (cancelled_sales) — canlı cariler ile AYNI anlık görüntüden gelir.
  final List<Map<String, dynamic>> cancelled;
}

// ---------------------------------------------------------------------------
// Cari hesap detayı: tahsilat geçmişi + tahsilat kaydet + yeniden planla + sil
// ---------------------------------------------------------------------------
/// Cari hesap detay alt-sayfası — tahsilat/yeniden planla/sil.
/// Ön Muhasebe ve Müşteri Detayı (Adisyon sekmesi) tarafından paylaşılır.
/// Hesap ekstresi satırı — borç/alacak ve o andaki yürüyen bakiye.
class _LedgerRow {
  _LedgerRow({
    required this.at,
    required this.date,
    required this.label,
    required this.detail,
    required this.debit,
    required this.credit,
  });
  final DateTime at;
  final String date;
  final String label;
  final String detail;
  final double debit;
  final double credit;
  double balance = 0;
}

class AccountDetailSheet extends StatefulWidget {
  const AccountDetailSheet({
    required this.api,
    required this.account,
    required this.onChanged,
    super.key,
  });
  final ApiClient api;
  final Map<String, dynamic> account;
  final VoidCallback onChanged;

  @override
  State<AccountDetailSheet> createState() => _AccountDetailSheetState();
}

class _AccountDetailSheetState extends State<AccountDetailSheet> {
  late Map<String, dynamic> a = Map.of(widget.account);

  /// 0 Özet · 1 Taksit Planı · 2 Ekstre · 3 Seans & Sadakat
  int _detailTab = 0;
  List<Map<String, dynamic>> _sessions = const [];
  Map<String, dynamic> _loyalty = const {};
  bool _extrasLoading = false;
  bool _extrasLoaded = false;

  List<AccountInstallment> get _installments =>
      parseInstallments(a).where((i) => !i.cancelled).toList();

  Future<void> _refresh() async {
    try {
      final data = await widget.api.get('/api/admin/accounts/${a['id']}');
      if (mounted && data is Map) {
        setState(() => a = data.cast<String, dynamic>());
      }
    } catch (_) {}
    widget.onChanged();
  }

  Future<void> _payment() async {
    // Ortak tahsilat sayfası (web CollectionDialog paritesi): kalan borçla dolan tutar,
    // çoklu yöntem kırılımı (nakit+kart), yerel tarih ve dekont alanı.
    final saved = await showCollectionSheet(
      context,
      api: widget.api,
      accounts: [a],
      initialAccountId: '${a['id']}',
      lockAccount: true,
      title: 'Tahsilat kaydet',
    );
    if (saved == null || saved == 0) return;
    await _refresh();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(saved > 1
              ? '$saved tahsilat kaydedildi.'
              : 'Tahsilat kaydedildi.')));
    }
  }

  Future<void> _reschedule() async {
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: 'Taksit planını güncelle',
        icon: Icons.event_repeat_rounded,
        initial: a,
        fields: const [
          CrudField(
              key: 'installmentCount',
              label: 'Taksit sayısı',
              type: CrudFieldType.number,
              required: true),
          CrudField(
              key: 'firstDueDate',
              label: 'İlk vade',
              type: CrudFieldType.date,
              defaultValue: 'today',
              required: true),
        ],
      ),
    );
    if (result?.body == null) return;
    try {
      await widget.api.patch(
          '/api/admin/accounts/${a['id']}/reschedule', result!.body!);
      await _refresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Taksit planı güncellendi.')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    // Web AccountDetailModal ile aynı sekmeler: Özet · Taksit Planı · Ekstre · Seans & Sadakat.
    final ledger = _ledger();
    final tabs = [
      ('Özet', Icons.account_balance_wallet_rounded),
      ('Taksit Planı', Icons.event_repeat_rounded),
      ('Ekstre · ${ledger.length}', Icons.receipt_long_rounded),
      ('Seans & Sadakat', Icons.auto_awesome_rounded),
    ];
    return ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.88,
      ),
      child: Padding(
        padding: EdgeInsets.fromLTRB(
            20, 18, 20, MediaQuery.viewInsetsOf(context).bottom + 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(valueOf(a, const ['customerName', 'name']),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context)
                    .textTheme
                    .titleLarge
                    ?.copyWith(fontWeight: FontWeight.w800)),
            Text(valueOf(a, const ['name'], fallback: ''),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: AppColors.muted)),
            const SizedBox(height: 14),
            Row(
              children: [
                _stat('Toplam',
                    CalendarText.tl((a['totalAmount'] as num?)?.toDouble())),
                _stat('Ödenen',
                    CalendarText.tl((a['paidAmount'] as num?)?.toDouble())),
                _stat('Kalan',
                    CalendarText.tl((a['remainingAmount'] as num?)?.toDouble())),
              ],
            ),
            const SizedBox(height: 12),
            // Sekme şeridi
            SizedBox(
              height: 34,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: tabs.length,
                separatorBuilder: (_, _) => const SizedBox(width: 6),
                itemBuilder: (context, i) {
                  final on = _detailTab == i;
                  return Material(
                    color: on ? AppColors.primary : AppColors.surfaceSoft,
                    borderRadius: BorderRadius.circular(999),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(999),
                      onTap: () {
                        setState(() => _detailTab = i);
                        if (i == 3) _loadExtras();
                      },
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 8),
                        child: Row(
                          children: [
                            Icon(tabs[i].$2,
                                size: 14,
                                color:
                                    on ? Colors.white : AppColors.primaryDark),
                            const SizedBox(width: 5),
                            Text(
                              tabs[i].$1,
                              style: TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w800,
                                color:
                                    on ? Colors.white : AppColors.primaryDark,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 12),
            Flexible(
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (_detailTab == 0) ..._summaryTab(),
                    if (_detailTab == 1) ..._planTab(),
                    if (_detailTab == 2) ..._ledgerTab(ledger),
                    if (_detailTab == 3) ..._extrasTab(),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            // ---- Alt bar: aksiyonlar her sekmede görünür ----
            // İptal edilmiş satışa tahsilat girilemez. ASIL KAPI SUNUCUDA (409 döner);
            // buradaki gizleme yalnız kullanıcıyı boş yere uğraştırmamak için.
            if ('${a['saleStatus']}' == 'Cancelled')
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.danger.withValues(alpha: .07),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Text(
                  'Satış iptal edildiği için tahsilat alınamaz. '
                  'Yanlışlıkla iptal edildiyse önce "İptali geri al" yapın.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 11.5, color: AppColors.danger),
                ),
              )
            else ...[
              // TEK BUTON: tahsilat sayfası taksitli hesapta planı, devri ve
              // "bu ay ödenmesi gereken" tutarı kendisi getirir (web paritesi).
              FilledButton.icon(
                onPressed: _payment,
                icon: const Icon(Icons.payments_rounded),
                label: const Text('Tahsilat al'),
              ),
            ],
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _reschedule,
                    icon: const Icon(Icons.event_repeat_rounded, size: 18),
                    label: const Text('Planı güncelle'),
                  ),
                ),
              ],
            ),
            // "Cariyi sil" KALDIRILDI: yalnız cariyi soft-delete ediyordu — tahsilat
            // arşivlenmiyor, iade işlenmiyor, paket seansları kullanılabilir kalıyor ve satış
            // raporlardan düşerken ödeme geçmişi ortada kalıyordu. Backend'de DELETE ucu da yok.
            const Padding(
              padding: EdgeInsets.only(top: 10),
              child: Text(
                'Satışı sonlandırmak için cari satırındaki "Satışlar" düğmesinden '
                '"Satışı iptal et"i kullanın — iade ve seans iadesi orada doğru işlenir.',
                style: TextStyle(fontSize: 11.5, color: AppColors.muted),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ---------------- sekme gövdeleri ----------------

  List<Widget> _summaryTab() {
    final paid = _installments.where((i) => i.isPaid).length;
    final next = _installments.where((i) => !i.isPaid).toList()
      ..sort((x, y) => x.dueDate.compareTo(y.dueDate));
    final notes = valueOf(a, const ['notes'], fallback: '');
    return [
      _infoRow('Satış', _short('${a['soldAtUtc'] ?? a['createdAtUtc']}')),
      if (_installments.isNotEmpty)
        _infoRow('Taksit', '$paid/${_installments.length} ödendi'),
      if (next.isNotEmpty)
        _infoRow('Sıradaki vade',
            '${shortDay(next.first.dueDate)} · ${CalendarText.tl(next.first.remaining)}'),
      _infoRow('Satan',
          valueOf(a, const ['soldByStaffName'], fallback: 'Belirtilmemiş')),
      _infoRow('Durum',
          '${a['saleStatus']}' == 'Cancelled' ? 'İptal edildi' : 'Aktif'),
      if (notes.isNotEmpty) ...[
        const SizedBox(height: 10),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(11),
          decoration: BoxDecoration(
            color: AppColors.surfaceSoft,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(notes,
              style: const TextStyle(fontSize: 12, color: AppColors.muted)),
        ),
      ],
    ];
  }

  List<Widget> _planTab() {
    if (_installments.isEmpty) {
      return [_detailEmpty('Bu cari peşin — taksit planı yok.')];
    }
    return [
      Row(
        children: [
          const Text('Taksit planı',
              style: TextStyle(fontWeight: FontWeight.w800)),
          const Spacer(),
          Text(
            '${_installments.where((i) => i.isPaid).length}/${_installments.length} ödendi',
            style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
          ),
        ],
      ),
      const SizedBox(height: 8),
      for (final i in _installments)
        Container(
          margin: const EdgeInsets.only(bottom: 6),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: i.isPaid
                ? AppColors.success.withValues(alpha: .07)
                : i.overdue
                    ? AppColors.danger.withValues(alpha: .07)
                    : AppColors.surface,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              Text('#${i.no}',
                  style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: AppColors.muted)),
              const SizedBox(width: 8),
              Expanded(
                child: Text(shortDay(i.dueDate),
                    style: const TextStyle(fontSize: 12.5)),
              ),
              Text(CalendarText.tl(i.amount),
                  style: const TextStyle(
                      fontSize: 13, fontWeight: FontWeight.w800)),
              const SizedBox(width: 6),
              Text(
                i.isPaid
                    ? 'ÖDENDİ'
                    : i.overdue
                        ? 'GECİKTİ'
                        : i.isPartial
                            ? 'KISMİ'
                            : 'BEKLİYOR',
                style: TextStyle(
                  fontSize: 9,
                  fontWeight: FontWeight.w800,
                  color: i.isPaid
                      ? AppColors.success
                      : i.overdue
                          ? AppColors.danger
                          : AppColors.warning,
                ),
              ),
            ],
          ),
        ),
    ];
  }

  List<Widget> _ledgerTab(List<_LedgerRow> rows) {
    if (rows.isEmpty) return [_detailEmpty('Hareket yok.')];
    return [
      for (final r in rows)
        Padding(
          padding: const EdgeInsets.only(bottom: 7),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: r.credit > 0
                      ? const Color(0xFFE6F7EE)
                      : const Color(0xFFF6DFE6),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  r.label,
                  style: TextStyle(
                    fontSize: 9.5,
                    fontWeight: FontWeight.w800,
                    color: r.credit > 0
                        ? const Color(0xFF2F7D54)
                        : const Color(0xFFC0405F),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(r.detail,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12)),
                    Text(r.date,
                        style: const TextStyle(
                            fontSize: 10, color: AppColors.muted)),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    '${r.credit > 0 ? '+' : ''}${CalendarText.tl(r.credit > 0 ? r.credit : r.debit)}',
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w800,
                      color: r.credit > 0
                          ? const Color(0xFF2F7D54)
                          : AppColors.ink,
                    ),
                  ),
                  Text('bakiye ${CalendarText.tl(r.balance)}',
                      style: const TextStyle(
                          fontSize: 10, color: AppColors.muted)),
                ],
              ),
            ],
          ),
        ),
    ];
  }

  List<Widget> _extrasTab() {
    if (_extrasLoading) {
      return const [
        Padding(
          padding: EdgeInsets.symmetric(vertical: 24),
          child: Center(child: CircularProgressIndicator()),
        ),
      ];
    }
    final points = (_loyalty['balance'] as num?)?.toInt() ??
        (_loyalty['points'] as num?)?.toInt() ??
        0;
    final consentCustomerId = '${a['customerId'] ?? ''}'.trim();
    return [
      // Cari kartında onam uyarısı: imzasız işlem borçlandırılmış olabilir.
      if (consentCustomerId.isNotEmpty)
        ConsentWarningBanner(
          api: widget.api,
          customerId: consentCustomerId,
          customerName: '${a['customerName'] ?? a['name'] ?? ''}'.trim().isEmpty
              ? null
              : '${a['customerName'] ?? a['name']}',
        ),
      Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xFFFFF3DC), Color(0xFFFFE6BD)],
          ),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.card_giftcard_rounded,
                    size: 20, color: Color(0xFFA3701F)),
                const SizedBox(width: 9),
                const Expanded(
                  child: Text('Sadakat puanı',
                      style: TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 12.5,
                          color: Color(0xFF7A5413))),
                ),
                Text('$points',
                    style: const TextStyle(
                        fontWeight: FontWeight.w900,
                        fontSize: 18,
                        color: Color(0xFFA3701F))),
              ],
            ),
            // PUAN YÖNETİMİ (web LoyaltyCard paritesi): mobilde yalnız görüntüleme vardı.
            if (!(widget.api.auth?.user?.isStaff ?? false)) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _adjustLoyalty(a, add: true, balance: points),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.success,
                        side: BorderSide(color: AppColors.success.withValues(alpha: .4)),
                        visualDensity: VisualDensity.compact,
                      ),
                      icon: const Icon(Icons.add_rounded, size: 15),
                      label: const Text('Puan ekle', style: TextStyle(fontSize: 11.5)),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: points <= 0
                          ? null
                          : () => _adjustLoyalty(a, add: false, balance: points),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.danger,
                        side: BorderSide(color: AppColors.danger.withValues(alpha: .4)),
                        visualDensity: VisualDensity.compact,
                      ),
                      icon: const Icon(Icons.remove_rounded, size: 15),
                      label: const Text('Puan kullan', style: TextStyle(fontSize: 11.5)),
                    ),
                  ),
                ],
              ),
            ],
            // Son puan hareketleri — nereden kazanıldığı/harcandığı görünür.
            if (_loyaltyHistory.isNotEmpty) ...[
              const SizedBox(height: 10),
              for (final h in _loyaltyHistory.take(5))
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          valueOf(h, const ['description', 'sourceType'], fallback: 'Puan hareketi'),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 11, color: Color(0xFF7A5413)),
                        ),
                      ),
                      Builder(builder: (_) {
                        final p = numberOf(h, const ['points']).toInt();
                        return Text(
                          p >= 0 ? '+$p' : '$p',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                            color: p >= 0 ? AppColors.success : AppColors.danger,
                          ),
                        );
                      }),
                    ],
                  ),
                ),
            ],
          ],
        ),
      ),
      const SizedBox(height: 12),
      const Text('Kalan seanslar',
          style: TextStyle(fontWeight: FontWeight.w800)),
      const SizedBox(height: 8),
      if (_sessions.isEmpty)
        _detailEmpty('Bu müşteride paket seansı görünmüyor.')
      else
        for (final s in _sessions)
          Container(
            margin: const EdgeInsets.only(bottom: 6),
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.border),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    valueOf(s, const ['serviceName', 'packageName'],
                        fallback: 'Hizmet'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontWeight: FontWeight.w700, fontSize: 12.5),
                  ),
                ),
                Text(
                  '${numberOf(s, const ['remainingSessions']).toInt()}'
                  ' / ${numberOf(s, const ['totalSessions']).toInt()}',
                  style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      fontSize: 12.5,
                      color: AppColors.primaryDark),
                ),
              ],
            ),
          ),
    ];
  }

  Widget _infoRow(String label, String value) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          children: [
            Text(label,
                style: const TextStyle(fontSize: 12, color: AppColors.muted)),
            const Spacer(),
            Flexible(
              child: Text(value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.right,
                  style: const TextStyle(
                      fontSize: 12.5, fontWeight: FontWeight.w700)),
            ),
          ],
        ),
      );

  Widget _detailEmpty(String text) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 22, horizontal: 12),
        decoration: BoxDecoration(
          color: AppColors.surfaceSoft,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(text,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12, color: AppColors.muted)),
      );

  /// Hesap ekstresi: satış borcu + tahsilatlar, tarihe göre yürüyen bakiyeyle.
  List<_LedgerRow> _ledger() {
    final rows = <_LedgerRow>[];
    final total = (a['totalAmount'] as num?)?.toDouble() ?? 0;
    final soldRaw = a['soldAtUtc'] ?? a['createdAtUtc'];
    final sold = parseUtcToLocal(soldRaw) ?? DateTime.now();
    if (total > 0) {
      rows.add(_LedgerRow(
        at: sold,
        date: _short('$soldRaw'),
        label: 'Satış',
        detail: valueOf(a, const ['name'], fallback: 'Cari açılışı'),
        debit: total,
        credit: 0,
      ));
    }
    for (final p in (a['payments'] as List? ?? const [])) {
      if (p is! Map) continue;
      final m = p.cast<String, dynamic>();
      final at = parseUtcToLocal(m['occurredAtUtc']) ?? sold;
      rows.add(_LedgerRow(
        at: at,
        date: _short('${m['occurredAtUtc']}'),
        label: 'Tahsilat',
        detail: _methodOf('${m['method']}'),
        debit: 0,
        credit: (m['amount'] as num?)?.toDouble() ?? 0,
      ));
    }
    rows.sort((x, y) => x.at.compareTo(y.at));
    var balance = 0.0;
    for (final r in rows) {
      balance += r.debit - r.credit;
      r.balance = balance;
    }
    return rows;
  }

  /// Seans & Sadakat sekmesi ilk açılışta yüklenir.
  Future<void> _loadExtras({bool force = false}) async {
    if ((_extrasLoaded && !force) || _extrasLoading) return;
    final customerId = '${a['customerId'] ?? ''}';
    if (customerId.isEmpty || customerId == 'null') {
      setState(() => _extrasLoaded = true);
      return;
    }
    setState(() => _extrasLoading = true);
    final results = await Future.wait([
      widget.api
          .get('/api/admin/accounts/sessions/$customerId')
          .catchError((_) => const <dynamic>[]),
      widget.api
          .get('/api/admin/loyalty/$customerId')
          .catchError((_) => const <String, dynamic>{}),
    ]);
    if (!mounted) return;
    setState(() {
      _sessions = apiItems(results[0]);
      _loyalty = results[1] is Map
          ? (results[1] as Map).cast<String, dynamic>()
          : const <String, dynamic>{};
      _extrasLoading = false;
      _extrasLoaded = true;
    });
  }

  /// Sadakat puan geçmişi (bakiye yanıtının içinde gelir).
  List<Map<String, dynamic>> get _loyaltyHistory {
    final raw = _loyalty['history'];
    if (raw is! List) return const [];
    return raw.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList();
  }

  /// Manuel puan ekleme/kullanma (web LoyaltyCard paritesi). Açıklama zorunlu değil ama
  /// önerilir: puan neden değişti sorusunun cevabı hareket listesinde görünsün.
  Future<void> _adjustLoyalty(
    Map<String, dynamic> account, {
    required bool add,
    required int balance,
  }) async {
    final customerId = '${account['customerId'] ?? ''}';
    if (customerId.isEmpty || customerId == 'null') return;

    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: add ? 'Puan ekle' : 'Puan kullan',
        icon: add ? Icons.add_circle_rounded : Icons.remove_circle_rounded,
        fields: [
          CrudField(
            key: 'points',
            label: add ? 'Eklenecek puan' : 'Kullanılacak puan (bakiye $balance)',
            type: CrudFieldType.number,
            required: true,
            defaultValue: '50',
          ),
          const CrudField(
              key: 'description', label: 'Açıklama', type: CrudFieldType.multiline),
        ],
      ),
    );
    if (result?.body == null) return;

    final raw = numberOf(result!.body!, const ['points']).toInt().abs();
    if (raw <= 0) return;
    if (!add && raw > balance) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Bakiye yetersiz — kullanılabilir $balance puan.')));
      }
      return;
    }

    try {
      await widget.api.post('/api/admin/loyalty/adjust', {
        'customerId': customerId,
        'points': add ? raw : -raw,
        'description': result.body!['description'],
      });
      await _loadExtras(force: true);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(add ? '$raw puan eklendi.' : '$raw puan kullanıldı.')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Widget _stat(String label, String value) => Expanded(
        child: Column(
          children: [
            Text(label,
                style: const TextStyle(fontSize: 11, color: AppColors.muted)),
            const SizedBox(height: 2),
            Text(value,
                style: const TextStyle(
                    fontWeight: FontWeight.w800, fontSize: 14)),
          ],
        ),
      );

  /// Tahsilat yöntemi ORTAK çeviriciden gelir: buradaki tablo enum adlarıyla (`Cash`) tam
  /// eşleşme arıyordu, tahsilatlar ise web'in yazdığı küçük harfli kodu (`cash`) taşır —
  /// cari ekstresinde ham "cash" yazısı görünüyordu.
  String _methodOf(String key) => paymentMethodLabel(key);
  String _short(String iso) {
    final d = DateTime.tryParse(iso)?.toLocal();
    return d == null ? '' : '${d.day}.${d.month}.${d.year}';
  }
}
