import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme/responsive.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import '../../shared/widgets/period_selector.dart';
import '../appointments/calendar_theme.dart';

/// Kâr raporu — aylık gelir/gider/net + hizmet kârlılığı (prim düşülmüş).
/// Web ProfitReportCard'ın mobil karşılığı; veri sunucuda hesaplanır.
class _ProfitSection extends StatefulWidget {
  const _ProfitSection({required this.api});
  final ApiClient api;

  @override
  State<_ProfitSection> createState() => _ProfitSectionState();
}

class _ProfitSectionState extends State<_ProfitSection> {
  Map<String, dynamic>? _data;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    widget.api
        .get('/api/admin/cash-flow/profit-report', query: {'months': 6})
        .then((res) {
      if (mounted) {
        setState(() {
          _data = res is Map ? res.cast<String, dynamic>() : null;
          _loading = false;
        });
      }
    }).catchError((_) {
      if (mounted) setState(() => _loading = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const SizedBox(
          height: 90, child: Center(child: CircularProgressIndicator()));
    }
    final d = _data;
    if (d == null) {
      return const Text('Kâr raporu yüklenemedi.',
          style: TextStyle(fontSize: 12, color: AppColors.muted));
    }
    final months = (d['months'] as List? ?? const []).whereType<Map>().toList();
    final services =
        (d['services'] as List? ?? const []).whereType<Map>().take(6).toList();
    final money = NumberFormat.compactCurrency(
        locale: 'tr_TR', symbol: '₺', decimalDigits: 0);
    double maxAbs = 1;
    for (final m in months) {
      final inc = (m['income'] as num?)?.toDouble().abs() ?? 0;
      final exp = (m['expense'] as num?)?.toDouble().abs() ?? 0;
      if (inc > maxAbs) maxAbs = inc;
      if (exp > maxAbs) maxAbs = exp;
    }
    String label(String key) {
      final p = key.split('-');
      if (p.length != 2) return key;
      const names = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
      final mi = (int.tryParse(p[1]) ?? 1) - 1;
      return '${names[mi.clamp(0, 11)]} ${p[0].substring(2)}';
    }

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                    child: Text('Net: ${money.format((d['totalNet'] as num?) ?? 0)}',
                        style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w800,
                            color: ((d['totalNet'] as num?) ?? 0) >= 0
                                ? AppColors.success
                                : AppColors.danger))),
                Text(
                    'Gelir ${money.format((d['totalIncome'] as num?) ?? 0)} · Gider ${money.format((d['totalExpense'] as num?) ?? 0)}',
                    style: const TextStyle(
                        fontSize: 10.5, color: AppColors.muted)),
              ],
            ),
            const SizedBox(height: 12),
            for (final m in months)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    SizedBox(
                        width: 52,
                        child: Text(label('${m['month'] ?? ''}'),
                            style: const TextStyle(
                                fontSize: 11, fontWeight: FontWeight.w700))),
                    Expanded(
                      child: Column(
                        children: [
                          _bar(((m['income'] as num?)?.toDouble() ?? 0) / maxAbs,
                              AppColors.success),
                          const SizedBox(height: 3),
                          _bar(((m['expense'] as num?)?.toDouble() ?? 0) / maxAbs,
                              AppColors.danger),
                        ],
                      ),
                    ),
                    SizedBox(
                      width: 74,
                      child: Text(money.format((m['net'] as num?) ?? 0),
                          textAlign: TextAlign.right,
                          style: TextStyle(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w800,
                              color: ((m['net'] as num?) ?? 0) >= 0
                                  ? AppColors.success
                                  : AppColors.danger)),
                    ),
                  ],
                ),
              ),
            if (services.isNotEmpty) ...[
              const Divider(height: 20),
              const Text('Hizmet Kârlılığı (prim düşülmüş)',
                  style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w800,
                      color: AppColors.muted)),
              const SizedBox(height: 8),
              for (final s in services)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    children: [
                      Expanded(
                          child: Text('${s['serviceName'] ?? ''}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontSize: 12, fontWeight: FontWeight.w600))),
                      Text('${s['completedCount'] ?? 0} seans · ',
                          style: const TextStyle(
                              fontSize: 10.5, color: AppColors.muted)),
                      Text(money.format((s['net'] as num?) ?? 0),
                          style: const TextStyle(
                              fontSize: 12, fontWeight: FontWeight.w800,
                              color: AppColors.success)),
                    ],
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _bar(double pct, Color color) => ClipRRect(
        borderRadius: BorderRadius.circular(99),
        child: SizedBox(
          height: 5,
          child: LinearProgressIndicator(
            value: pct.clamp(0, 1),
            backgroundColor: color.withValues(alpha: .10),
            valueColor: AlwaysStoppedAnimation(color.withValues(alpha: .75)),
          ),
        ),
      );
}

/// Raporlar — web `raporlar` sayfasının mobil karşılığı.
///
/// 4 rapor türü (scope): Finans Özet · Müşteri Analitiği · Personel Performansı
/// · Hizmet Doluluk. Dönem seçici (gün/hafta/ay/özel) tüm scope'ları besler.
/// (Web'deki prev-dönem delta'ları ve Excel/PDF çıktısı mobilde yok — analitik
/// "fonksiyonel eşdeğer".)
class ReportsScreen extends StatefulWidget {
  const ReportsScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

enum _Scope { finance, customer, staff, services }

const _scopeMeta = <_Scope, (String, IconData)>{
  _Scope.finance: ('Finans', Icons.account_balance_wallet_rounded),
  _Scope.customer: ('Müşteri', Icons.groups_rounded),
  _Scope.staff: ('Personel', Icons.badge_rounded),
  _Scope.services: ('Hizmet', Icons.content_cut_rounded),
};

const _donutColors = [
  Color(0xFFC85776), Color(0xFF7C5CBF), Color(0xFF2FAE8E),
  Color(0xFFE8932F), Color(0xFF4A9FE0), Color(0xFFD65A8E),
];

const _methodLabels = <String, String>{
  'cash': 'Nakit', 'Cash': 'Nakit',
  'card': 'Kart', 'Card': 'Kart', 'CreditCard': 'Kredi Kartı',
  'transfer': 'Havale/EFT', 'Transfer': 'Havale/EFT', 'BankTransfer': 'Havale/EFT',
  'check': 'Çek', 'Check': 'Çek',
};

String _methodLabel(String raw) => _methodLabels[raw] ?? (raw.isEmpty ? 'Diğer' : raw);

class _ReportsScreenState extends State<ReportsScreen> {
  _Scope _scope = _Scope.finance;
  PeriodValue _period = PeriodValue.today();
  late Future<_RepData> _future = _load();

  Future<_RepData> _load() async {
    final range = _period.localRange();
    final from = range.start.toUtc().toIso8601String();
    final to = range.end.toUtc().toIso8601String();
    final results = await Future.wait<dynamic>([
      widget.api
          .get('/api/admin/cash-flow/summary',
              query: {'fromUtc': from, 'toUtc': to})
          .catchError((_) => const <String, dynamic>{}),
      widget.api
          .get('/api/admin/cash-flow/', query: {'fromUtc': from, 'toUtc': to})
          .catchError((_) => const <dynamic>[]),
      widget.api
          .get('/api/admin/appointments/',
              query: {'page': 1, 'pageSize': 1000, 'fromUtc': from, 'toUtc': to})
          .catchError((_) => const <dynamic>[]),
      widget.api
          .getAllPaged('/api/admin/customers/')
          .catchError((_) => const <String, dynamic>{'items': <dynamic>[]}),
      widget.api
          .get('/api/admin/staff/', query: {'page': 1, 'pageSize': 200})
          .catchError((_) => const <dynamic>[]),
      widget.api
          .get('/api/admin/services/', query: {'page': 1, 'pageSize': 200})
          .catchError((_) => const <dynamic>[]),
    ]);
    final summary = results[0] is Map
        ? (results[0] as Map).cast<String, dynamic>()
        : <String, dynamic>{};
    return _RepData(
      summary: summary,
      cashFlow: apiItems(results[1]),
      appts: apiItems(results[2]),
      customers: apiItems(results[3]),
      staff: apiItems(results[4]),
      services: apiItems(results[5]),
    );
  }

  void _reload() => setState(() => _future = _load());
  void _onPeriod(PeriodValue v) => setState(() {
        _period = v;
        _future = _load();
      });

  @override
  Widget build(BuildContext context) => AppBackground(
        child: Scaffold(
          backgroundColor: Colors.transparent,
          body: SafeArea(
            child: RefreshIndicator(
              color: AppColors.primary,
              onRefresh: () async {
                _reload();
                await _future;
              },
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 20, 16, 110),
                children: [
                  PageHeader(
                    eyebrow: 'Analitik',
                    title: 'Raporlar',
                    subtitle: _scopeMeta[_scope]!.$1,
                  ),
                  const SizedBox(height: 14),
                  _scopeTabs(),
                  const SizedBox(height: 14),
                  PeriodSelector(value: _period, onChanged: _onPeriod),
                  const SizedBox(height: 16),
                  FutureBuilder<_RepData>(
                    future: _future,
                    builder: (context, snap) {
                      if (!snap.hasData && !snap.hasError) {
                        return const SizedBox(
                            height: 220,
                            child: Center(child: CircularProgressIndicator()));
                      }
                      if (snap.hasError) {
                        return _errorBox('${snap.error}');
                      }
                      final d = snap.data!;
                      return switch (_scope) {
                        _Scope.finance => _financeView(d),
                        _Scope.customer => _customerView(d),
                        _Scope.staff => _staffView(d),
                        _Scope.services => _servicesView(d),
                      };
                    },
                  ),
                ],
              ),
            ),
          ),
        ),
      );

  Widget _scopeTabs() {
    return SizedBox(
      height: 38,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: _Scope.values.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (_, i) {
          final scope = _Scope.values[i];
          final (label, icon) = _scopeMeta[scope]!;
          final selected = _scope == scope;
          return GestureDetector(
            onTap: () => setState(() => _scope = scope),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 14),
              decoration: BoxDecoration(
                color: selected ? AppColors.primary : AppColors.surface,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                    color: selected ? AppColors.primary : AppColors.border),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon,
                      size: 15,
                      color: selected ? Colors.white : AppColors.muted),
                  const SizedBox(width: 6),
                  Text(label,
                      style: TextStyle(
                          color: selected ? Colors.white : AppColors.muted,
                          fontSize: 13,
                          fontWeight: FontWeight.w700)),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  // ===================== FİNANS =====================
  Widget _financeView(_RepData d) {
    final income = _num(d.summary['totalIncome']);
    final expense = _num(d.summary['totalExpense']);
    final net = _num(d.summary['netAmount']);
    final incomeCount = _num(d.summary['incomeCount']).toInt();
    final expenseCount = _num(d.summary['expenseCount']).toInt();
    final avgBasket = incomeCount > 0 ? income / incomeCount : 0;
    final distinctActive = d.appts
        .map((a) => '${a['customerId']}')
        .where((id) => id.isNotEmpty && id != 'null')
        .toSet()
        .length;
    final perCustomer = distinctActive > 0 ? income / distinctActive : 0;

    // İşlem özeti (yeni/tekrarlayan)
    final visits = <String, int>{};
    for (final a in d.appts) {
      final id = '${a['customerId']}';
      if (id.isEmpty || id == 'null') continue;
      visits[id] = (visits[id] ?? 0) + 1;
    }
    final neu = visits.values.where((v) => v <= 1).length;
    final returning = visits.values.where((v) => v > 1).length;
    final cancelled = _count(d.appts, 'Cancelled');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _grid([
          _kpi('Toplam Gelir', _money(income), Icons.trending_up_rounded,
              AppColors.success, '$incomeCount tahsilat'),
          _kpi('Toplam Gider', _money(expense), Icons.trending_down_rounded,
              AppColors.danger, '$expenseCount gider'),
          _kpi('Net Kâr', _money(net), Icons.account_balance_wallet_rounded,
              net >= 0 ? AppColors.primaryDark : AppColors.danger,
              net >= 0 ? 'kârda' : 'zararda'),
          _kpi('Ort. Sepet', _money(avgBasket), Icons.shopping_cart_rounded,
              const Color(0xFF9A6F22), 'işlem başına'),
        ]),
        const SizedBox(height: 10),
        _wideKpi('Müşteri Başına Ciro', _money(perCustomer), Icons.groups_rounded,
            AppColors.primary, '$distinctActive aktif müşteri'),
        const SizedBox(height: 20),
        _sectionTitle('Kâr Raporu (Son 6 Ay)'),
        const SizedBox(height: 10),
        _ProfitSection(api: widget.api),
        const SizedBox(height: 20),
        _sectionTitle('Ödeme Yöntemi Dağılımı'),
        const SizedBox(height: 10),
        _paymentBreakdown(d.summary['byMethod']),
        const SizedBox(height: 20),
        _sectionTitle('İşlem Özeti'),
        const SizedBox(height: 10),
        _grid([
          _kpi('Toplam İşlem', '${d.appts.length}', Icons.receipt_long_rounded,
              AppColors.primary, null),
          _kpi('Yeni Müşteri', '$neu', Icons.person_add_rounded,
              AppColors.success, null),
          _kpi('Tekrarlayan', '$returning', Icons.repeat_rounded,
              const Color(0xFF9A6F22), null),
          _kpi('İptal / İade', '$cancelled', Icons.replay_rounded,
              AppColors.danger, null),
        ]),
        const SizedBox(height: 20),
        _sectionTitle('Randevu Durumları'),
        const SizedBox(height: 10),
        _grid([
          _kpi('Tamamlanan', '${_count(d.appts, 'Completed')}',
              Icons.check_circle_rounded, AppColors.success, null),
          _kpi('Yaklaşan',
              '${_count(d.appts, 'Scheduled') + _count(d.appts, 'Confirmed')}',
              Icons.schedule_rounded, AppColors.primary, null),
          _kpi('İptal', '$cancelled', Icons.cancel_rounded, AppColors.danger, null),
          _kpi('Gelmedi', '${_count(d.appts, 'NoShow')}',
              Icons.person_off_rounded, AppColors.warning, null),
        ]),
        const SizedBox(height: 20),
        _sectionTitle('Son İşlemler'),
        const SizedBox(height: 10),
        _recentTx(d.cashFlow),
      ],
    );
  }

  Widget _paymentBreakdown(dynamic byMethodRaw) {
    final list = (byMethodRaw is List)
        ? byMethodRaw
            .whereType<Map>()
            .map((e) => e.cast<String, dynamic>())
            .where((m) => _num(m['incomeAmount']) > 0)
            .toList()
        : <Map<String, dynamic>>[];
    list.sort((a, b) =>
        _num(b['incomeAmount']).compareTo(_num(a['incomeAmount'])));
    if (list.isEmpty) return _emptyCard('Bu dönemde tahsilat yok.');
    final total = list.fold<num>(0, (s, m) => s + _num(m['incomeAmount']));
    return _card(
      child: Column(
        children: [
          for (var i = 0; i < list.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _methodRow(list[i], total, _donutColors[i % _donutColors.length]),
            ),
        ],
      ),
    );
  }

  Widget _methodRow(Map<String, dynamic> m, num total, Color color) {
    final amount = _num(m['incomeAmount']);
    final pct = total > 0 ? (amount / total * 100).round() : 0;
    final count = _num(m['count']).toInt();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                    color: color, borderRadius: BorderRadius.circular(3))),
            const SizedBox(width: 7),
            Expanded(
              child: Text(_methodLabel('${m['method']}'),
                  style: const TextStyle(fontSize: 13, color: AppColors.ink)),
            ),
            Text('$count işlem',
                style: const TextStyle(fontSize: 10, color: AppColors.muted)),
            const SizedBox(width: 8),
            Text(CalendarText.tl(amount),
                style: const TextStyle(
                    fontSize: 13, fontWeight: FontWeight.w800, color: AppColors.ink)),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
              decoration: BoxDecoration(
                  color: color.withValues(alpha: .12),
                  borderRadius: BorderRadius.circular(6)),
              child: Text('%$pct',
                  style: TextStyle(
                      fontSize: 10, fontWeight: FontWeight.w700, color: color)),
            ),
          ],
        ),
        const SizedBox(height: 5),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: pct / 100,
            minHeight: 5,
            backgroundColor: AppColors.surfaceSoft,
            color: color,
          ),
        ),
      ],
    );
  }

  Widget _recentTx(List<Map<String, dynamic>> cashFlow) {
    final income = cashFlow
        .where((e) => '${e['type']}'.toLowerCase() == 'income' || e['type'] == 0)
        .toList()
      ..sort((a, b) =>
          '${b['occurredAtUtc'] ?? ''}'.compareTo('${a['occurredAtUtc'] ?? ''}'));
    final recent = income.take(6).toList();
    if (recent.isEmpty) return _emptyCard('Bu dönemde tahsilat yok.');
    return _card(
      child: Column(
        children: [
          for (final e in recent) _txRow(e),
        ],
      ),
    );
  }

  Widget _txRow(Map<String, dynamic> e) {
    final when = parseUtcToLocal(e['occurredAtUtc']);
    final amount = _num(e['amount']);
    final desc = valueOf(e, const ['description', 'category'], fallback: 'Tahsilat');
    final customer = '${e['customerName'] ?? ''}'.trim();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: const BoxDecoration(
                color: AppColors.success, shape: BoxShape.circle),
          ),
          const SizedBox(width: 8),
          if (when != null)
            Text(DateFormat('d MMM HH:mm', 'tr_TR').format(when),
                style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
          const SizedBox(width: 8),
          Expanded(
            child: Text(customer.isEmpty ? desc : '$desc · $customer',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 12.5, color: AppColors.ink)),
          ),
          Text('+${CalendarText.tl(amount)}',
              style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.success)),
        ],
      ),
    );
  }

  // ===================== MÜŞTERİ =====================
  Widget _customerView(_RepData d) {
    final visits = <String, int>{};
    for (final a in d.appts) {
      final id = '${a['customerId']}';
      if (id.isEmpty || id == 'null') continue;
      visits[id] = (visits[id] ?? 0) + 1;
    }
    final top = d.customers
        .map((c) => (c, visits['${c['id']}'] ?? 0))
        .where((e) => e.$2 > 0)
        .toList()
      ..sort((a, b) => b.$2.compareTo(a.$2));
    final topList = top.take(15).toList();
    final kvkkApproved =
        d.customers.where((c) => c['kvkkConsent'] == true).length;
    final total = d.customers.length;
    final ratio = total > 0 ? (kvkkApproved / total * 100).round() : 0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _grid([
          _kpi('Toplam Müşteri', '$total', Icons.groups_rounded,
              AppColors.primary, null),
          _kpi('Bu Dönem Aktif', '${visits.length}', Icons.person_pin_rounded,
              AppColors.success, null),
          _kpi('KVKK Onaylı', '$kvkkApproved', Icons.verified_user_rounded,
              AppColors.success, '%$ratio'),
          _kpi('KVKK Bekleyen', '${total - kvkkApproved}',
              Icons.privacy_tip_rounded, AppColors.warning, null),
        ]),
        const SizedBox(height: 20),
        _sectionTitle('En Sık Gelen Müşteriler'),
        const SizedBox(height: 10),
        if (topList.isEmpty)
          _emptyCard('Bu dönemde müşteri ziyareti yok.')
        else
          _card(
            child: Column(
              children: [
                for (var i = 0; i < topList.length; i++)
                  _rankRow(
                    i + 1,
                    valueOf(topList[i].$1, const ['fullName', 'name'],
                        fallback: 'Müşteri'),
                    '${topList[i].$1['phone'] ?? ''}',
                    '${topList[i].$2}',
                    'randevu',
                  ),
              ],
            ),
          ),
      ],
    );
  }

  // ===================== PERSONEL =====================
  Widget _staffView(_RepData d) {
    final stats = d.staff.map((s) {
      final id = '${s['id']}';
      final own = d.appts.where((a) => '${a['staffMemberId']}' == id).toList();
      final completed =
          own.where((a) => '${a['status']}' == 'Completed').toList();
      final revenue = completed.fold<num>(0, (sum, a) => sum + _num(a['price']));
      final rate = _num(s['commissionRate']);
      final commission = rate > 0 ? (revenue * rate / 100) : 0;
      final util =
          own.isNotEmpty ? (completed.length / own.length * 100).round() : 0;
      return _StaffStat(
        name: valueOf(s, const ['fullName', 'name'], fallback: 'Personel'),
        role: '${s['role'] ?? s['title'] ?? ''}',
        appts: own.length,
        completed: completed.length,
        revenue: revenue,
        commission: commission,
        util: util,
      );
    }).toList()
      ..sort((a, b) => b.revenue.compareTo(a.revenue));

    if (stats.every((s) => s.appts == 0)) {
      return _emptyCard('Bu dönemde personel randevusu yok.');
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionTitle('Personel Performansı'),
        const SizedBox(height: 10),
        for (var i = 0; i < stats.length; i++) _staffRow(i + 1, stats[i]),
      ],
    );
  }

  Widget _staffRow(int rank, _StaffStat s) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          Row(
            children: [
              _rankBadge(rank),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(s.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontWeight: FontWeight.w800, fontSize: 14)),
                    if (s.role.isNotEmpty && s.role != 'null')
                      Text(s.role,
                          style: const TextStyle(
                              fontSize: 11, color: AppColors.primaryDark)),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(CalendarText.tl(s.revenue),
                      style: const TextStyle(
                          fontWeight: FontWeight.w800, fontSize: 14)),
                  Text('+${CalendarText.tl(s.commission)} komisyon',
                      style: const TextStyle(
                          fontSize: 10, color: AppColors.success)),
                ],
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Text('${s.completed}/${s.appts} tamamlandı',
                  style: const TextStyle(fontSize: 11, color: AppColors.muted)),
              const Spacer(),
              Text('%${s.util} doluluk',
                  style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: AppColors.success)),
            ],
          ),
          const SizedBox(height: 5),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: s.util / 100,
              minHeight: 6,
              backgroundColor: AppColors.surfaceSoft,
              color: AppColors.success,
            ),
          ),
        ],
      ),
    );
  }

  // ===================== HİZMET =====================
  Widget _servicesView(_RepData d) {
    final stats = d.services.map((s) {
      final id = '${s['id']}';
      final own =
          d.appts.where((a) => '${a['serviceDefinitionId']}' == id).toList();
      final completed = own.where((a) => '${a['status']}' == 'Completed');
      final revenue = completed.fold<num>(0, (sum, a) => sum + _num(a['price']));
      return _ServiceStat(
        name: valueOf(s, const ['name'], fallback: 'Hizmet'),
        category: '${s['category'] ?? ''}',
        bookings: own.length,
        completed: completed.length,
        revenue: revenue,
      );
    }).toList()
      ..sort((a, b) => b.bookings.compareTo(a.bookings));

    final active = stats.where((s) => s.bookings > 0).toList();
    if (active.isEmpty) {
      return _emptyCard('Bu dönemde hizmet randevusu yok.');
    }
    final maxBookings =
        active.fold<int>(1, (m, s) => s.bookings > m ? s.bookings : m);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionTitle('Hizmet Doluluk & Ciro'),
        const SizedBox(height: 10),
        _card(
          child: Column(
            children: [
              for (var i = 0; i < active.length; i++)
                Padding(
                  padding: EdgeInsets.only(bottom: i == active.length - 1 ? 0 : 12),
                  child: _serviceRow(active[i], maxBookings),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _serviceRow(_ServiceStat s, int maxBookings) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(s.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontWeight: FontWeight.w700, fontSize: 13.5)),
            ),
            Text('${s.bookings} randevu',
                style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primaryDark)),
            const SizedBox(width: 8),
            Text(CalendarText.tl(s.revenue),
                style: const TextStyle(
                    fontSize: 12.5, fontWeight: FontWeight.w800)),
          ],
        ),
        const SizedBox(height: 5),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: s.bookings / maxBookings,
            minHeight: 6,
            backgroundColor: AppColors.surfaceSoft,
            color: AppColors.primary,
          ),
        ),
        const SizedBox(height: 3),
        Text('${s.completed} tamamlandı',
            style: const TextStyle(fontSize: 10, color: AppColors.muted)),
      ],
    );
  }

  // ===================== Ortak parçalar =====================

  Widget _grid(List<Widget> cards) => AdaptiveStatGrid(
        phoneCols: 2,
        height: 114,
        children: cards,
      );

  Widget _kpi(String label, String value, IconData icon, Color color,
      String? sub) {
    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Container(
            width: 32,
            height: 32,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: color.withValues(alpha: .12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 17, color: color),
          ),
          Text(value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  fontSize: 19, fontWeight: FontWeight.w800, color: AppColors.ink)),
          Row(
            children: [
              Flexible(
                child: Text(label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 11, color: AppColors.muted)),
              ),
              if (sub != null) ...[
                const SizedBox(width: 4),
                Flexible(
                  child: Text(sub,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontSize: 9.5,
                          fontWeight: FontWeight.w700,
                          color: color)),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }

  Widget _wideKpi(String label, String value, IconData icon, Color color,
      String sub) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: color.withValues(alpha: .12),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, size: 20, color: color),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: const TextStyle(fontSize: 11, color: AppColors.muted)),
                Text(sub,
                    style: TextStyle(
                        fontSize: 10, fontWeight: FontWeight.w600, color: color)),
              ],
            ),
          ),
          Text(value,
              style: const TextStyle(
                  fontSize: 20, fontWeight: FontWeight.w900, color: AppColors.ink)),
        ],
      ),
    );
  }

  Widget _rankRow(int rank, String name, String sub, String value, String unit) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          _rankBadge(rank),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontWeight: FontWeight.w700, fontSize: 13.5)),
                if (sub.trim().isNotEmpty && sub != 'null')
                  Text(sub,
                      style: const TextStyle(
                          fontSize: 10.5, color: AppColors.muted)),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(value,
                  style: const TextStyle(
                      fontSize: 17, fontWeight: FontWeight.w900)),
              Text(unit,
                  style: const TextStyle(fontSize: 9, color: AppColors.muted)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _rankBadge(int rank) => Container(
        width: 28,
        height: 28,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: rank <= 3
              ? AppColors.primary.withValues(alpha: .14)
              : AppColors.surfaceSoft,
          shape: BoxShape.circle,
          border: Border.all(color: AppColors.border),
        ),
        child: Text('$rank',
            style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w800,
                color: rank <= 3 ? AppColors.primaryDark : AppColors.muted)),
      );

  Widget _sectionTitle(String t) => Text(t,
      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800));

  Widget _card({required Widget child}) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: AppColors.border),
        ),
        child: child,
      );

  Widget _emptyCard(String text) => _card(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 14),
          child: Center(
            child: Text(text,
                style: const TextStyle(color: AppColors.muted, fontSize: 13)),
          ),
        ),
      );

  Widget _errorBox(String msg) => _card(
        child: Column(
          children: [
            const Icon(Icons.cloud_off_rounded,
                size: 36, color: AppColors.primary),
            const SizedBox(height: 10),
            Text(msg, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _reload,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Tekrar dene'),
            ),
          ],
        ),
      );

  int _count(List<Map<String, dynamic>> appts, String status) =>
      appts.where((a) => '${a['status']}' == status).length;

  static num _num(dynamic v) => v is num ? v : num.tryParse('$v') ?? 0;

  static String _money(num v) => NumberFormat.compactCurrency(
          locale: 'tr_TR', symbol: '₺', decimalDigits: 0)
      .format(v);
}

class _RepData {
  const _RepData({
    required this.summary,
    required this.cashFlow,
    required this.appts,
    required this.customers,
    required this.staff,
    required this.services,
  });
  final Map<String, dynamic> summary;
  final List<Map<String, dynamic>> cashFlow;
  final List<Map<String, dynamic>> appts;
  final List<Map<String, dynamic>> customers;
  final List<Map<String, dynamic>> staff;
  final List<Map<String, dynamic>> services;
}

class _StaffStat {
  const _StaffStat({
    required this.name,
    required this.role,
    required this.appts,
    required this.completed,
    required this.revenue,
    required this.commission,
    required this.util,
  });
  final String name;
  final String role;
  final int appts;
  final int completed;
  final num revenue;
  final num commission;
  final int util;
}

class _ServiceStat {
  const _ServiceStat({
    required this.name,
    required this.category,
    required this.bookings,
    required this.completed,
    required this.revenue,
  });
  final String name;
  final String category;
  final int bookings;
  final int completed;
  final num revenue;
}
