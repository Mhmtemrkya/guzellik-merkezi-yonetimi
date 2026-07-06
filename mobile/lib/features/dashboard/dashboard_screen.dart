import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/theme/responsive.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/network/api_client.dart';
import '../../core/notifications/notification_center.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import '../../shared/widgets/period_selector.dart';
import '../../shared/widgets/status_badge.dart';
import '../notifications/notification_inbox_screen.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({
    required this.api,
    required this.auth,
    required this.notifications,
    super.key,
  });
  final ApiClient api;
  final AuthController auth;
  final NotificationCenter notifications;

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  late Future<_DashboardData> future;

  // Seçili dönem (gün/hafta/ay/özel).
  PeriodValue _period = PeriodValue.today();

  @override
  void initState() {
    super.initState();
    future = load();
  }

  void _onPeriodChanged(PeriodValue v) {
    setState(() {
      _period = v;
      future = load();
    });
  }

  Future<_DashboardData> load() async {
    if (widget.auth.user?.isPlatform == true) {
      final values = await Future.wait([
        widget.api.get(
          '/api/platform/tenants/',
          query: {'page': 1, 'pageSize': 100},
        ),
        widget.api.get('/api/platform/usage'),
        widget.api.get('/api/platform/subscription-plans/'),
      ]);
      return _DashboardData(
        primary: apiItems(values[0]),
        secondary: apiItems(values[2]),
        summary: values[1] is Map
            ? (values[1] as Map).cast<String, dynamic>()
            : const {},
      );
    }
    final range = _period.localRange();
    final from = range.start.toUtc();
    final to = range.end.toUtc();
    final now = DateTime.now();
    // Gelir trendi penceresi: son 6 takvim ayı (dönem seçicisinden bağımsız).
    final trendFrom =
        DateTime(now.year, now.month - 5, 1).toUtc().toIso8601String();
    // Kurum yöneticisi için deneme/abonelik bilgisi (paralel; hata olursa yok sayılır).
    final isOwner = widget.auth.user?.role == 'InstitutionOwner';
    final tenantFuture = isOwner
        ? widget.api
            .get('/api/admin/tenant/')
            .then((v) => v is Map ? v.cast<String, dynamic>() : null)
            .catchError((_) => null)
        : Future<Map<String, dynamic>?>.value(null);
    final values = await Future.wait([
      widget.api.get(
        '/api/admin/appointments/',
        query: {
          'page': 1,
          'pageSize': 200,
          'fromUtc': from.toIso8601String(),
          'toUtc': to.toIso8601String(),
        },
      ),
      widget.api.get(
        '/api/admin/customers/',
        query: {'page': 1, 'pageSize': 200},
      ),
      widget.api.get(
        '/api/admin/cash-flow/summary',
        query: {
          'fromUtc': from.toIso8601String(),
          'toUtc': to.toIso8601String(),
        },
      ),
      widget.api.get(
        '/api/admin/pending-operations/',
        query: {'page': 1, 'pageSize': 20, 'status': 'Pending'},
      ),
      // Web dashboard paritesi: personel, ürün, ön muhasebe raporu, pasif müşteriler.
      // Bir uç yetki/limit ile hata verirse dashboard çökmesin diye boş değere düşülür.
      widget.api
          .get('/api/admin/staff/', query: {'page': 1, 'pageSize': 200})
          .catchError((_) => const <dynamic>[]),
      widget.api
          .get('/api/admin/products/', query: {'page': 1, 'pageSize': 200})
          .catchError((_) => const <dynamic>[]),
      widget.api
          .get('/api/admin/accounts/report', query: {'months': 6})
          .catchError((_) => const <String, dynamic>{}),
      widget.api
          .get('/api/admin/customers/passive')
          .catchError((_) => const <String, dynamic>{}),
      widget.api
          .get('/api/admin/cash-flow/', query: {
            'page': 1,
            'pageSize': 2000,
            'fromUtc': trendFrom,
            'toUtc': now.toUtc().toIso8601String(),
          })
          .catchError((_) => const <dynamic>[]),
    ]);
    final customersPayload = values[1];
    return _DashboardData(
      primary: apiItems(values[0]),
      secondary: apiItems(values[3]),
      customers: apiItems(values[1]),
      customersTotal: customersPayload is Map && customersPayload['total'] is num
          ? (customersPayload['total'] as num).toInt()
          : apiItems(values[1]).length,
      staff: apiItems(values[4]),
      products: apiItems(values[5]),
      report: values[6] is Map
          ? (values[6] as Map).cast<String, dynamic>()
          : const <String, dynamic>{},
      passive: values[7] is Map
          ? (values[7] as Map).cast<String, dynamic>()
          : const <String, dynamic>{},
      cashEntries: apiItems(values[8]),
      summary: {
        'customers': apiItems(values[1]).length,
        ...(values[2] is Map
            ? (values[2] as Map).cast<String, dynamic>()
            : const <String, dynamic>{}),
      },
      tenant: await tenantFuture,
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = widget.auth.user!;
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: RefreshIndicator(
            onRefresh: () async {
              setState(() {
                future = load();
              });
              await future;
            },
            child: FutureBuilder<_DashboardData>(
              future: future,
              builder: (context, snapshot) {
                if (!snapshot.hasData && !snapshot.hasError) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snapshot.hasError) {
                  return ListView(
                    children: [
                      SizedBox(
                        height: MediaQuery.sizeOf(context).height * .7,
                        child: Center(child: Text('${snapshot.error}')),
                      ),
                    ],
                  );
                }
                final data = snapshot.data!;
                return ListView(
                  padding: const EdgeInsets.fromLTRB(18, 22, 18, 110),
                  children: [
                    PageHeader(
                      eyebrow: user.isPlatform ? 'Platform' : 'Özet',
                      title: 'Merhaba, ${user.fullName.split(' ').first}',
                      subtitle: user.isPlatform
                          ? DateFormat('d MMMM yyyy, EEEE', 'tr_TR')
                              .format(DateTime.now())
                          : _period.label(),
                      action: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (!user.isPlatform)
                            NotificationBell(
                              center: widget.notifications,
                              onOpen: () =>
                                  context.push('/notification-inbox'),
                            ),
                          CircleAvatar(
                            backgroundColor: AppColors.rose,
                            child: Text(
                              user.initials,
                              style: const TextStyle(
                                color: AppColors.primaryDark,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (data.tenant != null) ...[
                      const SizedBox(height: 14),
                      _TrialBanner(tenant: data.tenant!),
                    ],
                    if (!user.isPlatform) ...[
                      const SizedBox(height: 14),
                      PeriodSelector(value: _period, onChanged: _onPeriodChanged),
                    ],
                    const SizedBox(height: 20),
                    _MetricGrid(
                      data: data,
                      platform: user.isPlatform,
                      period: _period,
                    ),
                    if (!user.isPlatform) ...[
                      const SizedBox(height: 22),
                      Text(
                        'Hızlı İşlemler',
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w800),
                      ),
                      const SizedBox(height: 10),
                      const _QuickActions(),
                    ],
                    const SizedBox(height: 20),
                    Text(
                      user.isPlatform ? 'Son kurumlar' : 'Randevular',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 10),
                    if (data.primary.isEmpty)
                      _EmptyCard(
                        text: user.isPlatform
                            ? 'Kayıt bulunmuyor.'
                            : 'Seçili aralıkta randevu bulunmuyor.',
                      )
                    else
                      ...data.primary
                          .take(6)
                          .map(
                            (item) => Padding(
                              padding: const EdgeInsets.only(bottom: 10),
                              child: Card(
                                child: ListTile(
                                  contentPadding: const EdgeInsets.symmetric(
                                    horizontal: 14,
                                    vertical: 5,
                                  ),
                                  leading: CircleAvatar(
                                    backgroundColor: AppColors.surfaceSoft,
                                    child: Icon(
                                      user.isPlatform
                                          ? Icons.apartment_rounded
                                          : Icons.calendar_today_rounded,
                                      color: AppColors.primaryDark,
                                      size: 19,
                                    ),
                                  ),
                                  title: Text(
                                    valueOf(
                                      item,
                                      user.isPlatform
                                          ? ['tenantName', 'name']
                                          : ['customerName', 'serviceName'],
                                    ),
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  subtitle: Text(
                                    valueOf(
                                      item,
                                      user.isPlatform
                                          ? ['ownerEmail', 'city', 'plan']
                                          : [
                                              'serviceName',
                                              'staffName',
                                              'startUtc',
                                            ],
                                    ),
                                  ),
                                  trailing: StatusBadge(
                                    valueOf(
                                      item,
                                      user.isPlatform ? ['status'] : ['status'],
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                    if (!user.isPlatform) ...[
                      const SizedBox(height: 22),
                      _RevenueTrendCard(entries: data.cashEntries),
                      const SizedBox(height: 22),
                      _PackageReportCard(report: data.report),
                      const SizedBox(height: 22),
                      _InstallmentChartCard(report: data.report),
                      const SizedBox(height: 22),
                      _StaffPerformanceCard(
                        staff: data.staff,
                        appointments: data.primary,
                      ),
                      const SizedBox(height: 22),
                      _StockAlertsCard(products: data.products),
                      const SizedBox(height: 22),
                      _FollowUpsCard(
                        customers: data.customers,
                        passive: data.passive,
                      ),
                    ],
                    if (data.secondary.isNotEmpty) ...[
                      const SizedBox(height: 22),
                      Text(
                        user.isPlatform
                            ? 'Abonelik planları'
                            : 'Onay bekleyenler',
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w800),
                      ),
                      const SizedBox(height: 10),
                      ...data.secondary
                          .take(4)
                          .map(
                            (item) => Padding(
                              padding: const EdgeInsets.only(bottom: 10),
                              child: Card(
                                child: ListTile(
                                  leading: const Icon(
                                    Icons.auto_awesome_rounded,
                                    color: AppColors.primary,
                                  ),
                                  title: Text(
                                    valueOf(item, ['name', 'title']),
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                  subtitle: Text(
                                    valueOf(item, [
                                      'description',
                                      'summary',
                                      'status',
                                    ]),
                                  ),
                                ),
                              ),
                            ),
                          ),
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
}

class _MetricGrid extends StatelessWidget {
  const _MetricGrid({
    required this.data,
    required this.platform,
    required this.period,
  });
  final _DashboardData data;
  final bool platform;
  final PeriodValue period;

  @override
  Widget build(BuildContext context) {
    // (başlık, değer, ikon, alt-bilgi?)
    final List<(String, String, IconData, String?)> cards;
    if (platform) {
      cards = [
        ('Toplam kurum', '${data.primary.length}', Icons.apartment_rounded, null),
        (
          'Toplam kullanıcı',
          '${data.summary['totalUsers'] ?? data.summary['userCount'] ?? 0}',
          Icons.groups_rounded,
          null,
        ),
        (
          'Aktif kurum',
          '${data.primary.where((e) => '${e['status']}'.toLowerCase() == 'active').length}',
          Icons.verified_rounded,
          null,
        ),
        (
          'Plan sayısı',
          '${data.secondary.length}',
          Icons.workspace_premium_rounded,
          null,
        ),
      ];
    } else {
      var completed = 0;
      var waiting = 0;
      for (final a in data.primary) {
        final key = _statusKey(valueOf(a, const ['status'], fallback: ''));
        if (key == 'tamamlandi') {
          completed++;
        } else if (key == 'bekliyor') {
          waiting++;
        }
      }
      final range = period.localRange();
      var newCustomers = 0;
      for (final c in data.customers) {
        final created = parseUtcToLocal(c['createdAtUtc']);
        if (created != null &&
            !created.isBefore(range.start) &&
            created.isBefore(range.end)) {
          newCustomers++;
        }
      }
      final collected = numberOf(data.report, const ['totalCollected']);
      final receivable = numberOf(data.report, const ['totalReceivable']);
      final base = collected + receivable;
      final rate = base > 0 ? ((collected / base) * 100).round() : 0;
      cards = [
        (
          'Randevu',
          '${data.primary.length}',
          Icons.calendar_today_rounded,
          '$completed tamamlandı · $waiting bekliyor',
        ),
        (
          'Gelir',
          _compactMoney(data.summary['totalIncome'] ?? data.summary['income']),
          Icons.trending_up_rounded,
          null,
        ),
        (
          'Yeni Danışan',
          '$newCustomers',
          Icons.person_add_alt_1_rounded,
          'Toplam ${data.customersTotal}',
        ),
        (
          'Tahsilat',
          '%$rate',
          Icons.pie_chart_rounded,
          'Kalan ${_compactMoney(receivable)}',
        ),
      ];
    }
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: cards.length,
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: gridCols(context, 2),
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        mainAxisExtent: 132,
      ),
      itemBuilder: (context, index) {
        final card = cards[index];
        final subtitle = card.$4;
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(card.$3, color: AppColors.primary, size: 21),
                const Spacer(),
                Text(
                  card.$2,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontWeight: FontWeight.w900,
                    fontSize: 20,
                  ),
                ),
                Text(
                  card.$1,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppColors.muted, fontSize: 11),
                ),
                if (subtitle != null)
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.primaryDark,
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Center(
        child: Text(text, style: const TextStyle(color: AppColors.muted)),
      ),
    ),
  );
}

/// Kurum yöneticisi dashboard'unda deneme/abonelik kalan süre bilgisini gösterir.
/// Web'deki paket sayfası bandıyla aynı mantık (ceil((bitiş - şimdi)/gün)).
class _TrialBanner extends StatelessWidget {
  const _TrialBanner({required this.tenant});
  final Map<String, dynamic> tenant;

  static int? _daysLeft(String? iso) {
    if (iso == null || iso.isEmpty) return null;
    final end = DateTime.tryParse(iso);
    if (end == null) return null;
    return (end.difference(DateTime.now()).inMilliseconds / 86400000).ceil();
  }

  @override
  Widget build(BuildContext context) {
    final status = tenant['status']?.toString();
    final trialEnds = tenant['trialEndsAtUtc']?.toString();
    final subEnds = tenant['subscriptionEndsAtUtc']?.toString();
    final isTrial = status == 'Trial' || (trialEnds != null && tenant['subscriptionPeriod'] == null);

    String title;
    String subtitle;
    IconData icon;
    Color color;

    if (isTrial) {
      final d = _daysLeft(trialEnds);
      icon = Icons.timer_outlined;
      if (d == null) {
        title = 'Deneme süreniz';
        subtitle = 'İlk girişinizle 14 günlük deneme başlar.';
        color = AppColors.primaryDark;
      } else if (d <= 0) {
        title = 'Deneme süreniz doldu';
        subtitle = 'Devam etmek için bir paket seçin.';
        color = AppColors.danger;
      } else {
        title = 'Deneme süreniz: $d gün kaldı';
        subtitle = 'Tüm özellikleri ücretsiz deneyebilirsiniz.';
        color = d <= 3 ? AppColors.danger : (d <= 7 ? AppColors.warning : AppColors.primaryDark);
      }
    } else if (subEnds != null && subEnds.isNotEmpty) {
      final d = _daysLeft(subEnds);
      icon = Icons.workspace_premium_outlined;
      if (d == null) {
        return const SizedBox.shrink();
      } else if (d <= 0) {
        title = 'Aboneliğiniz sona erdi';
        subtitle = 'Kesintisiz devam için yenileyin.';
        color = AppColors.danger;
      } else {
        title = 'Aboneliğiniz: $d gün kaldı';
        subtitle = 'Bitiş: ${_fmtDate(subEnds)}';
        color = d <= 7 ? AppColors.warning : AppColors.success;
      }
    } else {
      // Süresiz/aktif abonelik — banner göstermeye gerek yok.
      return const SizedBox.shrink();
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .10),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: .35)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(fontWeight: FontWeight.w800, color: color, fontSize: 14)),
                const SizedBox(height: 2),
                Text(subtitle, style: const TextStyle(color: AppColors.muted, fontSize: 12.5)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _fmtDate(String iso) {
    final d = DateTime.tryParse(iso)?.toLocal();
    if (d == null) return '-';
    return DateFormat('d MMMM yyyy', 'tr_TR').format(d);
  }
}

class _DashboardData {
  const _DashboardData({
    required this.primary,
    required this.secondary,
    required this.summary,
    this.tenant,
    this.customers = const <Map<String, dynamic>>[],
    this.customersTotal = 0,
    this.staff = const <Map<String, dynamic>>[],
    this.products = const <Map<String, dynamic>>[],
    this.report = const <String, dynamic>{},
    this.passive = const <String, dynamic>{},
    this.cashEntries = const <Map<String, dynamic>>[],
  });
  final List<Map<String, dynamic>> primary;
  final List<Map<String, dynamic>> secondary;
  final Map<String, dynamic> summary;
  /// Kurum yöneticisi için kendi tenant'ı (deneme/abonelik bilgisi). Diğer rollerde null.
  final Map<String, dynamic>? tenant;
  final List<Map<String, dynamic>> customers;
  final int customersTotal;
  final List<Map<String, dynamic>> staff;
  final List<Map<String, dynamic>> products;
  final Map<String, dynamic> report;
  final Map<String, dynamic> passive;
  final List<Map<String, dynamic>> cashEntries;
}

// ----------------------- Web paritesi: yardımcılar -----------------------

String _compactMoney(dynamic value) {
  final amount = value is num ? value : num.tryParse('$value') ?? 0;
  return NumberFormat.compactCurrency(
    locale: 'tr_TR',
    symbol: '₺',
    decimalDigits: 0,
  ).format(amount);
}

/// Web `appointmentStatusKey` ile aynı durum eşlemesi.
String _statusKey(String? status) {
  final key = (status ?? 'Scheduled').toLowerCase();
  if (['draft', 'taslak', 'pendingapproval'].contains(key)) return 'taslak';
  if (['completed', 'tamamlandi', 'tamamlandı'].contains(key)) return 'tamamlandi';
  if (['confirmed', 'inprogress', 'devam', 'arrived'].contains(key)) {
    return 'devam';
  }
  if (['cancelled', 'canceled', 'noshow', 'no_show', 'gelmedi', 'iptal']
      .contains(key)) {
    return 'iptal';
  }
  return 'bekliyor';
}

String _initials(String name) {
  final parts =
      name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '•';
  return parts.take(2).map((p) => p[0].toUpperCase()).join();
}

String _stockText(double v) =>
    v == v.roundToDouble() ? '${v.toInt()}' : v.toStringAsFixed(1);

// ----------------------- Web paritesi: kartlar -----------------------

/// Başlık + içerik taşıyan ortak dashboard kartı (web SectionCard eşdeğeri).
class _DashCard extends StatelessWidget {
  const _DashCard({
    required this.icon,
    required this.title,
    required this.child,
    this.onTap,
  });
  final IconData icon;
  final String title;
  final Widget child;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(22),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 34,
                    height: 34,
                    decoration: BoxDecoration(
                      color: AppColors.surfaceSoft,
                      borderRadius: BorderRadius.circular(11),
                    ),
                    child: Icon(icon, color: AppColors.primaryDark, size: 18),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 14.5,
                      ),
                    ),
                  ),
                  if (onTap != null)
                    const Icon(
                      Icons.chevron_right_rounded,
                      color: AppColors.muted,
                      size: 20,
                    ),
                ],
              ),
              const SizedBox(height: 14),
              child,
            ],
          ),
        ),
      ),
    );
  }
}

/// Dashboard hızlı işlem kısayolları (web 'Hızlı İşlemler').
class _QuickActions extends StatelessWidget {
  const _QuickActions();

  static const _actions = <(String, IconData, String)>[
    ('Yeni Randevu', Icons.event_available_rounded, '/appointments'),
    ('Yeni Danışan', Icons.person_add_alt_1_rounded, '/customers'),
    ('Paket Satışı', Icons.workspaces_rounded, '/packages'),
    ('Ödeme Al', Icons.account_balance_wallet_rounded, '/cash'),
    ('Stok', Icons.inventory_2_rounded, '/stock'),
    ('Kampanya', Icons.campaign_rounded, '/campaigns'),
  ];

  void _go(BuildContext context, String path) {
    if (path == '/appointments' || path == '/customers') {
      context.go(path);
    } else {
      context.push(path);
    }
  }

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: _actions.length,
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: gridCols(context, 3),
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        mainAxisExtent: 120,
      ),
      itemBuilder: (context, index) {
        final (label, icon, path) = _actions[index];
        // Tablette buton hücresi genişler; ikon/yazı da orantılı büyür ki
        // içerik kartın içinde kaybolmasın.
        final tablet = context.isTablet;
        final box = tablet ? 52.0 : 40.0;
        return Card(
          child: InkWell(
            borderRadius: BorderRadius.circular(22),
            onTap: () => _go(context, path),
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    width: box,
                    height: box,
                    decoration: BoxDecoration(
                      color: AppColors.surfaceSoft,
                      borderRadius: BorderRadius.circular(tablet ? 16 : 13),
                    ),
                    child: Icon(icon,
                        color: AppColors.primaryDark, size: tablet ? 27 : 21),
                  ),
                  SizedBox(height: tablet ? 9 : 7),
                  Text(
                    label,
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: tablet ? 13 : 10.5,
                      fontWeight: FontWeight.w700,
                      height: 1.1,
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Paket/ön muhasebe özeti (web 'Paket Raporu' KPI'ları).
class _PackageReportCard extends StatelessWidget {
  const _PackageReportCard({required this.report});
  final Map<String, dynamic> report;

  @override
  Widget build(BuildContext context) {
    final overdue = numberOf(report, const ['overdueAmount']);
    final stats = <(String, String, bool)>[
      (
        'Satılan Paket',
        '${numberOf(report, const ['packageSalesCount']).toInt()}',
        false,
      ),
      (
        'Kalan Seans',
        '${numberOf(report, const ['sessionsRemaining']).toInt()}',
        false,
      ),
      (
        'Kalan Taksit',
        _compactMoney(numberOf(report, const ['totalReceivable'])),
        false,
      ),
      (
        'Tahsil Edilen',
        _compactMoney(numberOf(report, const ['totalCollected'])),
        false,
      ),
      ('Vadesi Geçmiş', _compactMoney(overdue), overdue > 0),
    ];
    return _DashCard(
      icon: Icons.workspaces_rounded,
      title: 'Paket Raporu',
      child: AdaptiveStatGrid(
        phoneCols: 3,
        height: 78,
        spacing: 8,
        children: stats.map((s) {
          final (label, value, danger) = s;
          return Container(
            padding: const EdgeInsets.all(9),
            decoration: BoxDecoration(
              color: AppColors.surfaceSoft,
              borderRadius: BorderRadius.circular(13),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontWeight: FontWeight.w900,
                    fontSize: 14.5,
                    color: danger ? AppColors.danger : AppColors.ink,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.muted,
                    fontSize: 9.5,
                    height: 1.1,
                  ),
                ),
              ],
            ),
          );
        }).toList(),
      ),
    );
  }
}

/// Dönemdeki en yoğun 3 personel (web 'Personel Performansı').
class _StaffPerformanceCard extends StatelessWidget {
  const _StaffPerformanceCard({
    required this.staff,
    required this.appointments,
  });
  final List<Map<String, dynamic>> staff;
  final List<Map<String, dynamic>> appointments;

  @override
  Widget build(BuildContext context) {
    final rows = <(String, int, double)>[];
    for (final s in staff) {
      final id = '${s['id']}';
      final appts =
          appointments.where((a) => '${a['staffMemberId']}' == id).toList();
      final revenue =
          appts.fold<double>(0, (sum, a) => sum + numberOf(a, const ['price']));
      rows.add((valueOf(s, const ['fullName', 'name']), appts.length, revenue));
    }
    rows.sort((a, b) => b.$2.compareTo(a.$2));
    final top = rows.take(3).toList();
    final hasData = top.any((r) => r.$2 > 0);
    return _DashCard(
      icon: Icons.workspace_premium_rounded,
      title: 'Personel Performansı',
      child: !hasData
          ? const Text(
              'Bu dönemde personel randevu verisi yok.',
              style: TextStyle(color: AppColors.muted, fontSize: 12.5),
            )
          : Column(
              children: top.map((r) {
                final (name, count, revenue) = r;
                return Padding(
                  padding: const EdgeInsets.only(bottom: 9),
                  child: Row(
                    children: [
                      CircleAvatar(
                        radius: 15,
                        backgroundColor: AppColors.rose,
                        child: Text(
                          _initials(name),
                          style: const TextStyle(
                            color: AppColors.primaryDark,
                            fontWeight: FontWeight.w900,
                            fontSize: 10.5,
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 13,
                          ),
                        ),
                      ),
                      Text(
                        '$count randevu',
                        style: const TextStyle(
                          color: AppColors.muted,
                          fontSize: 11,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Text(
                        _compactMoney(revenue),
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 12.5,
                        ),
                      ),
                    ],
                  ),
                );
              }).toList(),
            ),
    );
  }
}

/// Kritik/tükenen stok uyarıları (web 'Stok Uyarıları').
class _StockAlertsCard extends StatelessWidget {
  const _StockAlertsCard({required this.products});
  final List<Map<String, dynamic>> products;

  @override
  Widget build(BuildContext context) {
    final critical = products
        .where((p) => p['isOutOfStock'] == true || p['isCritical'] == true)
        .toList();
    return _DashCard(
      icon: Icons.inventory_2_rounded,
      title: 'Stok Uyarıları',
      onTap: () => context.push('/stock'),
      child: critical.isEmpty
          ? const Row(
              children: [
                Icon(
                  Icons.check_circle_rounded,
                  color: AppColors.success,
                  size: 18,
                ),
                SizedBox(width: 8),
                Text(
                  'Kritik stok uyarısı yok.',
                  style: TextStyle(color: AppColors.success, fontSize: 12.5),
                ),
              ],
            )
          : Column(
              children: critical.take(5).map((p) {
                final out = p['isOutOfStock'] == true;
                final unit = valueOf(p, const ['unit'], fallback: '');
                return Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(
                    children: [
                      Icon(
                        Icons.warning_amber_rounded,
                        color: out ? AppColors.danger : AppColors.warning,
                        size: 17,
                      ),
                      const SizedBox(width: 9),
                      Expanded(
                        child: Text(
                          valueOf(p, const ['name']),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontWeight: FontWeight.w600,
                            fontSize: 12.5,
                          ),
                        ),
                      ),
                      Text(
                        out
                            ? 'Tükendi'
                            : '${_stockText(numberOf(p, const ['currentStock']))} $unit kaldı',
                        style: TextStyle(
                          color: out ? AppColors.danger : AppColors.warning,
                          fontWeight: FontWeight.w700,
                          fontSize: 11.5,
                        ),
                      ),
                    ],
                  ),
                );
              }).toList(),
            ),
    );
  }
}

/// Takip gerektiren danışan grupları (web 'Takip Edilmesi Gereken Danışanlar').
class _FollowUpsCard extends StatelessWidget {
  const _FollowUpsCard({required this.customers, required this.passive});
  final List<Map<String, dynamic>> customers;
  final Map<String, dynamic> passive;

  @override
  Widget build(BuildContext context) {
    final passiveItems = apiItems(passive);
    final thresholdDays = numberOf(passive, const ['thresholdDays']).toInt();
    final month = DateTime.now().month;
    var birthday = 0;
    var kvkk = 0;
    var blacklist = 0;
    for (final c in customers) {
      final bd = DateTime.tryParse('${c['birthDate']}');
      if (bd != null && bd.month == month) birthday++;
      if (c['kvkkConsent'] == false) kvkk++;
      if (c['isBlacklisted'] == true) blacklist++;
    }
    final rows = <(String, int, IconData)>[
      (
        thresholdDays > 0
            ? '$thresholdDays+ gündür gelmeyen'
            : 'Uzun süredir gelmeyen',
        passiveItems.length,
        Icons.timelapse_rounded,
      ),
      ('Bu ay doğum günü', birthday, Icons.cake_rounded),
      ('KVKK onayı bekleyen', kvkk, Icons.privacy_tip_outlined),
      ('Kara listedeki', blacklist, Icons.block_rounded),
    ];
    return _DashCard(
      icon: Icons.groups_2_rounded,
      title: 'Takip Edilecek Danışanlar',
      onTap: () => context.go('/customers'),
      child: Column(
        children: rows.map((r) {
          final (label, count, icon) = r;
          return Padding(
            padding: const EdgeInsets.only(bottom: 9),
            child: Row(
              children: [
                Icon(icon, color: AppColors.primaryDark, size: 17),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12.5),
                  ),
                ),
                Text(
                  '$count',
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 13,
                  ),
                ),
                const Text(
                  ' danışan',
                  style: TextStyle(color: AppColors.muted, fontSize: 11),
                ),
              ],
            ),
          );
        }).toList(),
      ),
    );
  }
}

