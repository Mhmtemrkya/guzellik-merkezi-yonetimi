import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/responsive.dart';

/// Online randevu müşteri portalı — alt sekmeli kabuk (Ana Sayfa / Randevularım / Profil).
class CustomerShell extends StatelessWidget {
  const CustomerShell({required this.navigationShell, super.key});
  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: navigationShell.currentIndex,
        onDestinationSelected: (i) =>
            navigationShell.goBranch(i, initialLocation: i == navigationShell.currentIndex),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home_rounded), label: 'Ana Sayfa'),
          NavigationDestination(icon: Icon(Icons.event_note_outlined), selectedIcon: Icon(Icons.event_note_rounded), label: 'Randevularım'),
          NavigationDestination(icon: Icon(Icons.person_outline_rounded), selectedIcon: Icon(Icons.person_rounded), label: 'Profil'),
        ],
      ),
    );
  }
}

// ============================ Ana Sayfa: Kurum/Şube seçimi ============================

class CustomerHomeScreen extends StatefulWidget {
  const CustomerHomeScreen({required this.api, required this.auth, super.key});
  final ApiClient api;
  final AuthController auth;

  @override
  State<CustomerHomeScreen> createState() => _CustomerHomeScreenState();
}

class _CustomerHomeScreenState extends State<CustomerHomeScreen> {
  late Future<Map<String, dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<Map<String, dynamic>> _load() async {
    final me = await widget.api.get('/api/customer/me') as Map;
    final branches = await widget.api.get('/api/customer/branches') as List;
    return {'me': me.cast<String, dynamic>(), 'branches': branches};
  }

  void _openBooking(Map<String, dynamic> branch) =>
      context.push('/customer/booking', extra: {'branch': branch});

  /// Şube kartlarını döner. Pazaryerinde (groupByTenant) kuruma göre başlıklı gruplar,
  /// kurum-içi modda düz liste.
  List<Widget> _buildBranchList(
    BuildContext context,
    List<Map<String, dynamic>> branches, {
    required bool groupByTenant,
  }) {
    if (!groupByTenant) {
      return branches.map((b) => _BranchCard(branch: b, onTap: () => _openBooking(b))).toList();
    }
    // Kuruma göre grupla (sıra korunur — backend zaten kurum adına göre sıralı döner).
    final groups = <String, List<Map<String, dynamic>>>{};
    for (final b in branches) {
      final tenant = b['tenantName']?.toString().trim();
      groups.putIfAbsent(tenant == null || tenant.isEmpty ? 'Kurum' : tenant, () => []).add(b);
    }
    final widgets = <Widget>[];
    groups.forEach((tenant, items) {
      widgets.add(Padding(
        padding: const EdgeInsets.only(top: 6, bottom: 8),
        child: Row(children: [
          const Icon(Icons.business_rounded, size: 16, color: AppColors.primaryDark),
          const SizedBox(width: 6),
          Expanded(
            child: Text(tenant,
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: AppColors.primaryDark)),
          ),
        ]),
      ));
      widgets.addAll(items.map((b) => _BranchCard(branch: b, onTap: () => _openBooking(b))));
      widgets.add(const SizedBox(height: 8));
    });
    return widgets;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async => setState(() { _future = _load(); }),
          child: FutureBuilder<Map<String, dynamic>>(
            future: _future,
            builder: (context, snap) {
              if (snap.connectionState == ConnectionState.waiting) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snap.hasError) {
                return _ErrorView(message: '${snap.error}', onRetry: () => setState(() { _future = _load(); }));
              }
              final me = (snap.data!['me'] as Map).cast<String, dynamic>();
              final branches = (snap.data!['branches'] as List)
                  .whereType<Map>()
                  .map((e) => e.cast<String, dynamic>())
                  .toList();
              final isMarketplace = me['isMarketplace'] == true;
              final tenantName = me['tenantName']?.toString() ?? '';

              return ListView(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                children: [
                  Text(
                    isMarketplace
                        ? 'Güzellik Merkezleri'
                        : (tenantName.isEmpty ? 'Kurumunuz' : tenantName),
                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: AppColors.ink),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    isMarketplace
                        ? 'Randevu almak istediğiniz kurum ve şubeyi seçin.'
                        : 'Randevu almak istediğiniz şubeyi seçin.',
                    style: const TextStyle(color: AppColors.muted),
                  ),
                  const SizedBox(height: 18),
                  if (branches.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: 40),
                      child: Center(child: Text('Şube bulunamadı.', style: TextStyle(color: AppColors.muted))),
                    ),
                  // Pazaryerinde şubeleri kuruma göre grupla; kurum-içi modda düz liste.
                  ..._buildBranchList(context, branches, groupByTenant: isMarketplace),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

class _BranchCard extends StatelessWidget {
  const _BranchCard({required this.branch, required this.onTap});
  final Map<String, dynamic> branch;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: CircleAvatar(
          backgroundColor: AppColors.rose,
          child: const Icon(Icons.storefront_rounded, color: AppColors.primaryDark),
        ),
        title: Text(branch['name']?.toString() ?? 'Şube', style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Row(children: [
          const Icon(Icons.location_on_outlined, size: 14, color: AppColors.muted),
          const SizedBox(width: 3),
          Text(branch['city']?.toString() ?? '', style: const TextStyle(color: AppColors.muted)),
          if (branch['isDefault'] == true) ...[
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
              decoration: BoxDecoration(color: AppColors.rose, borderRadius: BorderRadius.circular(20)),
              child: const Text('Merkez', style: TextStyle(fontSize: 10, color: AppColors.primaryDark, fontWeight: FontWeight.w700)),
            ),
          ],
        ]),
        trailing: const Icon(Icons.arrow_forward_ios_rounded, size: 16, color: AppColors.primary),
        onTap: onTap,
      ),
    );
  }
}

