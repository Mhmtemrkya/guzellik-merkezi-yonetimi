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
  const _StaffData({
    required this.appointments,
    required this.upcoming,
    this.me,
  });

  /// Seçili dönemdeki randevular — KPI, grafik ve işlem dağılımının kaynağı.
  final List<Map<String, dynamic>> appointments;

  /// Bugün + önümüzdeki 14 gün. Dönemden BAĞIMSIZDIR: kullanıcı "Ay"a baksa da
  /// "sıradaki iş" bugünden sonrasıdır.
  final List<Map<String, dynamic>> upcoming;
  final Map<String, dynamic>? me;
}

enum _Period { today, week, month }

const _periodLabels = <_Period, String>{
  _Period.today: 'Bugün',
  _Period.week: 'Hafta',
  _Period.month: 'Ay',
};

const _periodPhrase = <_Period, String>{
  _Period.today: 'bugün',
  _Period.week: 'bu hafta',
  _Period.month: 'bu ay',
};

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
      Color(0xFFA5556E), 'Appointments'),
  _QuickAction('Müşterilerim', '/customers', Icons.people_alt_rounded,
      Color(0xFFE4577F), 'Customers'),
  _QuickAction('Seanslarım', '/sessions', Icons.layers_rounded,
      Color(0xFF723550), 'Services'),
  _QuickAction('Günlük Kasa', '/cash', Icons.payments_rounded,
      Color(0xFF1E8C60), 'CashRegister'),
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
  _Period _period = _Period.week;

  @override
  void initState() {
    super.initState();
    future = _load();
  }

  /// Seçili dönemin penceresi (yerel gün sınırlarıyla).
  (DateTime, DateTime) _window(_Period p) {
    final now = DateTime.now();
    final day = DateTime(now.year, now.month, now.day);
    switch (p) {
      case _Period.today:
        return (day, day.add(const Duration(days: 1)));
      case _Period.week:
        final start = day.subtract(Duration(days: day.weekday - 1));
        return (start, start.add(const Duration(days: 7)));
      case _Period.month:
        return (DateTime(now.year, now.month, 1), DateTime(now.year, now.month + 1, 1));
    }
  }

  Future<_StaffData> _load() async {
    final (from, to) = _window(_period);
    final now = DateTime.now();
    final upFrom = DateTime(now.year, now.month, now.day);
    final upTo = upFrom.add(const Duration(days: 14));

    final values = await Future.wait([
      // Randevu sayfa izni yoksa backend 403 döner; dashboard boş metriklerle açılır.
      widget.api.get('/api/admin/appointments/', query: {
        'page': 1,
        'pageSize': 400,
        'fromUtc': from.toUtc().toIso8601String(),
        'toUtc': to.toUtc().toIso8601String(),
      }).catchError((_) => const <dynamic>[]),
      widget.api.get('/api/admin/appointments/', query: {
        'page': 1,
        'pageSize': 200,
        'fromUtc': upFrom.toUtc().toIso8601String(),
        'toUtc': upTo.toUtc().toIso8601String(),
      }).catchError((_) => const <dynamic>[]),
      // Personel için API kendi kaydına kapsar; web paritesi: ilk kayıt = ben.
      widget.api
          .get('/api/admin/staff/', query: {'page': 1, 'pageSize': 10})
          .catchError((_) => const <dynamic>[]),
    ]);
    final staff = apiItems(values[2]);
    final appts = apiItems(values[0])
      ..sort((a, b) => '${a['startUtc']}'.compareTo('${b['startUtc']}'));
    final upcoming = apiItems(values[1])
      ..sort((a, b) => '${a['startUtc']}'.compareTo('${b['startUtc']}'));
    return _StaffData(
      appointments: appts,
      upcoming: upcoming,
      me: staff.isNotEmpty ? staff.first : null,
    );
  }

  void _changePeriod(_Period p) {
    if (p == _period) return;
    setState(() {
      _period = p;
      future = _load();
    });
  }

  /// Dönem seçici — web'deki pill sekmelerin mobil karşılığı.
  Widget _periodTabs() => Container(
        padding: const EdgeInsets.all(3),
        decoration: BoxDecoration(
          color: AppColors.surfaceSoft,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final p in _Period.values)
              GestureDetector(
                onTap: () => _changePeriod(p),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: _period == p ? AppColors.primary : Colors.transparent,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    _periodLabels[p]!,
                    style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w800,
                      color: _period == p ? Colors.white : AppColors.muted,
                    ),
                  ),
                ),
              ),
          ],
        ),
      );

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

    // DÖNEM verisi: KPI, grafik ve işlem dağılımı buradan.
    final appts = data.appointments;
    // YAKLAŞAN verisi: bugünkü akış ve sıradaki randevu dönemden bağımsızdır.
    final todayAppts = data.upcoming.where(isToday).toList();

    final completed = appts.where((a) => st(a) == 'completed').length;
    final waiting = appts
        .where((a) =>
            st(a) == 'scheduled' || st(a) == 'confirmed' || st(a) == 'draft')
        .length;
    final uniqueCustomers = appts
        .map((a) => '${a['customerId']}')
        .where((id) => id.isNotEmpty && id != 'null')
        .toSet()
        .length;
    // "Başarı oranım" [tamamlanan / (tamamlanan + iptal)] KALDIRILDI: müşterinin gelmemesi ya da
    // randevuyu iptal etmesi personelin performansı değil, ama oran onu personelin hanesine
    // yazıp cezalandırıyordu. Yerine tamamen personelin kendi işine bağlı olan çalışma hacmi.
    final workedMinutes = appts.where((a) => st(a) == 'completed').fold<int>(0, (sum, a) {
      final start = startOf(a);
      final endRaw = a['endUtc']?.toString();
      final end = endRaw == null ? null : DateTime.tryParse(endRaw)?.toLocal();
      if (start == null || end == null) return sum;
      final minutes = end.difference(start).inMinutes;
      return sum + (minutes > 0 ? minutes : 0);
    });
    final workedHours = (workedMinutes / 60).round();
    final nextAppt = data.upcoming.cast<Map<String, dynamic>?>().firstWhere(
          (a) => startOf(a!)?.isAfter(now) ?? false,
          orElse: () => null,
        );

    // Yaklaşanlar: bugünden SONRAKİ günler (iptaller hariç), ilk 5.
    final later = data.upcoming
        .where((a) {
          final s = startOf(a);
          if (s == null) return false;
          return DateTime(s.year, s.month, s.day).isAfter(todayKey) &&
              st(a) != 'cancelled';
        })
        .take(5)
        .toList();

    // --- Dönem dağılımı: bugün → saat dilimleri, diğer → günler ---
    final (winFrom, winTo) = _window(_period);
    final List<String> chartLabels;
    final List<int> chartTotals;
    final List<int> chartDone;

    if (_period == _Period.today) {
      const slots = [8, 10, 12, 14, 16, 18, 20];
      chartLabels = slots.map((h) => h.toString().padLeft(2, '0')).toList();
      chartTotals = List<int>.filled(slots.length, 0);
      chartDone = List<int>.filled(slots.length, 0);
      for (final a in appts) {
        final s = startOf(a);
        if (s == null) continue;
        var idx = ((s.hour - 8) ~/ 2);
        if (idx < 0) idx = 0;
        if (idx >= slots.length) idx = slots.length - 1;
        chartTotals[idx]++;
        if (st(a) == 'completed') chartDone[idx]++;
      }
    } else {
      final days = winTo.difference(winFrom).inDays;
      chartLabels = List<String>.generate(days, (i) {
        final d = winFrom.add(Duration(days: i));
        // Ay uzun: her günü etiketlemek yerine 5'in katları yazılır.
        if (_period == _Period.week) {
          return CalendarText.weekdayShort[d.weekday - 1];
        }
        return (i == 0 || (i + 1) % 5 == 0) ? '${i + 1}' : '';
      });
      chartTotals = List<int>.filled(days, 0);
      chartDone = List<int>.filled(days, 0);
      for (final a in appts) {
        final s = startOf(a);
        if (s == null) continue;
        final idx = DateTime(s.year, s.month, s.day).difference(winFrom).inDays;
        if (idx < 0 || idx >= days) continue;
        chartTotals[idx]++;
        if (st(a) == 'completed') chartDone[idx]++;
      }
    }

    // --- En çok uygulanan işlemler (dönemde tamamlananlar) ---
    final serviceCounts = <String, int>{};
    for (final a in appts) {
      if (st(a) != 'completed') continue;
      final name =
          valueOf(a, const ['serviceName', 'islem'], fallback: 'Hizmet').trim();
      serviceCounts[name] = (serviceCounts[name] ?? 0) + 1;
    }
    final serviceRows = serviceCounts.entries.toList()
      ..sort((x, y) => y.value.compareTo(x.value));

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

        // DÖNEM SEÇİCİ — aşağıdaki tüm KPI ve grafikler bu döneme bakar.
        Row(
          children: [
            const Expanded(
              child: Text('DÖNEM',
                  style: TextStyle(
                      fontSize: 10.5,
                      letterSpacing: 1.6,
                      fontWeight: FontWeight.w800,
                      color: AppColors.muted)),
            ),
            _periodTabs(),
          ],
        ),
        const SizedBox(height: 10),

        // METRİK KARTLARI
        Row(
          children: [
            Expanded(
              child: _metric('Randevum', '${appts.length}',
                  '${_periodPhrase[_period]} atanmış', Icons.event_rounded,
                  const Color(0xFFA5556E),
                  onTap: () => context.go('/appointments')),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _metric('Tamamladığım', '$completed',
                  '${_periodPhrase[_period]} biten', Icons.check_circle_rounded,
                  const Color(0xFF1E8C60)),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _metric('Hizmet saatim', '$workedHours sa',
                  completed > 0 ? '$completed tamamlanan seans' : 'henüz veri yok',
                  Icons.timelapse_rounded, const Color(0xFF3A72B0)),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _metric('Müşterim', '$uniqueCustomers',
                  waiting > 0 ? '$waiting bekleyen işlem' : '${_periodPhrase[_period]} hizmet verilen',
                  Icons.people_alt_rounded, const Color(0xFF723550),
                  onTap: () => context.go('/customers')),
            ),
          ],
        ),
        const SizedBox(height: 16),

        // PERFORMANS GRAFİĞİ — iş hacmi (para DEĞİL; personel ciro görmez).
        _sectionTitle(
            'PERFORMANS',
            _period == _Period.today
                ? 'Bugünün saat dağılımı'
                : _period == _Period.week
                    ? 'Bu haftanın dağılımı'
                    : 'Bu ayın dağılımı'),
        Container(
          decoration: _cardDeco,
          padding: const EdgeInsets.fromLTRB(14, 18, 14, 12),
          child: _PerformanceChart(
            labels: chartLabels,
            totals: chartTotals,
            done: chartDone,
            emptyLabel: '${_periodPhrase[_period]} sana atanmış randevu yok.',
          ),
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

        // YAKLAŞAN RANDEVULAR — dönemden bağımsız, sıradaki işler.
        _sectionTitle('SIRADAKİLER', 'Yaklaşan randevularım'),
        Container(
          decoration: _cardDeco,
          child: later.isEmpty
              ? const Padding(
                  padding: EdgeInsets.symmetric(vertical: 28),
                  child: Center(
                    child: Text(
                      'Önümüzdeki 14 günde planlanmış randevun yok.',
                      style: TextStyle(color: AppColors.muted, fontSize: 12.5),
                    ),
                  ),
                )
              : Column(
                  children: [
                    for (final (i, a) in later.indexed) ...[
                      if (i > 0)
                        const Divider(height: 1, color: AppColors.border),
                      _upcomingRow(a, startOf(a)),
                    ],
                  ],
                ),
        ),
        const SizedBox(height: 16),

        // EN ÇOK YAPILAN İŞLEMLER
        _sectionTitle('UZMANLIK', 'En çok yaptığım işlemler'),
        Container(
          decoration: _cardDeco,
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
          child: serviceRows.isEmpty
              ? const Padding(
                  padding: EdgeInsets.symmetric(vertical: 18),
                  child: Center(
                    child: Text('Bu dönemde tamamlanmış işlem yok.',
                        style: TextStyle(color: AppColors.muted, fontSize: 12.5)),
                  ),
                )
              : Column(
                  children: [
                    for (final e in serviceRows.take(6))
                      _serviceBar(e.key, e.value, serviceRows.first.value),
                  ],
                ),
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
                  color: const Color(0xFFF6DFE6),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFE3C6D1)),
                ),
                child: const Text(
                  'Şuben kurum yöneticisi tarafından atanmıştır; değişiklik için yöneticine başvur.',
                  style: TextStyle(fontSize: 11.5, color: Color(0xFF7A3450)),
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
          color: const Color(0xFFF7F6F6),
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

  /// Yaklaşan randevu satırı — solda gün/ay rozeti, sağda saat.
  Widget _upcomingRow(Map<String, dynamic> a, DateTime? start) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      child: Row(
        children: [
          Container(
            width: 44,
            padding: const EdgeInsets.symmetric(vertical: 5),
            decoration: BoxDecoration(
              color: AppColors.surfaceSoft,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              children: [
                Text(start == null ? '—' : '${start.day}',
                    style: const TextStyle(
                        fontSize: 13.5, fontWeight: FontWeight.w800, height: 1)),
                const SizedBox(height: 2),
                Text(
                  start == null
                      ? ''
                      : CalendarText.months[start.month - 1].substring(0, 3),
                  style: const TextStyle(fontSize: 9, color: AppColors.muted, height: 1),
                ),
              ],
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
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                ),
                Text(
                  valueOf(a, const ['serviceName'], fallback: ''),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 11, color: AppColors.muted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            start == null ? '' : CalendarText.hm(start),
            style: const TextStyle(
                fontSize: 13, fontWeight: FontWeight.w800, color: AppColors.primaryDark),
          ),
        ],
      ),
    );
  }

  /// İşlem dağılımı satırı — oransal yatay çubuk.
  Widget _serviceBar(String name, int count, int max) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12)),
              ),
              Text('$count',
                  style: const TextStyle(
                      fontSize: 12, fontWeight: FontWeight.w800, color: AppColors.muted)),
            ],
          ),
          const SizedBox(height: 5),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: max > 0 ? count / max : 0,
              minHeight: 7,
              backgroundColor: AppColors.surfaceSoft,
              valueColor: const AlwaysStoppedAnimation(AppColors.primary),
            ),
          ),
        ],
      ),
    );
  }
}