// ----------------------- Web paritesi: grafikler -----------------------

const _monthsShort = [
  'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
  'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara',
];

/// Son 6 ay gelir trendi (web 'Gelir Analizi' sadeleştirilmiş hâli).
class _RevenueTrendCard extends StatelessWidget {
  const _RevenueTrendCard({required this.entries});
  final List<Map<String, dynamic>> entries;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final buckets = <(String, double)>[];
    for (var i = 5; i >= 0; i--) {
      final start = DateTime(now.year, now.month - i, 1);
      final end = DateTime(start.year, start.month + 1, 1);
      var sum = 0.0;
      for (final e in entries) {
        if ('${e['type']}'.toLowerCase() != 'income') continue;
        final d = parseUtcToLocal(e['occurredAtUtc']);
        if (d == null) continue;
        if (!d.isBefore(start) && d.isBefore(end)) {
          sum += numberOf(e, const ['amount']);
        }
      }
      buckets.add((_monthsShort[start.month - 1], sum));
    }
    final maxVal = buckets.fold<double>(0, (mx, b) => b.$2 > mx ? b.$2 : mx);
    final total = buckets.fold<double>(0, (s, b) => s + b.$2);
    return _DashCard(
      icon: Icons.show_chart_rounded,
      title: 'Gelir Analizi',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Son 6 ay toplam tahsilat · ${_compactMoney(total)}',
            style: const TextStyle(color: AppColors.muted, fontSize: 11.5),
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: 110,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: buckets.map((b) {
                final frac = maxVal > 0 ? b.$2 / maxVal : 0.0;
                return Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 5),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          height: 6 + frac * 78,
                          decoration: const BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [Color(0xFFF7B7CD), Color(0xFFEF6F94)],
                            ),
                            borderRadius:
                                BorderRadius.vertical(top: Radius.circular(6)),
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          b.$1,
                          style: const TextStyle(
                            fontSize: 9.5,
                            color: AppColors.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }
}

/// Aylık taksit tahsilat/kalan dağılımı (web 'Aylık Taksit Performansı' sade hâli).
class _InstallmentChartCard extends StatelessWidget {
  const _InstallmentChartCard({required this.report});
  final Map<String, dynamic> report;

