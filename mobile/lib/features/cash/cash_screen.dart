import 'package:flutter/material.dart';

import '../../core/auth/permissions.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import '../../shared/widgets/period_selector.dart';
import '../appointments/calendar_theme.dart';

const _methodLabels = {
  'cash': 'Nakit',
  'card': 'Kart',
  'transfer': 'Havale/EFT',
  'Cash': 'Nakit',
  'Card': 'Kart',
  'BankTransfer': 'Havale/EFT',
  'Check': 'Çek',
};

const _paymentMethods = [
  CrudOption('Cash', 'Nakit'),
  CrudOption('Card', 'Kart'),
  CrudOption('BankTransfer', 'Havale/EFT'),
];

const _expenseCats = [
  CrudOption('Rent', 'Kira'),
  CrudOption('Utilities', 'Faturalar'),
  CrudOption('Supplies', 'Sarf Malzeme'),
  CrudOption('Salary', 'Maaş'),
  CrudOption('Marketing', 'Pazarlama'),
  CrudOption('Other', 'Diğer'),
];

/// Günlük Kasa — web "kasa" sayfasının özellik karşılığı: gün/ay nakit akışı,
/// gelir/gider/net + yöntem dağılımı, hareket listesi, tahsilat ve gider ekleme.
class CashScreen extends StatefulWidget {
  const CashScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<CashScreen> createState() => _CashScreenState();
}

class _CashScreenState extends State<CashScreen> {
  PeriodValue _period = PeriodValue.today();
  late Future<_CashData> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_CashData> _load() async {
    final range = _period.localRange();
    final q = {
      'fromUtc': range.start.toUtc().toIso8601String(),
      'toUtc': range.end.toUtc().toIso8601String(),
    };
    final results = await Future.wait([
      widget.api
          .get('/api/admin/cash-flow/', query: q)
          .catchError((_) => const <dynamic>[]),
      widget.api
          .get('/api/admin/cash-flow/summary', query: q)
          .catchError((_) => <String, dynamic>{}),
    ]);
    return _CashData(
      entries: apiItems(results[0]),
      summary: results[1] is Map
          ? (results[1] as Map).cast<String, dynamic>()
          : const {},
    );
  }

  void _reload() => setState(() { _future = _load(); });

