import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/network/api_client.dart';
import '../../core/notifications/notification_center.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../appointments/calendar_theme.dart';
import '../notifications/notification_inbox_screen.dart';

/// Personel (Staff) rolü için web /personel dashboard'ının mobil karşılığı.
/// Yalnızca kendisine atanmış randevuları, haftalık aktiviteyi ve kişisel
/// performansı gösterir; işletme geneli ciro/kasa verisi İÇERMEZ.
class StaffDashboardScreen extends StatefulWidget {
  const StaffDashboardScreen({
    required this.api,
    required this.auth,
    required this.notifications,
    super.key,
  });
  final ApiClient api;
  final AuthController auth;
  final NotificationCenter notifications;

  @override
  State<StaffDashboardScreen> createState() => _StaffDashboardScreenState();
}

class _StaffData {
  const _StaffData({required this.appointments, this.me});
  final List<Map<String, dynamic>> appointments;
  final Map<String, dynamic>? me;
}

const _permissionLabels = <String, String>{
  'Appointments': 'Randevu işlemleri',
  'Customers': 'Müşteri kartları',
  'Services': 'Hizmet / seans işlemleri',
  'CashRegister': 'Kasa / tahsilat',
  'Stock': 'Stok görüntüleme',
  'Reports': 'Kişisel performans',
  'Notifications': 'Bildirimler',
  'Logs': 'İşlem geçmişi',
};

class _QuickAction {
  const _QuickAction(this.label, this.route, this.icon, this.color, this.perm);
  final String label;
  final String route;
  final IconData icon;
  final Color color;
  final String? perm;
}

const _quickActions = <_QuickAction>[
  _QuickAction('Randevularım', '/appointments', Icons.event_rounded,
      Color(0xFFC85776), 'Appointments'),
  _QuickAction('Müşterilerim', '/customers', Icons.people_alt_rounded,
      Color(0xFFBD6476), 'Customers'),
  _QuickAction('Seanslarım', '/sessions', Icons.layers_rounded,
      Color(0xFFB08742), 'Services'),
  _QuickAction('Günlük Kasa', '/cash', Icons.payments_rounded,
      Color(0xFF39846F), 'CashRegister'),
];

String _greeting() {
  final h = DateTime.now().hour;
  if (h < 6) return 'İyi geceler';
  if (h < 12) return 'Günaydın';
  if (h < 18) return 'İyi günler';
  return 'İyi akşamlar';
}

class _StaffDashboardScreenState extends State<StaffDashboardScreen> {
  late Future<_StaffData> future;

  @override
  void initState() {
    super.initState();
    future = _load();
  }