// ============================ Randevularım ============================

class CustomerAppointmentsScreen extends StatefulWidget {
  const CustomerAppointmentsScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<CustomerAppointmentsScreen> createState() => _CustomerAppointmentsScreenState();
}

class _CustomerAppointmentsScreenState extends State<CustomerAppointmentsScreen> {
  late Future<List<dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<dynamic>> _load() async => (await widget.api.get('/api/customer/appointments') as List).cast<dynamic>();

  void _reload() => setState(() => _future = _load());

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Randevularım'), backgroundColor: AppColors.background, elevation: 0),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async => setState(() { _future = _load(); }),
          child: FutureBuilder<List<dynamic>>(
            future: _future,
            builder: (context, snap) {
              if (snap.connectionState == ConnectionState.waiting) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snap.hasError) {
                return _ErrorView(message: '${snap.error}', onRetry: () => setState(() { _future = _load(); }));
              }
              final items = snap.data!;
              if (items.isEmpty) {
                return ListView(children: const [
                  SizedBox(height: 120),
                  Icon(Icons.event_busy_rounded, size: 56, color: AppColors.muted),
                  SizedBox(height: 12),
                  Center(child: Text('Henüz randevunuz yok.', style: TextStyle(color: AppColors.muted))),
                ]);
              }
              return ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                itemCount: items.length,
                separatorBuilder: (_, _) => const SizedBox(height: 10),
                itemBuilder: (_, i) => _AppointmentCard(
                  api: widget.api,
                  a: (items[i] as Map).cast<String, dynamic>(),
                  onChanged: _reload,
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _AppointmentCard extends StatefulWidget {
  const _AppointmentCard({required this.api, required this.a, required this.onChanged});
  final ApiClient api;
  final Map<String, dynamic> a;
  final VoidCallback onChanged;

  @override
  State<_AppointmentCard> createState() => _AppointmentCardState();
}

class _AppointmentCardState extends State<_AppointmentCard> {
  bool _busy = false;

  // Müşteri kendi randevusunu ancak aktif statüde ve başlangıca ≥ 2 saat varken
  // online iptal/erteleyebilir (backend ile aynı kural). Status string ya da int gelebilir.
  bool get _eligible {
    final s = (widget.a['status']?.toString() ?? '').toLowerCase();
    const active = {'scheduled', 'confirmed', 'draft', '1', '2', '6'};
    if (!active.contains(s)) return false;
    final start = DateTime.tryParse(widget.a['startUtc']?.toString() ?? '');
    if (start == null) return false;
    return start.isAfter(DateTime.now().add(const Duration(hours: 2)));
  }

  Future<void> _cancel() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        icon: const Icon(Icons.event_busy_rounded, color: AppColors.danger, size: 40),
        title: const Text('Randevuyu iptal et'),
        content: const Text('Bu randevuyu iptal etmek istediğinize emin misiniz? Bu işlem geri alınamaz.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Vazgeç')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('İptal Et'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      await widget.api.post('/api/customer/appointments/${widget.a['id']}/cancel');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Randevunuz iptal edildi.')));
      widget.onChanged(); // liste yenilenir (bu kart yeniden kurulur)
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _reschedule() async {
    final done = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _RescheduleSheet(api: widget.api, appointment: widget.a),
    );
    if (done == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Erteleme talebiniz salon onayına gönderildi.')),
      );
      widget.onChanged();
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.a;
    final start = DateTime.tryParse(a['startUtc']?.toString() ?? '')?.toLocal();
    final status = a['status']?.toString() ?? '';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(color: AppColors.rose, borderRadius: BorderRadius.circular(12)),
              child: const Icon(Icons.spa_rounded, color: AppColors.primaryDark),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(a['serviceName']?.toString() ?? 'Hizmet', style: const TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text('${a['staffName'] ?? ''} · ${a['branchName'] ?? ''}', style: const TextStyle(color: AppColors.muted, fontSize: 12.5)),
                const SizedBox(height: 4),
                Row(children: [
                  const Icon(Icons.schedule_rounded, size: 13, color: AppColors.primary),
                  const SizedBox(width: 4),
                  Text(start != null ? _fmtDateTime(start) : '-', style: const TextStyle(fontSize: 12.5, color: AppColors.ink)),
                ]),
              ]),
            ),
            _StatusChip(status: status),
          ]),
          if (_eligible) ...[
            const Divider(height: 20),
            Row(children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _busy ? null : _reschedule,
                  icon: const Icon(Icons.event_repeat_rounded, size: 17),
                  label: const Text('Ertele'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.primaryDark,
                    padding: const EdgeInsets.symmetric(vertical: 8),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _busy ? null : _cancel,
                  icon: _busy
                      ? const SizedBox.square(dimension: 15, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.danger))
                      : const Icon(Icons.close_rounded, size: 17),
                  label: const Text('İptal Et'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.danger,
                    side: const BorderSide(color: AppColors.danger),
                    padding: const EdgeInsets.symmetric(vertical: 8),
                  ),
                ),
              ),
            ]),
          ],
        ]),
      ),
    );
  }
}