  Future<void> _guard(Future<void> Function() task, String ok) async {
    try {
      await task();
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(ok)));
      }
      _reload();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _addExpense() async {
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: 'Gider ekle',
        icon: Icons.south_west_rounded,
        fields: [
          const CrudField(
            key: 'category',
            label: 'Kategori',
            type: CrudFieldType.select,
            options: _expenseCats,
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
          const CrudField(
              key: 'description',
              label: 'Açıklama',
              type: CrudFieldType.multiline),
        ],
      ),
    );
    if (result?.body == null) return;
    final body = {...result!.body!, 'branchId': widget.api.auth?.user?.branchId};
    await _guard(
        () => widget.api.post('/api/admin/expenses/', body), 'Gider eklendi.');
  }

  Future<void> _addPayment() async {
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: 'Tahsilat al',
        icon: Icons.north_east_rounded,
        fields: [
          CrudField(
            key: 'accountId',
            label: 'Cari hesap',
            type: CrudFieldType.select,
            required: true,
            optionsLoader: () async {
              final data = await widget.api
                  .get('/api/admin/accounts/', query: {'page': 1, 'pageSize': 500});
              return apiItems(data)
                  .map((a) => CrudOption(
                      a['id'],
                      valueOf(a, const ['customerName', 'name'])))
                  .toList();
            },
          ),
          const CrudField(
              key: 'amount',
              label: 'Tutar',
              type: CrudFieldType.decimal,
              required: true),
          const CrudField(
            key: 'method',
            label: 'Ödeme yöntemi',
            type: CrudFieldType.select,
            options: _paymentMethods,
            defaultValue: 'Cash',
          ),
          const CrudField(key: 'reference', label: 'Referans'),
        ],
      ),
    );
    if (result?.body == null) return;
    final accountId = result!.body!['accountId'];
    final body = {
      'amount': result.body!['amount'],
      'method': result.body!['method'],
      'reference': result.body!['reference'],
      'occurredAtUtc': null,
    };
    await _guard(
        () => widget.api.post('/api/admin/accounts/$accountId/payments', body),
        'Tahsilat kaydedildi.');
  }

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        floatingActionButton: !(widget.api.auth?.user?.canAction(Perm.cashRegisterEntry) ?? true)
            ? null
            : Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            FloatingActionButton.small(
              heroTag: 'pay',
              onPressed: _addPayment,
              backgroundColor: const Color(0xFF2A7A50),
              child: const Icon(Icons.north_east_rounded),
            ),
            const SizedBox(height: 10),
            FloatingActionButton.extended(
              heroTag: 'exp',
              onPressed: _addExpense,
              icon: const Icon(Icons.south_west_rounded),
              label: const Text('Gider'),
            ),
          ],
        ),
        body: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: () async => _reload(),
            child: FutureBuilder<_CashData>(
              future: _future,
              builder: (context, snapshot) {
                return ListView(
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 120),
                  children: [
                    PageHeader(
                      eyebrow: 'Finans',
                      title: 'Kasa',
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
                    const SizedBox(height: 12),
                    if (snapshot.connectionState != ConnectionState.done)
                      const Padding(
                        padding: EdgeInsets.all(40),
                        child: Center(child: CircularProgressIndicator()),
                      )
                    else if (snapshot.hasError)
                      Center(child: Text('${snapshot.error}'))
                    else ...[
                      _summary(snapshot.data!),
                      const SizedBox(height: 14),
                      _entries(snapshot.data!),
                    ],
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _summary(_CashData data) {
    final income = (data.summary['totalIncome'] as num?)?.toDouble() ?? 0;
    final expense = (data.summary['totalExpense'] as num?)?.toDouble() ?? 0;
    final net = (data.summary['netAmount'] as num?)?.toDouble() ?? income - expense;
    final byMethod = (data.summary['byMethod'] as List? ?? const []);
    return Column(
      children: [
        Row(
          children: [
            _card('Gelir', income, const Color(0xFF2A7A50),
                Icons.trending_up_rounded),
            _card('Gider', expense, const Color(0xFFD34D68),
                Icons.trending_down_rounded),
            _card('Net', net, AppColors.primaryDark,
                Icons.account_balance_wallet_rounded),
          ],
        ),
        if (byMethod.isNotEmpty) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              children: [
                for (final m in byMethod)
                  if (m is Map)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(_methodLabels['${m['method']}'] ?? '${m['method']}',
                              style:
                                  const TextStyle(fontWeight: FontWeight.w700)),
                          Text(
                            '+${CalendarText.tl((m['incomeAmount'] as num?)?.toDouble())}  -${CalendarText.tl((m['expenseAmount'] as num?)?.toDouble())}',
                            style: const TextStyle(
                                fontSize: 12, color: AppColors.muted),
                          ),
                        ],
                      ),
                    ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _card(String label, double value, Color color, IconData icon) {
    return Expanded(
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 3),
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 6),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          children: [
            Icon(icon, color: color, size: 19),
            const SizedBox(height: 4),
            Text(CalendarText.tl(value),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontWeight: FontWeight.w800, fontSize: 14, color: color)),
            const SizedBox(height: 2),
            Text(label,
                style: const TextStyle(fontSize: 11, color: AppColors.muted)),
          ],
        ),
      ),
    );
  }

  Widget _entries(_CashData data) {
    if (data.entries.isEmpty) {
      return const Padding(
        padding: EdgeInsets.all(30),
        child: Center(
            child: Text('Bu dönemde hareket yok.',
                style: TextStyle(color: AppColors.muted))),
      );
    }
    return Column(
      children: [
        for (final e in data.entries)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(13),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.border),
            ),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: ('${e['type']}'.toLowerCase() == 'income'
                            ? const Color(0xFF2A7A50)
                            : const Color(0xFFD34D68))
                        .withValues(alpha: .12),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    '${e['type']}'.toLowerCase() == 'income'
                        ? Icons.north_east_rounded
                        : Icons.south_west_rounded,
                    color: '${e['type']}'.toLowerCase() == 'income'
                        ? const Color(0xFF2A7A50)
                        : const Color(0xFFD34D68),
                    size: 19,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        valueOf(e, const ['description', 'customerName', 'category'],
                            fallback: 'Hareket'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      Text(
                        '${_methodLabels['${e['method']}'] ?? valueOf(e, const ['method'], fallback: '')} · ${_short('${e['occurredAtUtc']}')}',
                        style: const TextStyle(
                            fontSize: 12, color: AppColors.muted),
                      ),
                    ],
                  ),
                ),
                Text(
                  '${'${e['type']}'.toLowerCase() == 'income' ? '+' : '-'}${CalendarText.tl((e['amount'] as num?)?.toDouble())}',
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    color: '${e['type']}'.toLowerCase() == 'income'
                        ? const Color(0xFF2A7A50)
                        : const Color(0xFFD34D68),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  String _short(String iso) {
    final d = DateTime.tryParse(iso)?.toLocal();
    return d == null
        ? ''
        : '${d.day}.${d.month} ${CalendarText.hm(d)}';
  }
}

class _CashData {
  _CashData({required this.entries, required this.summary});
  final List<Map<String, dynamic>> entries;
  final Map<String, dynamic> summary;
}
