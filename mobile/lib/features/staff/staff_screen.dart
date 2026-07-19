import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/crud/crud_options.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/json_helpers.dart';
import '../../shared/photo_utils.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import 'package:go_router/go_router.dart';

import 'staff_role_sheet.dart';
import 'staff_working_hours_sheet.dart';

/// Personel & Roller — web `personel` sayfasının mobil karşılığı.
///
/// 4 özet kartı + arama + zengin personel kartları (foto/baş harf, randevu,
/// müşteri puanı, bu-ay performans barı, top hizmetler) + personele dokununca
/// rol detayı (haftalık aktivite, yetkiler, başarı) + Rol Düzenle / Şube Aktar
/// / Şifre Sıfırla / Sil. Per-personel istatistikler randevulardan hesaplanır.
class StaffScreen extends StatefulWidget {
  const StaffScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<StaffScreen> createState() => _StaffScreenState();
}

const _permLabels = <String, String>{
  'Appointments': 'Randevular',
  'Customers': 'Müşteriler',
  'Packages': 'Paketler',
  'Services': 'Hizmetler',
  'Stock': 'Stok',
  'Inventory': 'Stok',
  'Reports': 'Raporlar',
  'Audit': 'Raporlar',
  'Finance': 'Finans',
  'Cash': 'Kasa',
  'Accounts': 'Ön Muhasebe',
  'Notifications': 'Bildirimler',
  'Notification': 'Bildirimler',
  'Expenses': 'Giderler',
  'Logs': 'Loglar',
  'Staff': 'Personel',
  'Branch': 'Şubeler',
  'Service': 'Hizmetler',
  'Campaign': 'Kampanyalar',
};

String _permLabel(String key) => _permLabels[key] ?? key;

const _days = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

class _StaffScreenState extends State<StaffScreen> {
  late Future<_StaffData> _future;
  String _query = '';

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_StaffData> _load() async {
    final results = await Future.wait<dynamic>([
      widget.api
          .get('/api/admin/staff/', query: {'page': 1, 'pageSize': 200})
          .catchError((_) => const <dynamic>[]),
      widget.api
          .get('/api/admin/appointments/',
              query: {'page': 1, 'pageSize': 500})
          .catchError((_) => const <dynamic>[]),
    ]);
    return _StaffData(
      staff: apiItems(results[0]),
      appts: apiItems(results[1]),
    );
  }

  Future<void> _reload() async {
    setState(() => _future = _load());
    await _future;
  }

  List<String> _perms(Map<String, dynamic> s) {
    final raw = s['permissions'];
    if (raw is Iterable) {
      return raw.map((e) => '$e').where((e) => e.isNotEmpty).toList();
    }
    return const [];
  }

  _Stat _statOf(String staffId, List<Map<String, dynamic>> appts) {
    final now = DateTime.now();
    final monthStart = DateTime(now.year, now.month, 1);
    final since30 = now.subtract(const Duration(days: 30));
    var total = 0, completed = 0, monthCompleted = 0, monthResolved = 0;
    final weekly = List<int>.filled(7, 0);
    final services = <String, int>{};
    for (final a in appts) {
      if ('${a['staffMemberId']}' != staffId) continue;
      total++;
      final status = '${a['status']}';
      final d = parseUtcToLocal(a['startUtc']);
      final inMonth = d != null && d.isAfter(monthStart);
      if (status == 'Completed') {
        completed++;
        if (inMonth) {
          monthCompleted++;
          monthResolved++;
        }
      } else if (status == 'Cancelled' || status == 'NoShow') {
        if (inMonth) monthResolved++;
      }
      if (d != null && d.isAfter(since30)) {
        weekly[(d.weekday - 1).clamp(0, 6)]++;
      }
      final svc = valueOf(a, const ['serviceName'], fallback: '');
      if (svc.isNotEmpty && svc != '—') {
        services[svc] = (services[svc] ?? 0) + 1;
      }
    }
    final successRate =
        monthResolved > 0 ? (monthCompleted / monthResolved * 100).round() : 0;
    final topServices = (services.entries.toList()
          ..sort((a, b) => b.value.compareTo(a.value)))
        .take(3)
        .map((e) => e.key)
        .toList();
    return _Stat(
      total: total,
      completed: completed,
      monthCompleted: monthCompleted,
      successRate: successRate,
      weekly: weekly,
      topServices: topServices,
    );
  }