/// Dönem performansı: çubuklar toplam randevuyu, koyu üst dilim tamamlananı gösterir.
/// Para DEĞİL iş hacmi gösterir — personel işletme cirosunu görmez.
class _PerformanceChart extends StatelessWidget {
  const _PerformanceChart({
    required this.labels,
    required this.totals,
    required this.done,
    required this.emptyLabel,
  });

  final List<String> labels;
  final List<int> totals;
  final List<int> done;
  final String emptyLabel;

  @override
  Widget build(BuildContext context) {
    final max = totals.isEmpty ? 0 : totals.reduce((a, b) => a > b ? a : b);
    if (max == 0) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 26),
        child: Center(
          child: Text(emptyLabel,
              style: const TextStyle(color: AppColors.muted, fontSize: 12.5)),
        ),
      );
    }

    return Column(
      children: [
        SizedBox(
          height: 132,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              for (var i = 0; i < totals.length; i++)
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 1.5),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        Text(
                          totals[i] > 0 ? '${totals[i]}' : '',
                          style: const TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.w700,
                              color: AppColors.muted),
                        ),
                        const SizedBox(height: 2),
                        // Toplam çubuğu; içindeki koyu kısım tamamlananı temsil eder.
                        SizedBox(
                          height: 96 * (totals[i] / max),
                          width: double.infinity,
                          child: Stack(
                            alignment: Alignment.bottomCenter,
                            children: [
                              Container(
                                decoration: BoxDecoration(
                                  color: AppColors.primary.withValues(alpha: .18),
                                  borderRadius: const BorderRadius.vertical(
                                      top: Radius.circular(4)),
                                ),
                              ),
                              FractionallySizedBox(
                                heightFactor:
                                    totals[i] > 0 ? done[i] / totals[i] : 0,
                                child: Container(
                                  decoration: const BoxDecoration(
                                    color: AppColors.success,
                                    borderRadius: BorderRadius.vertical(
                                        top: Radius.circular(4)),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            for (final l in labels)
              Expanded(
                child: Text(l,
                    textAlign: TextAlign.center,
                    maxLines: 1,
                    overflow: TextOverflow.clip,
                    style: const TextStyle(fontSize: 9, color: AppColors.muted)),
              ),
          ],
        ),
        const SizedBox(height: 10),
        const Divider(height: 1, color: AppColors.border),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _Legend(color: AppColors.primary.withValues(alpha: .18), label: 'Randevu'),
            SizedBox(width: 16),
            _Legend(color: AppColors.success, label: 'Tamamlanan'),
          ],
        ),
      ],
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label});
  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 14,
            height: 8,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(3),
            ),
          ),
          const SizedBox(width: 5),
          Text(label,
              style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
        ],
      );
}