/// Erteleme alt sayfası: yeni gün + saat seç → salon onayına (Draft) düşer.
/// Slotlar randevunun uzman/hizmetine göre müsaitlik ucundan çekilir (booking ile aynı).
class _RescheduleSheet extends StatefulWidget {
  const _RescheduleSheet({required this.api, required this.appointment});
  final ApiClient api;
  final Map<String, dynamic> appointment;

  @override
  State<_RescheduleSheet> createState() => _RescheduleSheetState();
}

class _RescheduleSheetState extends State<_RescheduleSheet> {
  DateTime _date = DateTime.now();
  late Future<Map<String, dynamic>> _future;
  bool _saving = false;
  String? _error;

  String get _branchId => widget.appointment['branchId'].toString();
  String get _staffId => widget.appointment['staffMemberId'].toString();
  String get _serviceId => widget.appointment['serviceDefinitionId'].toString();

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<Map<String, dynamic>> _load() async {
    final d = '${_date.year.toString().padLeft(4, '0')}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}';
    final data = await widget.api.get('/api/customer/availability', query: {
      'branchId': _branchId,
      'staffId': _staffId,
      'serviceId': _serviceId,
      'date': d,
    });
    return (data as Map).cast<String, dynamic>();
  }

  void _pickDate(DateTime d) {
    if (d.year == _date.year && d.month == _date.month && d.day == _date.day) return;
    setState(() {
      _date = d;
      _future = _load();
    });
  }