  // --- Aksiyonlar ---

  Future<void> _create() async {
    // Stitch tasarımlı personel editörü — Rol Düzenle ile aynı ekran (create modu).
    final body = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => StaffRoleSheet(api: widget.api, isCreate: true),
    );
    if (body == null) return;
    try {
      final created = await widget.api.post('/api/admin/staff/', body);
      await _reload();
      if (mounted) _showCredentials(created);
    } catch (e) {
      _toast('$e');
    }
  }

  void _showCredentials(dynamic result) {
    final data = result is Map ? result.cast<String, dynamic>() : null;
    final cred = data?['credentials'] is Map
        ? (data!['credentials'] as Map).cast<String, dynamic>()
        : (data?['initialPassword'] != null ? data : null);
    if (cred == null || !mounted) return;
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Giriş bilgileri'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
                'Bu bilgiler yalnızca bir kez gösterilir. Personele iletin.'),
            const SizedBox(height: 12),
            SelectableText('E-posta: ${cred['email'] ?? '—'}'),
            const SizedBox(height: 4),
            SelectableText('Şifre: ${cred['initialPassword'] ?? '—'}'),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Clipboard.setData(ClipboardData(
                text:
                    '${cred['email'] ?? ''} / ${cred['initialPassword'] ?? ''}')),
            child: const Text('Kopyala'),
          ),
          FilledButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Tamam')),
        ],
      ),
    );
  }

  Future<void> _openDetail(Map<String, dynamic> s, _Stat stat) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _StaffDetailSheet(
        api: widget.api,
        staff: s,
        stat: stat,
        onCredentials: _showCredentials,
      ),
    );
    if (changed == true) _reload();
  }

  void _toast(String msg) {
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  // --- Görünüm ---

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        floatingActionButton: FloatingActionButton.extended(
          onPressed: _create,
          icon: const Icon(Icons.person_add_alt_1_rounded),
          label: const Text('Personel ekle'),
        ),
        body: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: _reload,
            child: FutureBuilder<_StaffData>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done &&
                    !snapshot.hasData) {
                  return const Center(child: CircularProgressIndicator());
                }
                final data = snapshot.data ??
                    const _StaffData(staff: [], appts: []);
                final all = data.staff;
                final active = all.where((s) => s['isActive'] != false).length;
                final permKeys = <String>{};
                for (final s in all) {
                  permKeys.addAll(_perms(s));
                }
                final filtered = _query.isEmpty
                    ? all
                    : all
                        .where((s) => valueOf(s, const ['fullName', 'name'])
                            .toLowerCase()
                            .contains(_query))
                        .toList();
                return ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 110),
                  children: [
                    const PageHeader(
                      eyebrow: 'Yönetim',
                      title: 'Personel & Roller',
                      subtitle: 'Kadro, rol, yetki ve performans görünümü.',
                    ),
                    const SizedBox(height: 16),
                    _statsRow(all.length, active, permKeys.length),
                    const SizedBox(height: 14),
                    TextField(
                      onChanged: (v) =>
                          setState(() => _query = v.trim().toLowerCase()),
                      decoration: const InputDecoration(
                        isDense: true,
                        prefixIcon: Icon(Icons.search_rounded, size: 18),
                        hintText: 'Personel ara…',
                      ),
                    ),
                    const SizedBox(height: 12),
                    if (filtered.isEmpty)
                      _empty()
                    else
                      for (final s in filtered)
                        _staffCard(s, _statOf('${s['id']}', data.appts)),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _statsRow(int total, int active, int permSets) {
    return Row(
      children: [
        _statCard('Toplam', '$total', Icons.groups_rounded, AppColors.primary),
        const SizedBox(width: 8),
        _statCard('Aktif', '$active', Icons.how_to_reg_rounded,
            AppColors.success),
        const SizedBox(width: 8),
        _statCard('Pasif', '${total - active}', Icons.person_off_rounded,
            const Color(0xFF7C5CBF)),
        const SizedBox(width: 8),
        _statCard('Yetki seti', '$permSets', Icons.shield_rounded,
            AppColors.danger),
      ],
    );
  }

  Widget _statCard(String label, String value, IconData icon, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 11),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          children: [
            Icon(icon, size: 18, color: color),
            const SizedBox(height: 6),
            Text(value,
                style: const TextStyle(
                    fontSize: 18, fontWeight: FontWeight.w800)),
            Text(label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 9.5, color: AppColors.muted)),
          ],
        ),
      ),
    );
  }

  Widget _staffCard(Map<String, dynamic> s, _Stat stat) {
    final name = valueOf(s, const ['fullName', 'name'], fallback: 'Personel');
    final role = valueOf(s, const ['title', 'role'], fallback: '');
    final dept = valueOf(s, const ['specialties', 'dept'], fallback: '');
    final active = s['isActive'] != false;
    final rating = (s['averageRating'] as num?)?.toDouble();
    final ratingCount = (s['ratingCount'] as num?)?.toInt() ?? 0;

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: () => _openDetail(s, stat),
          child: Container(
            padding: const EdgeInsets.all(13),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              children: [
                Row(
                  children: [
                    _avatar(name, s['photoUrl'], 52),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontSize: 16, fontWeight: FontWeight.w800)),
                          if (role.isNotEmpty && role != '—')
                            Text(role.toUpperCase(),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontSize: 9.5,
                                    letterSpacing: .8,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.primaryDark)),
                          if (dept.isNotEmpty && dept != '—')
                            Text(dept,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontSize: 11, color: AppColors.muted)),
                        ],
                      ),
                    ),
                    _statusBadge(active),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    _miniStat(Icons.calendar_month_rounded, AppColors.primary,
                        'Randevu', '${stat.total}'),
                    const SizedBox(width: 8),
                    _miniStat(Icons.star_rounded, const Color(0xFFD8AD55),
                        'Müşteri Skoru',
                        rating != null
                            ? '${rating.toStringAsFixed(1)} / 5${ratingCount > 0 ? ' · $ratingCount' : ''}'
                            : '—'),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Performans (Bu Ay)',
                        style:
                            TextStyle(fontSize: 10, color: AppColors.muted)),
                    Text('${stat.monthCompleted} iş · %${stat.successRate}',
                        style: const TextStyle(
                            fontSize: 10.5,
                            fontWeight: FontWeight.w700,
                            color: AppColors.ink)),
                  ],
                ),
                const SizedBox(height: 5),
                ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: stat.successRate / 100,
                    minHeight: 6,
                    backgroundColor: AppColors.surfaceSoft,
                    color: AppColors.primary,
                  ),
                ),
                if (stat.topServices.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        for (final svc in stat.topServices)
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 7, vertical: 3),
                            decoration: BoxDecoration(
                              color: AppColors.surfaceSoft,
                              borderRadius: BorderRadius.circular(7),
                            ),
                            child: Text('⚡ $svc',
                                style: const TextStyle(
                                    fontSize: 9.5, color: AppColors.ink)),
                          ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _miniStat(IconData icon, Color color, String label, String value) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: AppColors.surfaceSoft.withValues(alpha: .5),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            Icon(icon, size: 16, color: color),
            const SizedBox(width: 7),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 8.5, color: AppColors.muted)),
                  Text(value,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 13, fontWeight: FontWeight.w800)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _statusBadge(bool active) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: (active ? AppColors.success : AppColors.danger)
              .withValues(alpha: .12),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(active ? 'Aktif' : 'Pasif',
            style: TextStyle(
                fontSize: 9.5,
                fontWeight: FontWeight.w800,
                color: active ? AppColors.success : AppColors.danger)),
      );

  Widget _empty() => Padding(
        padding: const EdgeInsets.symmetric(vertical: 40),
        child: Center(
          child: Column(
            children: [
              Icon(Icons.badge_outlined,
                  size: 44, color: AppColors.primary.withValues(alpha: .5)),
              const SizedBox(height: 12),
              const Text('Personel bulunamadı.',
                  style: TextStyle(color: AppColors.muted, fontSize: 13)),
            ],
          ),
        ),
      );

  Widget _avatar(String name, dynamic photoUrl, double size) {
    final photo = imageProviderOf(photoUrl);
    final initials = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .take(2)
        .map((p) => p[0].toUpperCase())
        .join();
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFFBD2DC), Color(0xFFFFF0F5)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(size * 0.28),
        border: Border.all(color: AppColors.border),
        image: photo != null
            ? DecorationImage(image: photo, fit: BoxFit.cover)
            : null,
      ),
      child: photo == null
          ? Text(initials.isEmpty ? '•' : initials,
              style: TextStyle(
                  color: AppColors.primaryDark,
                  fontWeight: FontWeight.w900,
                  fontSize: size * 0.32))
          : null,
    );
  }
}

