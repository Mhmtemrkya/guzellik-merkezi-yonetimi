import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';

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
                itemBuilder: (_, i) => _AppointmentCard(a: (items[i] as Map).cast<String, dynamic>()),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _AppointmentCard extends StatelessWidget {
  const _AppointmentCard({required this.a});
  final Map<String, dynamic> a;

  @override
  Widget build(BuildContext context) {
    final start = DateTime.tryParse(a['startUtc']?.toString() ?? '')?.toLocal();
    final status = a['status']?.toString() ?? '';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(children: [
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
