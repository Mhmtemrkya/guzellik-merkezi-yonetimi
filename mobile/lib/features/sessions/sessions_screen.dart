import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/async_list_page.dart';

/// Seanslar — web "seanslar" sayfasının özellik karşılığı: cari/paketli
/// müşteriler listesi, dokununca o müşterinin paket seansları (kullanılan/kalan).
class SessionsScreen extends StatefulWidget {
  const SessionsScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<SessionsScreen> createState() => _SessionsScreenState();
}

class _SessionsScreenState extends State<SessionsScreen> {
  Future<void> _openSessions(Map<String, dynamic> account) async {
    final customerId = account['customerId'];
    if (customerId == null) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _SessionsSheet(
        api: widget.api,
        customerId: '$customerId',
        customerName: valueOf(account, const ['customerName', 'name']),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AsyncListPage(
      eyebrow: 'Personel',
      title: 'Seanslar',
      subtitle: 'Müşteri paketleri, kullanılan ve kalan seanslar.',
      icon: Icons.content_cut_rounded,
      loader: () => widget.api
          .get('/api/admin/accounts/', query: {'page': 1, 'pageSize': 200}),
      titleKeys: const ['customerName', 'name'],
      subtitleKeys: const ['name', 'servicePackageName'],
      trailingKeys: const ['remainingAmount'],
      onItemTap: _openSessions,
    );
  }
}

class _SessionsSheet extends StatefulWidget {
  const _SessionsSheet({
    required this.api,
    required this.customerId,
    required this.customerName,
  });
  final ApiClient api;
  final String customerId;
  final String customerName;

  @override
  State<_SessionsSheet> createState() => _SessionsSheetState();
}

class _SessionsSheetState extends State<_SessionsSheet> {
  late Future<List<Map<String, dynamic>>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<Map<String, dynamic>>> _load() async {
    final data = await widget.api
        .get('/api/admin/accounts/sessions/${widget.customerId}');
    return apiItems(data);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.customerName,
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.w800)),
          const Text('Paket seansları',
              style: TextStyle(color: AppColors.muted)),
          const SizedBox(height: 14),
          FutureBuilder<List<Map<String, dynamic>>>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Padding(
                  padding: EdgeInsets.all(30),
                  child: Center(child: CircularProgressIndicator()),
                );
              }
              final sessions = snapshot.data ?? const [];
              if (sessions.isEmpty) {
                return const Padding(
                  padding: EdgeInsets.all(20),
                  child: Center(
                      child: Text('Bu müşteride paket seansı yok.',
                          style: TextStyle(color: AppColors.muted))),
                );
              }
              return Column(
                children: [for (final s in sessions) _sessionRow(s)],
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _sessionRow(Map<String, dynamic> s) {
    final total = (s['totalSessions'] as num?)?.toInt() ?? 0;
    final used = (s['usedSessions'] as num?)?.toInt() ?? 0;
    final remaining = (s['remainingSessions'] as num?)?.toInt() ?? (total - used);
    final ratio = total == 0 ? 0.0 : (used / total).clamp(0.0, 1.0);
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                    valueOf(s, const ['serviceName'], fallback: 'Hizmet'),
                    style: const TextStyle(fontWeight: FontWeight.w800)),
              ),
              Text('$remaining kaldı',
                  style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      color: AppColors.primaryDark)),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: LinearProgressIndicator(
              value: ratio,
              minHeight: 8,
              backgroundColor: AppColors.surfaceSoft,
              color: AppColors.primary,
            ),
          ),
          const SizedBox(height: 6),
          Text('$used / $total seans kullanıldı',
              style: const TextStyle(fontSize: 12, color: AppColors.muted)),
        ],
      ),
    );
  }
}