class _StaffData {
  const _StaffData({required this.staff, required this.appts});
  final List<Map<String, dynamic>> staff;
  final List<Map<String, dynamic>> appts;
}

class _Stat {
  const _Stat({
    required this.total,
    required this.completed,
    required this.monthCompleted,
    required this.successRate,
    required this.weekly,
    required this.topServices,
  });
  final int total;
  final int completed;
  final int monthCompleted;
  final int successRate;
  final List<int> weekly;
  final List<String> topServices;
}

// ===========================================================================
// Rol detayı alt-sayfası
// ===========================================================================
class _StaffDetailSheet extends StatefulWidget {
  const _StaffDetailSheet({
    required this.api,
    required this.staff,
    required this.stat,
    required this.onCredentials,
  });
  final ApiClient api;
  final Map<String, dynamic> staff;
  final _Stat stat;
  final void Function(dynamic) onCredentials;

  @override
  State<_StaffDetailSheet> createState() => _StaffDetailSheetState();
}

class _StaffDetailSheetState extends State<_StaffDetailSheet> {
  late Map<String, dynamic> s = Map.of(widget.staff);
  bool _changed = false;

  List<String> get _perms {
    final raw = s['permissions'];
    if (raw is Iterable) {
      return raw.map((e) => '$e').where((e) => e.isNotEmpty).toList();
    }
    return const [];
  }