  Future<_StaffData> _load() async {
    final dayStart = DateTime.now();
    final from = DateTime(dayStart.year, dayStart.month, dayStart.day);
    final to = from.add(const Duration(days: 7));
    final values = await Future.wait([
      // Randevu sayfa izni yoksa backend 403 döner; dashboard boş metriklerle açılır.
      widget.api.get('/api/admin/appointments/', query: {
        'page': 1,
        'pageSize': 200,
        'fromUtc': from.toUtc().toIso8601String(),
        'toUtc': to.toUtc().toIso8601String(),
      }).catchError((_) => const <dynamic>[]),
      // Personel için API kendi kaydına kapsar; web paritesi: ilk kayıt = ben.
      widget.api
          .get('/api/admin/staff/', query: {'page': 1, 'pageSize': 10})
          .catchError((_) => const <dynamic>[]),
    ]);
    final staff = apiItems(values[1]);
    final appts = apiItems(values[0])
      ..sort((a, b) => '${a['startUtc']}'.compareTo('${b['startUtc']}'));
    return _StaffData(
      appointments: appts,
      me: staff.isNotEmpty ? staff.first : null,
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
              setState(() => future = _load());
              await future;
            },
            child: FutureBuilder<_StaffData>(
              future: future,
              builder: (context, snapshot) {
                if (!snapshot.hasData && !snapshot.hasError) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snapshot.hasError) {
                  return ListView(
                    padding: const EdgeInsets.all(24),
                    children: [
                      const SizedBox(height: 60),
                      Icon(Icons.cloud_off_rounded,
                          size: 42, color: AppColors.muted.withValues(alpha: .6)),
                      const SizedBox(height: 12),
                      Center(child: Text('${snapshot.error}')),
                    ],
                  );
                }
                final data = snapshot.data!;
                return _body(context, user, data);
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _body(BuildContext context, dynamic user, _StaffData data) {
    final now = DateTime.now();
    final todayKey = DateTime(now.year, now.month, now.day);

    DateTime? startOf(Map<String, dynamic> a) => parseUtcToLocal(a['startUtc']);
    bool isToday(Map<String, dynamic> a) {
      final s = startOf(a);
      return s != null &&
          DateTime(s.year, s.month, s.day) == todayKey;
    }

    String st(Map<String, dynamic> a) => '${a['status']}'.toLowerCase();

    final appts = data.appointments;
    final todayAppts = appts.where(isToday).toList();
    final completed = appts.where((a) => st(a) == 'completed').length;
    final cancelled =
        appts.where((a) => st(a) == 'cancelled' || st(a) == 'noshow').length;
    final waiting = appts
        .where((a) =>
            st(a) == 'scheduled' || st(a) == 'confirmed' || st(a) == 'draft')
        .length;
    final uniqueCustomers = appts
        .map((a) => '${a['customerId']}')
        .where((id) => id.isNotEmpty && id != 'null')
        .toSet()
        .length;
    final resolved = completed + cancelled;
    final successRate =
        resolved > 0 ? ((completed / resolved) * 100).round() : 0;
    final nextAppt = appts.cast<Map<String, dynamic>?>().firstWhere(
          (a) => startOf(a!)?.isAfter(now) ?? false,
          orElse: () => null,
        );

    // Haftalık dağılım (bugünden itibaren 7 gün).
    final weekCounts = List<int>.filled(7, 0);
    final weekLabels = List<String>.generate(7, (i) {
      final d = todayKey.add(Duration(days: i));
      return CalendarText.weekdayShort[d.weekday - 1];
    });
    for (final a in appts) {
      final s = startOf(a);
      if (s == null) continue;
      final idx =
          DateTime(s.year, s.month, s.day).difference(todayKey).inDays;
      if (idx >= 0 && idx < 7) weekCounts[idx]++;
    }

    final rating = (data.me?['averageRating'] as num?)?.toDouble();
    final ratingCount = (data.me?['ratingCount'] as num?)?.toInt() ?? 0;
    final perms = (user.permissions as List<String>);
    final readablePerms = perms
        .map((k) => _permissionLabels[k] ?? k)
        .take(8)
        .toList();
    final actions = _quickActions
        .where((a) => a.perm == null || perms.contains(a.perm))
        .toList();
    final firstName =
        ('${user.fullName}'.trim().split(RegExp(r'\s+'))).first;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        // ÜST BAR: selamlama + bildirim zili
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _greeting().toUpperCase(),
                    style: const TextStyle(
                      fontSize: 11,
                      letterSpacing: 2,
                      fontWeight: FontWeight.w700,
                      color: AppColors.primaryDark,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Panelim',
                    style: Theme.of(context)
                        .textTheme
                        .headlineSmall
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ],
              ),
            ),
            NotificationBell(
              center: widget.notifications,
              onOpen: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => NotificationInboxScreen(
                    center: widget.notifications,
                  ),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 14),

        // HERO
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text.rich(
                TextSpan(
                  text: '$firstName, bugün ',
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: AppColors.ink,
                    height: 1.25,
                  ),
                  children: [
                    TextSpan(
                      text: '${todayAppts.length}',
                      style: const TextStyle(color: AppColors.primaryDark),
                    ),
                    const TextSpan(text: ' randevun var.'),
                  ],
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                'Bu panel yalnızca sana atanmış işleri gösterir.',
                style: TextStyle(fontSize: 12.5, color: AppColors.muted),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: _heroBox(
                      icon: Icons.schedule_rounded,
                      label: 'SIRADAKİ',
                      value: nextAppt == null
                          ? '—'
                          : CalendarText.hm(startOf(nextAppt)!),
                      sub: nextAppt == null
                          ? 'Planlanmış randevu yok'
                          : valueOf(nextAppt,
                              const ['customerName', 'fullName']),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _heroBox(
                      icon: Icons.star_rounded,
                      label: 'MÜŞTERİ PUANIM',
                      value: rating != null && ratingCount > 0
                          ? '${rating.toStringAsFixed(1)} / 5'
                          : 'Yeni',
                      sub: ratingCount > 0
                          ? '$ratingCount değerlendirme'
                          : 'henüz puan yok',
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),

        // METRİK KARTLARI
        Row(
          children: [
            Expanded(
              child: _metric('Bugünkü randevum', '${todayAppts.length}',
                  'sana atanmış', Icons.event_rounded, const Color(0xFFC85776),
                  onTap: () => context.go('/appointments')),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _metric('Bekleyen işlem', '$waiting', 'onay / planlı',
                  Icons.hourglass_top_rounded, const Color(0xFFB88938)),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _metric('Tamamlanan (hafta)', '$completed',
                  '%$successRate başarı oranı', Icons.check_circle_rounded,
                  const Color(0xFF39846F)),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _metric('Atanmış müşteri', '$uniqueCustomers',
                  'bu haftaki randevulardan', Icons.people_alt_rounded,
                  const Color(0xFF8B5AA5),
                  onTap: () => context.go('/customers')),
            ),
          ],
        ),
        const SizedBox(height: 16),

        // BUGÜNKÜ PROGRAMIM
        _sectionTitle('GÜNLÜK AKIŞ', 'Bugünkü programım',
            action: TextButton(
              onPressed: () => context.go('/appointments'),
              child: const Text('Tümü'),
            )),
        Container(
          decoration: _cardDeco,
          child: todayAppts.isEmpty
              ? const Padding(
                  padding: EdgeInsets.symmetric(vertical: 36),
                  child: Center(
                    child: Text(
                      'Bugün sana atanmış randevu yok.',
                      style: TextStyle(color: AppColors.muted, fontSize: 13),
                    ),
                  ),
                )
              : Column(
                  children: [
                    for (final (i, a) in todayAppts.take(8).indexed) ...[
                      if (i > 0)
                        const Divider(height: 1, color: AppColors.border),
                      _programRow(a, startOf(a)),
                    ],
                  ],
                ),
        ),
        const SizedBox(height: 16),

        // HAFTALIK AKTİVİTE
        _sectionTitle('BU HAFTA', 'Haftalık aktivite'),
        Container(
          decoration: _cardDeco,
          padding: const EdgeInsets.fromLTRB(16, 18, 16, 12),
          child: _MiniBars(values: weekCounts, labels: weekLabels),
        ),
        const SizedBox(height: 16),

        // HIZLI İŞLEMLER
        _sectionTitle('KISAYOLLAR', 'Hızlı işlemler'),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 2.9,
          children: [
            for (final a in actions)
              Material(
                color: a.color.withValues(alpha: .08),
                borderRadius: BorderRadius.circular(14),
                child: InkWell(
                  borderRadius: BorderRadius.circular(14),
                  onTap: () => context.push(a.route),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Row(
                      children: [
                        Icon(a.icon, size: 18, color: a.color),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            a.label,
                            style: TextStyle(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w700,
                              color: a.color,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 16),

        // YETKİLERİM
        _sectionTitle('PROFİL', 'Yetkilerim'),
        Container(
          decoration: _cardDeco,
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final label
                  in readablePerms.isEmpty
                      ? const ['Profil görüntüleme']
                      : readablePerms)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      const Icon(Icons.check_circle_rounded,
                          size: 15, color: AppColors.primaryDark),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(label,
                            style: const TextStyle(fontSize: 12.5)),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF2F6),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFF3D9E1)),
                ),
                child: const Text(
                  'Şuben kurum yöneticisi tarafından atanmıştır; değişiklik için yöneticine başvur.',
                  style: TextStyle(fontSize: 11.5, color: Color(0xFF9D4A66)),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  static final _cardDeco = BoxDecoration(
    color: Colors.white,
    borderRadius: BorderRadius.circular(18),
    border: Border.all(color: AppColors.border),
  );

  Widget _sectionTitle(String eyebrow, String title, {Widget? action}) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    eyebrow,
                    style: const TextStyle(
                      fontSize: 10,
                      letterSpacing: 1.6,
                      fontWeight: FontWeight.w700,
                      color: AppColors.primaryDark,
                    ),
                  ),
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      color: AppColors.ink,
                    ),
                  ),
                ],
              ),
            ),
            ?action,
          ],
        ),
      );

  Widget _heroBox({
    required IconData icon,
    required String label,
    required String value,
    required String sub,
  }) =>
      Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0xFFFFFAFC),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 13, color: AppColors.primaryDark),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    label,
                    style: const TextStyle(
                      fontSize: 9.5,
                      letterSpacing: 1.2,
                      fontWeight: FontWeight.w700,
                      color: AppColors.primaryDark,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              value,
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w800,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              sub,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11, color: AppColors.muted),
            ),
          ],
        ),
      );

  Widget _metric(
    String title,
    String value,
    String detail,
    IconData icon,
    Color color, {
    VoidCallback? onTap,
  }) =>
      Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: .1),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(icon, size: 17, color: color),
                ),
                const SizedBox(height: 10),
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.w800,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  detail,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style:
                      const TextStyle(fontSize: 11, color: AppColors.muted),
                ),
              ],
            ),
          ),
        ),
      );

  Widget _programRow(Map<String, dynamic> a, DateTime? start) {
    final status = '${a['status']}';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          SizedBox(
            width: 48,
            child: Text(
              start == null ? '—' : CalendarText.hm(start),
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w800,
                color: AppColors.ink,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  valueOf(a, const ['customerName', 'fullName']),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  valueOf(a, const ['serviceName'], fallback: ''),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style:
                      const TextStyle(fontSize: 11, color: AppColors.muted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: CalendarText.statusColor(status).withValues(alpha: .1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              CalendarText.statusLabel(status),
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w700,
                color: CalendarText.statusColor(status),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MiniBars extends StatelessWidget {
  const _MiniBars({required this.values, required this.labels});
  final List<int> values;
  final List<String> labels;

  @override
  Widget build(BuildContext context) {
    final max = values.fold<int>(1, (m, v) => v > m ? v : m);
    return SizedBox(
      height: 110,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          for (var i = 0; i < values.length; i++) ...[
            if (i > 0) const SizedBox(width: 6),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Text(
                    '${values[i]}',
                    style: const TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: AppColors.muted,
                    ),
                  ),
                  const SizedBox(height: 3),
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 500),
                    curve: Curves.easeOutCubic,
                    height: 8 + (values[i] / max) * 52,
                    decoration: BoxDecoration(
                      gradient: values[i] > 0
                          ? const LinearGradient(
                              begin: Alignment.bottomCenter,
                              end: Alignment.topCenter,
                              colors: [Color(0xFFE0617F), Color(0xFFF3A3BF)],
                            )
                          : null,
                      color: values[i] > 0 ? null : const Color(0xFFF1E5EA),
                      borderRadius: const BorderRadius.vertical(
                        top: Radius.circular(5),
                      ),
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    labels[i],
                    style: const TextStyle(
                      fontSize: 9.5,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
