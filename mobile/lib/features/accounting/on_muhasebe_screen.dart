import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/responsive.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/crud/crud_options.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import '../../shared/widgets/period_selector.dart';
import '../../shared/widgets/status_badge.dart';
import '../appointments/calendar_theme.dart';

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
const _paymentMethods = [
  CrudOption('Cash', 'Nakit'),
  CrudOption('Card', 'Kart'),
  CrudOption('BankTransfer', 'Havale/EFT'),
  CrudOption('Check', 'Çek'),
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
  String _accountFilter = 'all'; // all/upcoming/overdue
  late Future<_AccData> _future;

  DateTime get _rangeStart => _period.localRange().start;
  DateTime get _rangeEnd => _period.localRange().end;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_AccData> _load() async {
    final results = await Future.wait([
      widget.api
          .get('/api/admin/accounts/', query: {'page': 1, 'pageSize': 500})
          .catchError((_) => const <dynamic>[]),
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
    return _AccData(
      accounts: apiItems(results[0]),
      expenses: apiItems(results[1]),
      adisyonlar: apiItems(results[2]),
      staff: apiItems(results[3]),
    );
  }

  void _reload() => setState(() { _future = _load(); });

  bool _inMonth(dynamic iso) {
    final d = DateTime.tryParse('$iso')?.toLocal();
    if (d == null) return false;
    return !d.isBefore(_rangeStart) && d.isBefore(_rangeEnd);
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
      ['Bu ay gider', expenseTotal, const Color(0xFFD34D68), Icons.trending_down_rounded],
      ['Net', income - expenseTotal, AppColors.primaryDark, Icons.account_balance_wallet_rounded],
      ['Toplam alacak', receivables, const Color(0xFFB5772A), Icons.request_quote_rounded],
      ['Açık adisyon', openNet, const Color(0xFF2F5FA6), Icons.receipt_long_rounded],
      ['Personel maaş yükü', salaryTotal, const Color(0xFF8E3F5B), Icons.groups_rounded],
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
  Widget _adisyonList(_AccData data) {
    final filtered = data.adisyonlar.where((a) {
      if (_adisyonFilter == 'all') return true;
      return '${a['status']}' == _adisyonFilter;
    }).toList();
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 110),
      children: [
        _filterChips(
          {'all': 'Tümü', 'Open': 'Açık', 'Approved': 'Onaylı', 'Cancelled': 'İptal'},
          _adisyonFilter,
          (v) => setState(() => _adisyonFilter = v),
        ),
        const SizedBox(height: 10),
        if (filtered.isEmpty) _empty('Adisyon yok.'),
        for (final a in filtered)
          _rowCard(
            title: valueOf(a, const ['customerName'], fallback: 'Müşteri'),
            subtitle:
                'Borç ${CalendarText.tl((a['chargeTotal'] as num?)?.toDouble())} · Tahsilat ${CalendarText.tl((a['paymentTotal'] as num?)?.toDouble())}',
            trailing: CalendarText.tl(
                ((a['chargeTotal'] as num?)?.toDouble() ?? 0) -
                    ((a['paymentTotal'] as num?)?.toDouble() ?? 0)),
            status: '${a['status']}',
            onTap: () => _openCustomerDetail(a),
          ),
      ],
    );
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
            optionsLoader: CrudOptions(widget.api).customers,
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
      }),
      'Adisyon açıldı.',
    );
  }

  // ---- Accounts ----
  Widget _accountList(_AccData data) {
    bool isOverdue(Map<String, dynamic> a) {
      final remaining = (a['remainingAmount'] as num?)?.toDouble() ?? 0;
      if (remaining <= 0) return false;
      for (final inst in (a['installments'] as List? ?? const [])) {
        if (inst is Map && '${inst['status']}'.toLowerCase() == 'overdue') {
          return true;
        }
      }
      return false;
    }

    final filtered = data.accounts.where((a) {
      final remaining = (a['remainingAmount'] as num?)?.toDouble() ?? 0;
      if (_accountFilter == 'upcoming') return remaining > 0;
      if (_accountFilter == 'overdue') return isOverdue(a);
      return true;
    }).toList();
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 110),
      children: [
        _filterChips(
          {'all': 'Tümü', 'upcoming': 'Bakiyeli', 'overdue': 'Geciken'},
          _accountFilter,
          (v) => setState(() => _accountFilter = v),
        ),
        const SizedBox(height: 10),
        if (filtered.isEmpty) _empty('Cari hesap yok.'),
        for (final a in filtered)
          _rowCard(
            title: valueOf(a, const ['customerName', 'name'], fallback: 'Hesap'),
            subtitle:
                '${valueOf(a, const ['name'], fallback: '')} · Ödenen ${CalendarText.tl((a['paidAmount'] as num?)?.toDouble())}',
            trailing:
                'Kalan ${CalendarText.tl((a['remainingAmount'] as num?)?.toDouble())}',
            status: (a['remainingAmount'] as num? ?? 0) > 0 ? 'Bakiyeli' : 'Kapandı',
            onTap: () => _openCustomerDetail(a),
          ),
      ],
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
            optionsLoader: CrudOptions(widget.api).customers,
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
              await _guard(
                  () => widget.api.delete('/api/admin/expenses/${e['id']}'),
                  'Gider silindi.');
              return false;
            },
            child: _rowCard(
              title: valueOf(e, const ['description', 'category'], fallback: 'Gider'),
              subtitle:
                  '${_catLabel('${e['category']}')} · ${_methodLabel('${e['paymentMethod']}')} · ${valueOf(e, const ['staffName'], fallback: '')}',
              trailing: CalendarText.tl((e['amount'] as num?)?.toDouble()),
              status: null,
            ),
          ),
      ],
    );
  }

  Future<void> _createExpense({required bool salary}) async {
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: salary ? 'Maaş öde' : 'Yeni gider',
        icon: salary ? Icons.groups_rounded : Icons.receipt_long_rounded,
        fields: [
          if (!salary)
            const CrudField(
              key: 'category',
              label: 'Kategori',
              type: CrudFieldType.select,
              options: _expenseCategories,
              defaultValue: 'Other',
            ),
          const CrudField(
              key: 'amount',
              label: 'Tutar',
              type: CrudFieldType.decimal,
              required: true),
          const CrudField(
            key: 'paymentMethod',
            label: 'Ödeme yöntemi',
            type: CrudFieldType.select,
            options: _paymentMethods,
            defaultValue: 'Cash',
          ),
          const CrudField(
            key: 'occurredAtUtc',
            label: 'Tarih',
            type: CrudFieldType.date,
            dateOnly: false,
            defaultValue: 'today',
            required: true,
          ),
          CrudField(
            key: 'staffMemberId',
            label: salary ? 'Personel' : 'Personel (opsiyonel)',
            type: CrudFieldType.select,
            required: salary,
            optionsLoader: CrudOptions(widget.api).staff,
          ),
          const CrudField(
              key: 'description',
              label: 'Açıklama',
              type: CrudFieldType.multiline),
        ],
      ),
    );
    if (result?.body == null) return;
    final body = {
      ...result!.body!,
      'category': salary ? 'Salary' : result.body!['category'],
      'branchId': widget.api.auth?.user?.branchId,
    };
    await _guard(() => widget.api.post('/api/admin/expenses/', body),
        salary ? 'Maaş ödemesi eklendi.' : 'Gider eklendi.');
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

  Widget _rowCard({
    required String title,
    required String subtitle,
    required String trailing,
    String? status,
    VoidCallback? onTap,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w800)),
                    const SizedBox(height: 3),
                    Text(subtitle,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 12, color: AppColors.muted)),
                    if (status != null) ...[
                      const SizedBox(height: 6),
                      StatusBadge(status),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Text(trailing,
                  style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      color: AppColors.primaryDark,
                      fontSize: 13)),
            ],
          ),
        ),
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
  String _methodLabel(String key) =>
      _paymentMethods.firstWhere((c) => c.value == key,
          orElse: () => CrudOption(key, key)).label;
}