  void _toast(String msg) {
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  Future<void> _edit() async {
    // Stitch tasarımlı rol/yetki editörü — sayfa switch'i + işlem çipleri.
    final body = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => StaffRoleSheet(api: widget.api, staff: s),
    );
    if (body == null) return;
    try {
      await widget.api.put('/api/admin/staff/${s['id']}', body);
      _changed = true;
      // Görseli tazele
      try {
        final fresh = await widget.api.get('/api/admin/staff/${s['id']}');
        if (mounted && fresh is Map) {
          setState(() => s = fresh.cast<String, dynamic>());
        }
      } catch (_) {}
      _toast('Personel güncellendi.');
    } catch (e) {
      _toast('$e');
    }
  }

  /// Haftalık çalışma saatleri (mesai penceresi) — dışına randevu alınamaz.
  Future<void> _workingHours() async {
    await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => StaffWorkingHoursSheet(
        api: widget.api,
        staffId: '${s['id']}',
        staffName: valueOf(s, const ['fullName', 'name'], fallback: 'Personel'),
      ),
    );
  }

  /// Avatara dokununca kamera/galeri ile fotoğraf çek/seç ve ANINDA kaydet
  /// (web personel sayfasındaki uploadStaffPhoto akışının mobil karşılığı).
  Future<void> _changePhoto() async {
    final current = '${s['photoUrl'] ?? ''}';
    final result = await pickPhotoDataUrl(context,
        allowRemove: current.isNotEmpty && current != 'null');
    if (result == null) return; // vazgeçildi
    try {
      await widget.api.put('/api/admin/staff/${s['id']}', {
        'fullName': s['fullName'],
        'title': s['title'],
        'phone': s['phone'],
        'specialties': s['specialties'],
        'commissionRate': s['commissionRate'],
        'isActive': s['isActive'] != false,
        'permissions': _perms,
        'photoUrl': result, // '' → backend fotoğrafı kaldırır
      });
      _changed = true;
      setState(() => s['photoUrl'] = result.isEmpty ? null : result);
      _toast(result.isEmpty ? 'Fotoğraf kaldırıldı.' : 'Fotoğraf güncellendi.');
    } catch (e) {
      _toast('$e');
    }
  }

  Future<void> _transfer() async {
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: 'Şube aktar',
        icon: Icons.swap_horiz_rounded,
        fields: [
          CrudField(
            key: 'branchId',
            label: 'Hedef şube',
            type: CrudFieldType.select,
            required: true,
            optionsLoader: CrudOptions(widget.api).branches,
          ),
        ],
      ),
    );
    final body = result?.body;
    if (body == null) return;
    try {
      await widget.api
          .post('/api/admin/staff/${s['id']}/transfer-branch', body);
      _changed = true;
      _toast('Personel aktarıldı.');
    } catch (e) {
      _toast('$e');
    }
  }

  /// Cihaz güvenliği: tanımlı cihazlar + limit + kurum aç/kapat (web paritesi).
  Future<void> _devices() async {
    final tenantUserId = '${s['tenantUserId'] ?? ''}';
    if (tenantUserId.isEmpty || tenantUserId == 'null') {
      _toast('Bu personelin kullanıcı hesabı bulunamadı.');
      return;
    }
    // Personel detayı zaten modal sheet; üstüne ikinci sheet yerine tam sayfa
    // (go_router rotası — diğer ekranlarla aynı gezinme yolu).
    await GoRouter.of(context).push('/staff-devices', extra: {
      'tenantUserId': tenantUserId,
      'staffName': '${s['fullName'] ?? 'Personel'}',
    });
  }

  Future<void> _resetPassword() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('${s['fullName'] ?? 'Personel'} · şifre sıfırlansın mı?'),
        content: const Text(
            'Yeni geçici şifre üretilir, aktif oturumlar kapanır ve ilk girişte değiştirmesi zorunlu olur. Şifre yalnızca bir kez gösterilir.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Vazgeç')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Şifreyi sıfırla')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      final creds =
          await widget.api.post('/api/admin/staff/${s['id']}/reset-password');
      if (mounted) widget.onCredentials(creds);
    } catch (e) {
      _toast('$e');
    }
  }

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Personeli sil'),
        content: Text('${s['fullName'] ?? 'Personel'} silinsin mi?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Vazgeç')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sil'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await widget.api.delete('/api/admin/staff/${s['id']}');
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      _toast('$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final name = valueOf(s, const ['fullName', 'name'], fallback: 'Personel');
    final role = valueOf(s, const ['title', 'role'], fallback: '');
    final dept = valueOf(s, const ['specialties', 'dept'], fallback: '');
    final active = s['isActive'] != false;
    final rating = (s['averageRating'] as num?)?.toDouble();
    final ratingCount = (s['ratingCount'] as num?)?.toInt() ?? 0;
    final perms = _perms;
    final stat = widget.stat;

    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      constraints:
          BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.92),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(
              20, 14, 20, MediaQuery.viewInsetsOf(context).bottom + 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  GestureDetector(
                    onTap: _changePhoto,
                    child: Stack(
                      clipBehavior: Clip.none,
                      children: [
                        _avatar(name, 56),
                        Positioned(
                          right: -3,
                          bottom: -3,
                          child: Container(
                            width: 21,
                            height: 21,
                            decoration: BoxDecoration(
                              color: AppColors.primary,
                              shape: BoxShape.circle,
                              border:
                                  Border.all(color: Colors.white, width: 2),
                            ),
                            child: const Icon(Icons.photo_camera_rounded,
                                size: 11, color: Colors.white),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(name,
                            style: const TextStyle(
                                fontSize: 19, fontWeight: FontWeight.w800)),
                        Text(
                            [role, dept]
                                .where((x) => x.isNotEmpty && x != '—')
                                .join(' · '),
                            style: const TextStyle(
                                fontSize: 11.5, color: AppColors.muted)),
                      ],
                    ),
                  ),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                    decoration: BoxDecoration(
                      color: (active ? AppColors.success : AppColors.danger)
                          .withValues(alpha: .12),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(active ? 'Aktif' : 'Pasif',
                        style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
                            color: active ? AppColors.success : AppColors.danger)),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  _bigStat('Randevu', '${stat.total}', AppColors.primary),
                  const SizedBox(width: 8),
                  _bigStat(
                      'Müşteri Skoru',
                      rating != null ? rating.toStringAsFixed(1) : '—',
                      const Color(0xFFD8AD55),
                      sub: ratingCount > 0 ? '$ratingCount değerlendirme' : '/5'),
                  const SizedBox(width: 8),
                  _bigStat('Yetki', '${perms.length}', AppColors.primaryDark),
                  const SizedBox(width: 8),
                  _bigStat('Başarı', '%${stat.successRate}', AppColors.success),
                ],
              ),
              const SizedBox(height: 16),
              _label('Haftalık Aktivite'),
              const SizedBox(height: 8),
              _weeklyBars(stat.weekly),
              const SizedBox(height: 16),
              _label(
                  'Yetkiler (${perms.where((p) => !p.contains('.')).length} sayfa · ${perms.where((p) => p.contains('.')).length} işlem)'),
              const SizedBox(height: 8),
              if (perms.isEmpty)
                const Text('Yetki tanımlı değil.',
                    style: TextStyle(color: AppColors.muted, fontSize: 12.5))
              else
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    // Çip olarak yalnız sayfa yetkileri; işlem ayrıntısı Rol Düzenle'de.
                    for (final p in perms.where((p) => !p.contains('.')))
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 9, vertical: 5),
                        decoration: BoxDecoration(
                          color: AppColors.surfaceSoft,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: AppColors.border),
                        ),
                        child: Text(_permLabel(p),
                            style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                color: AppColors.primaryDark)),
                      ),
                  ],
                ),
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: _edit,
                      icon: const Icon(Icons.manage_accounts_rounded, size: 18),
                      label: const Text('Rol Düzenle'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _transfer,
                      icon: const Icon(Icons.swap_horiz_rounded, size: 18),
                      label: const Text('Şube Aktar'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: _workingHours,
                  icon: const Icon(Icons.schedule_rounded, size: 18),
                  label: const Text('Çalışma Saatleri'),
                ),
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: _devices,
                  icon: const Icon(Icons.devices_rounded, size: 18),
                  label: const Text('Cihazlar (Cihaz Güvenliği)'),
                ),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _resetPassword,
                      icon: const Icon(Icons.lock_reset_rounded, size: 18),
                      label: const Text('Şifre Sıfırla'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.danger),
                      onPressed: _delete,
                      icon: const Icon(Icons.person_remove_rounded, size: 18),
                      label: const Text('Sil'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Center(
                child: TextButton(
                  onPressed: () => Navigator.pop(context, _changed),
                  child: const Text('Kapat'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _bigStat(String label, String value, Color color, {String? sub}) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 11),
        decoration: BoxDecoration(
          color: AppColors.surfaceSoft.withValues(alpha: .5),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          children: [
            Text(value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: 17, fontWeight: FontWeight.w900, color: color)),
            const SizedBox(height: 2),
            Text(label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 9, color: AppColors.muted)),
            if (sub != null)
              Text(sub,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 8, color: AppColors.muted)),
          ],
        ),
      ),
    );
  }

  Widget _weeklyBars(List<int> weekly) {
    final max = weekly.fold<int>(1, (m, v) => v > m ? v : m);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceSoft.withValues(alpha: .5),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: SizedBox(
        height: 84,
        child: Row(
          children: [
            for (var i = 0; i < 7; i++)
              Expanded(
                child: Column(
                  children: [
                    Text('${weekly[i]}',
                        style: const TextStyle(
                            fontSize: 8.5,
                            color: AppColors.muted,
                            fontWeight: FontWeight.w700)),
                    const SizedBox(height: 3),
                    Expanded(
                      child: Align(
                        alignment: Alignment.bottomCenter,
                        child: FractionallySizedBox(
                          heightFactor: (weekly[i] / max).clamp(0.07, 1.0),
                          widthFactor: 0.5,
                          child: const DecoratedBox(
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                begin: Alignment.bottomCenter,
                                end: Alignment.topCenter,
                                colors: [Color(0xFFE0617F), Color(0xFFF3A3BF)],
                              ),
                              borderRadius: BorderRadius.vertical(
                                  top: Radius.circular(4)),
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(_days[i],
                        style: const TextStyle(
                            fontSize: 8, color: AppColors.muted)),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _label(String t) => Text(t,
      style: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w800,
          letterSpacing: .4,
          color: AppColors.muted));

  Widget _avatar(String name, double size) {
    final photo = imageProviderOf(s['photoUrl']);
    final initials = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .take(2)
        .map((p) => p[0].toUpperCase())
        .join();
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFFBD2DC), Color(0xFFFFF0F5)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(size * 0.28),
        border: Border.all(color: AppColors.border),
        image: photo != null
            ? DecorationImage(image: photo, fit: BoxFit.cover)
            : null,
      ),
      child: photo == null
          ? Text(initials.isEmpty ? '•' : initials,
              style: TextStyle(
                  color: AppColors.primaryDark,
                  fontWeight: FontWeight.w900,
                  fontSize: size * 0.34))
          : null,
    );
  }
}