  Future<void> _confirm(Map<String, dynamic> slot) async {
    final parts = (slot['start'] as String).split(':');
    // Yerel Türkiye saati (+03:00) → UTC instant (booking ekranıyla aynı dönüşüm).
    final startUtc = DateTime.utc(_date.year, _date.month, _date.day, int.parse(parts[0]), int.parse(parts[1]))
        .subtract(const Duration(hours: 3));
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.api.post('/api/customer/appointments/${widget.appointment['id']}/reschedule', {
        'startUtc': startUtc.toIso8601String(),
      });
      if (!mounted) return;
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = '$e';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final today = DateTime.now();
    final days = List.generate(14, (i) => DateTime(today.year, today.month, today.day).add(Duration(days: i)));
    const wd = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.66,
          child: Column(children: [
            const SizedBox(height: 12),
            Container(width: 40, height: 4, decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(2))),
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 14, 20, 2),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text('Randevuyu Ertele', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.ink)),
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text('Yeni gün ve saati seçin. Seçtiğiniz saat salonun onayına gönderilir.',
                    style: TextStyle(color: AppColors.muted, fontSize: 13)),
              ),
            ),
            SizedBox(
              height: 76,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                itemCount: days.length,
                separatorBuilder: (_, _) => const SizedBox(width: 8),
                itemBuilder: (_, i) {
                  final d = days[i];
                  final sel = d.year == _date.year && d.month == _date.month && d.day == _date.day;
                  return GestureDetector(
                    onTap: () => _pickDate(d),
                    child: Container(
                      width: 54,
                      decoration: BoxDecoration(
                        color: sel ? AppColors.primary : AppColors.surface,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: sel ? AppColors.primary : AppColors.border),
                      ),
                      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                        Text(wd[d.weekday - 1], style: TextStyle(fontSize: 11, color: sel ? Colors.white70 : AppColors.muted)),
                        const SizedBox(height: 3),
                        Text('${d.day}', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: sel ? Colors.white : AppColors.ink)),
                      ]),
                    ),
                  );
                },
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                child: Text(_error!, style: const TextStyle(color: AppColors.danger, fontWeight: FontWeight.w600, fontSize: 12.5)),
              ),
            const SizedBox(height: 8),
            Expanded(
              child: FutureBuilder<Map<String, dynamic>>(
                future: _future,
                builder: (context, snap) {
                  if (snap.connectionState == ConnectionState.waiting) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  if (snap.hasError) {
                    return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('${snap.error}', textAlign: TextAlign.center, style: const TextStyle(color: AppColors.muted))));
                  }
                  final slots = ((snap.data!['slots'] as List?) ?? const []).cast<dynamic>();
                  final hasFree = slots.any((s) => (s as Map)['available'] == true);
                  if (slots.isEmpty || !hasFree) {
                    return const Center(child: Text('Bu gün için uygun saat yok.', style: TextStyle(color: AppColors.muted)));
                  }
                  return AbsorbPointer(
                    absorbing: _saving,
                    child: GridView.builder(
                      padding: const EdgeInsets.fromLTRB(16, 4, 16, 20),
                      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: gridCols(context, 4),
                        childAspectRatio: 2.1,
                        crossAxisSpacing: 8,
                        mainAxisSpacing: 8,
                      ),
                      itemCount: slots.length,
                      itemBuilder: (_, i) {
                        final s = (slots[i] as Map).cast<String, dynamic>();
                        final available = s['available'] == true;
                        return InkWell(
                          onTap: available ? () => _confirm(s) : null,
                          borderRadius: BorderRadius.circular(12),
                          child: Container(
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: available ? AppColors.surface : AppColors.surfaceSoft,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: AppColors.border),
                            ),
                            child: Text(
                              s['start']?.toString() ?? '',
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                                color: available ? AppColors.ink : AppColors.muted,
                                decoration: available ? null : TextDecoration.lineThrough,
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                  );
                },
              ),
            ),
          ]),
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (status) {
      'Scheduled' => ('Planlandı', AppColors.primary),
      'Confirmed' => ('Onaylandı', AppColors.success),
      'Completed' => ('Tamamlandı', AppColors.success),
      'Cancelled' => ('İptal', AppColors.danger),
      'NoShow' => ('Gelmedi', AppColors.danger),
      'Draft' => ('Onay Bekliyor', AppColors.primary),
      _ => (status, AppColors.muted),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(20)),
      child: Text(label, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w700)),
    );
  }
}

// ============================ Profil ============================

class CustomerProfileScreen extends StatelessWidget {
  const CustomerProfileScreen({required this.auth, super.key});
  final AuthController auth;

  @override
  Widget build(BuildContext context) {
    final user = auth.user;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Profilim'), backgroundColor: AppColors.background, elevation: 0),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          children: [
            Center(
              child: CircleAvatar(
                radius: 38,
                backgroundColor: AppColors.rose,
                child: Text(user?.initials ?? '?', style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: AppColors.primaryDark)),
              ),
            ),
            const SizedBox(height: 12),
            Center(child: Text(user?.fullName ?? '', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
            const SizedBox(height: 24),
            Card(
              child: ListTile(
                leading: const Icon(Icons.logout_rounded, color: AppColors.danger),
                title: const Text('Çıkış yap', style: TextStyle(color: AppColors.danger)),
                onTap: () => auth.signOut(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ============================ Yardımcılar ============================

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ListView(children: [
      const SizedBox(height: 120),
      const Icon(Icons.error_outline_rounded, size: 48, color: AppColors.danger),
      const SizedBox(height: 10),
      Center(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 32), child: Text(message, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.muted)))),
      const SizedBox(height: 14),
      Center(child: OutlinedButton(onPressed: onRetry, child: const Text('Tekrar dene'))),
    ]);
  }
}

String _fmtDateTime(DateTime d) {
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  final hh = d.hour.toString().padLeft(2, '0');
  final mm = d.minute.toString().padLeft(2, '0');
  return '${d.day} ${months[d.month - 1]} ${d.year}, $hh:$mm';
}