class _AccData {
  _AccData({
    required this.accounts,
    required this.expenses,
    required this.adisyonlar,
    required this.staff,
  });
  final List<Map<String, dynamic>> accounts;
  final List<Map<String, dynamic>> expenses;
  final List<Map<String, dynamic>> adisyonlar;
  final List<Map<String, dynamic>> staff;
}

// ---------------------------------------------------------------------------
// Cari hesap detayı: tahsilat geçmişi + tahsilat kaydet + yeniden planla + sil
// ---------------------------------------------------------------------------
/// Cari hesap detay alt-sayfası — tahsilat/yeniden planla/sil.
/// Ön Muhasebe ve Müşteri Detayı (Adisyon sekmesi) tarafından paylaşılır.
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
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => const CrudFormSheet(
        title: 'Tahsilat kaydet',
        icon: Icons.payments_rounded,
        fields: [
          CrudField(
              key: 'amount',
              label: 'Tutar',
              type: CrudFieldType.decimal,
              required: true),
          CrudField(
            key: 'method',
            label: 'Ödeme yöntemi',
            type: CrudFieldType.select,
            options: _paymentMethods,
            defaultValue: 'Cash',
          ),
          CrudField(key: 'reference', label: 'Referans'),
          CrudField(
            key: 'occurredAtUtc',
            label: 'Tarih',
            type: CrudFieldType.date,
            dateOnly: false,
            defaultValue: 'today',
          ),
        ],
      ),
    );
    if (result?.body == null) return;
    try {
      await widget.api
          .post('/api/admin/accounts/${a['id']}/payments', result!.body!);
      await _refresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Tahsilat kaydedildi.')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
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

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Onay'),
        content: const Text('Cari hesabı silmek istediğinize emin misiniz?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Vazgeç')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Sil')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await widget.api.delete('/api/admin/accounts/${a['id']}');
      if (mounted) Navigator.pop(context);
      widget.onChanged();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final payments = (a['payments'] as List? ?? const []);
    return Padding(
      padding: EdgeInsets.fromLTRB(
          20, 18, 20, MediaQuery.viewInsetsOf(context).bottom + 20),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(valueOf(a, const ['customerName', 'name']),
                style: Theme.of(context)
                    .textTheme
                    .titleLarge
                    ?.copyWith(fontWeight: FontWeight.w800)),
            Text(valueOf(a, const ['name'], fallback: ''),
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
            const SizedBox(height: 16),
            const Text('Tahsilat geçmişi',
                style: TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            if (payments.isEmpty)
              const Text('Henüz tahsilat yok.',
                  style: TextStyle(color: AppColors.muted)),
            for (final p in payments)
              if (p is Map)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '${_methodOf('${p['method']}')} · ${_short('${p['occurredAtUtc']}')}',
                        style: const TextStyle(fontSize: 13),
                      ),
                      Text(CalendarText.tl((p['amount'] as num?)?.toDouble()),
                          style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              color: Color(0xFF2A7A50))),
                    ],
                  ),
                ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _payment,
              icon: const Icon(Icons.payments_rounded),
              label: const Text('Tahsilat kaydet'),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _reschedule,
              icon: const Icon(Icons.event_repeat_rounded),
              label: const Text('Taksit planını güncelle'),
            ),
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: _delete,
              style: TextButton.styleFrom(foregroundColor: Colors.red),
              icon: const Icon(Icons.delete_outline_rounded),
              label: const Text('Cari hesabı sil'),
            ),
          ],
        ),
      ),
    );
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

  String _methodOf(String key) => _paymentMethods
      .firstWhere((c) => c.value == key, orElse: () => CrudOption(key, key))
      .label;
  String _short(String iso) {
    final d = DateTime.tryParse(iso)?.toLocal();
    return d == null ? '' : '${d.day}.${d.month}.${d.year}';
  }
}