  @override
  Widget build(BuildContext context) {
    final raw = report['monthlyInstallments'];
    final months = (raw is List ? raw : const [])
        .whereType<Map>()
        .map((m) => m.cast<String, dynamic>())
        .toList();
    final visible = months.length > 6 ? months.sublist(0, 6) : months;
    final hasAny = visible.any(
      (m) =>
          numberOf(m, const ['due']) > 0 ||
          numberOf(m, const ['collected']) > 0 ||
          numberOf(m, const ['remaining']) > 0,
    );
    if (!hasAny) {
      return const _DashCard(
        icon: Icons.bar_chart_rounded,
        title: 'Aylık Taksit Performansı',
        child: Text(
          'Planlanmış taksit bulunmuyor.',
          style: TextStyle(color: AppColors.muted, fontSize: 12.5),
        ),
      );
    }
    final collectedSum =
        visible.fold<double>(0, (s, m) => s + numberOf(m, const ['collected']));
    final remainingSum =
        visible.fold<double>(0, (s, m) => s + numberOf(m, const ['remaining']));
    final dueSum =
        visible.fold<double>(0, (s, m) => s + numberOf(m, const ['due']));
    final rate = dueSum > 0 ? ((collectedSum / dueSum) * 100).round() : 0;
    final maxTotal = visible.fold<double>(0, (mx, m) {
      final t =
          numberOf(m, const ['collected']) + numberOf(m, const ['remaining']);
      return t > mx ? t : mx;
    });
    return _DashCard(
      icon: Icons.bar_chart_rounded,
      title: 'Aylık Taksit Performansı',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _InstallmentSummary(
                  label: 'Tahsilat', value: _compactMoney(collectedSum)),
              const SizedBox(width: 8),
              _InstallmentSummary(
                  label: 'Kalan', value: _compactMoney(remainingSum)),
              const SizedBox(width: 8),
              _InstallmentSummary(label: 'Oran', value: '%$rate'),
            ],
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: 112,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: visible.map((m) {
                final col = numberOf(m, const ['collected']);
                final rem = numberOf(m, const ['remaining']);
                final total = col + rem;
                final frac = maxTotal > 0 ? total / maxTotal : 0.0;
                final barH = 6 + frac * 76;
                final colH = total > 0 ? (col / total) * barH : 0.0;
                final monthIdx = numberOf(m, const ['month']).toInt();
                return Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        ClipRRect(
                          borderRadius: const BorderRadius.vertical(
                            top: Radius.circular(6),
                          ),
                          child: SizedBox(
                            width: double.infinity,
                            height: barH,
                            child: Column(
                              children: [
                                Container(
                                  height: barH - colH,
                                  color: const Color(0xFFF3A6C0),
                                ),
                                Container(
                                  height: colH,
                                  color: const Color(0xFFD8B46D),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          _monthsShort[(monthIdx - 1).clamp(0, 11)],
                          style: const TextStyle(
                            fontSize: 9.5,
                            color: AppColors.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
          const SizedBox(height: 12),
          const Row(
            children: [
              _LegendDot(color: Color(0xFFD8B46D), label: 'Tahsil edildi'),
              SizedBox(width: 14),
              _LegendDot(color: Color(0xFFF3A6C0), label: 'Alınacak'),
            ],
          ),
        ],
      ),
    );
  }
}

class _InstallmentSummary extends StatelessWidget {
  const _InstallmentSummary({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Expanded(
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
      decoration: BoxDecoration(
        color: AppColors.surfaceSoft,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13.5),
          ),
          const SizedBox(height: 1),
          Text(
            label,
            style: const TextStyle(color: AppColors.muted, fontSize: 9.5),
          ),
        ],
      ),
    ),
  );
}

class _LegendDot extends StatelessWidget {
  const _LegendDot({required this.color, required this.label});
  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(
        width: 10,
        height: 10,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(3),
        ),
      ),
      const SizedBox(width: 6),
      Text(
        label,
        style: const TextStyle(fontSize: 10.5, color: AppColors.muted),
      ),
    ],
  );
}
