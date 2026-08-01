import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/crud/crud_options.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/export/export_helper.dart';
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

/// Yetki kataloğu — `/api/admin/staff/permissions` (web personel sayfasıyla aynı kaynak).
/// Etiketler artık sabit haritadan değil backend'den gelir; sayfa + altındaki işlemler.
class _PermAction {
  const _PermAction(this.key, this.label);
  final String key;
  final String label;
}

class _PermPage {
  const _PermPage(this.key, this.label, this.description, this.actions);
  final String key;
  final String label;
  final String description;
  final List<_PermAction> actions;
}

List<_PermPage> _parseCatalog(dynamic data) => apiItems(data).map((p) {
      final raw = p['actions'];
      final actions = raw is Iterable
          ? raw
              .whereType<Map>()
              .map((a) => _PermAction('${a['key']}', '${a['label']}'))
              .toList(growable: false)
          : const <_PermAction>[];
      return _PermPage('${p['key']}', valueOf(p, const ['label', 'key']),
          '${p['description'] ?? ''}', actions);
    }).toList(growable: false);

/// Katalog gelmezse / katalog dışı (eski, özel) anahtarlar için yedek etiketler.
const _legacyPermLabels = <String, String>{
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
  'Logs': 'Loglar',
  'Staff': 'Personel',
  'Branch': 'Şubeler',
};

const _pageIcons = <String, IconData>{
  'Customers': Icons.group_rounded,
  'Appointments': Icons.calendar_month_rounded,
  'Waitlist': Icons.hourglass_top_rounded,
  'Services': Icons.workspaces_rounded,
  'GiftCards': Icons.card_giftcard_rounded,
  'Stock': Icons.inventory_2_rounded,
  'CashRegister': Icons.account_balance_wallet_rounded,
  'CashClosing': Icons.fact_check_rounded,
  'Accounting': Icons.account_balance_rounded,
  'Reports': Icons.bar_chart_rounded,
  'Notifications': Icons.notifications_active_rounded,
  'Logs': Icons.history_rounded,
  'Settings': Icons.settings_rounded,
};

IconData _permIcon(String key) => _pageIcons[key] ?? Icons.shield_rounded;

String _permLabel(List<_PermPage> catalog, String key) {
  for (final p in catalog) {
    if (p.key == key) return p.label;
  }
  return _legacyPermLabels[key] ?? key;
}

/// Sayfa yetkisinin durumu: 0 kapalı · 1 kısmi · 2 tam.
/// Eski kayıt (sayfa açık ama hiç işlem anahtarı yazılı değil) backend'de tam yetkili
/// sayılır (Permissions.IsActionAllowed) — burada da tam gösterilir.
class _PermCell {
  const _PermCell(this.state, this.granted, this.total);
  final int state;
  final int granted;
  final int total;
}

_PermCell _permCell(Set<String> perms, _PermPage page) {
  final total = page.actions.length;
  if (!perms.contains(page.key)) return _PermCell(0, 0, total);
  if (total == 0) return const _PermCell(2, 0, 0);
  final granted = page.actions.where((a) => perms.contains(a.key)).length;
  if (granted == 0) return _PermCell(2, total, total);
  return _PermCell(granted == total ? 2 : 1, granted, total);
}

const _gold = Color(0xFFD8AD55);
const _rose = Color(0xFFC85776);

/// Türkçe ondalık (5.0 → "5,0").
String _fmt1(double v) => v.toStringAsFixed(1).replaceAll('.', ',');

/// Personelin bir işleme sahip olup olmadığı — eski kayıtta (sayfa açık, hiç işlem
/// anahtarı yok) backend tam yetkili sayar, burada da öyle sayılır.
bool _hasAction(Set<String> perms, _PermPage page, _PermAction action) {
  if (perms.contains(action.key)) return true;
  if (!perms.contains(page.key)) return false;
  return !page.actions.any((a) => perms.contains(a.key));
}

/// Kesirli dolan 5 yıldız (web `Stars` karşılığı).
Widget _starRow(double? value, {double size = 13}) {
  final v = value ?? 0;
  return Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      for (var i = 0; i < 5; i++)
        Icon(
          v >= i + 1
              ? Icons.star_rounded
              : (v > i ? Icons.star_half_rounded : Icons.star_outline_rounded),
          size: size,
          color: v > i ? _gold : AppColors.border,
        ),
    ],
  );
}

const _days = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

/// Kadro sıralaması (web'deki sıralama menüsünün karşılığı).
enum _Sort { performance, name, rating, appointments }

const _sortLabels = <_Sort, String>{
  _Sort.performance: 'Bu ayın performansı',
  _Sort.name: 'Ada göre (A→Z)',
  _Sort.rating: 'Müşteri puanı',
  _Sort.appointments: 'Randevu sayısı',
};

class _StaffScreenState extends State<StaffScreen> {
  late Future<_StaffData> _future;
  String _query = '';
  _Sort _sort = _Sort.performance;
  // 0 = Kadro, 1 = Yetki kapsamı (web'deki "Yetki Seti" kapsamının mobil karşılığı).
  int _tab = 0;

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
      widget.api
          .get('/api/admin/staff/permissions')
          .catchError((_) => const <dynamic>[]),
    ]);
    return _StaffData(
      staff: apiItems(results[0]),
      appts: apiItems(results[1]),
      catalog: _parseCatalog(results[2]),
    );
  }

  /// Kadro listesini Excel/PDF olarak dışa aktarır (web personel sayfası paritesi).
  Future<void> _exportStaff(List<Map<String, dynamic>> all) async {
    await ExportHelper.showMenu(
      context,
      title: 'Personel Listesi',
      subtitle: 'Kadro, unvan, iletişim ve durum',
      headers: const ['Ad Soyad', 'Unvan', 'Telefon', 'Uzmanlık', 'Komisyon', 'Durum'],
      rows: all.map((s) {
        final rate = numberOf(s, const ['commissionRate']);
        return [
          valueOf(s, const ['fullName'], fallback: 'Personel'),
          valueOf(s, const ['title'], fallback: ''),
          valueOf(s, const ['phone'], fallback: ''),
          valueOf(s, const ['specialties'], fallback: ''),
          rate > 0 ? '%${rate.toStringAsFixed(0)}' : '',
          s['isActive'] == false ? 'Pasif' : 'Aktif',
        ];
      }).toList(),
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
      resolved: monthResolved,
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

  Future<void> _openDetail(
      Map<String, dynamic> s, _Stat stat, List<_PermPage> catalog) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _StaffDetailSheet(
        api: widget.api,
        staff: s,
        stat: stat,
        catalog: catalog,
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
                final stats = <String, _Stat>{
                  for (final s in all)
                    '${s['id']}': _statOf('${s['id']}', data.appts),
                };
                final filtered = _query.isEmpty
                    ? [...all]
                    : all
                        .where((s) => valueOf(s, const ['fullName', 'name'])
                            .toLowerCase()
                            .contains(_query))
                        .toList();
                filtered.sort((a, b) {
                  final sa = stats['${a['id']}'] ?? const _Stat.empty();
                  final sb = stats['${b['id']}'] ?? const _Stat.empty();
                  switch (_sort) {
                    case _Sort.name:
                      return valueOf(a, const ['fullName', 'name'])
                          .compareTo(valueOf(b, const ['fullName', 'name']));
                    case _Sort.rating:
                      return ((b['averageRating'] as num?)?.toDouble() ?? -1)
                          .compareTo(
                              (a['averageRating'] as num?)?.toDouble() ?? -1);
                    case _Sort.appointments:
                      return sb.total.compareTo(sa.total);
                    case _Sort.performance:
                      final byWork =
                          sb.monthCompleted.compareTo(sa.monthCompleted);
                      return byWork != 0
                          ? byWork
                          : sb.successRate.compareTo(sa.successRate);
                  }
                });
                // Ayın en çok iş bitiren personeli (kartta taç rozeti).
                String? topId;
                var topVal = 0;
                for (final s in all) {
                  final v = stats['${s['id']}']?.monthCompleted ?? 0;
                  if (v > topVal) {
                    topVal = v;
                    topId = '${s['id']}';
                  }
                }
                return ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 110),
                  children: [
                    PageHeader(
                      eyebrow: 'Yönetim',
                      title: 'Personel & Roller',
                      subtitle: 'Kadro, rol, yetki ve performans görünümü.',
                      // Excel/PDF dışa aktarma (web personel sayfası paritesi).
                      action: IconButton(
                        tooltip: 'Dışa aktar',
                        color: AppColors.primaryDark,
                        onPressed: () => _exportStaff(all),
                        icon: const Icon(Icons.ios_share_rounded),
                      ),
                    ),
                    const SizedBox(height: 16),
                    _teamPulse(all, stats, data.catalog),
                    const SizedBox(height: 14),
                    _tabs(),
                    const SizedBox(height: 12),
                    if (_tab == 1)
                      _coverageList(all, data.catalog)
                    else ...[
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              onChanged: (v) => setState(
                                  () => _query = v.trim().toLowerCase()),
                              decoration: const InputDecoration(
                                isDense: true,
                                prefixIcon:
                                    Icon(Icons.search_rounded, size: 18),
                                hintText: 'Personel ara…',
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          _sortButton(),
                        ],
                      ),
                      const SizedBox(height: 12),
                      if (filtered.isEmpty)
                        _empty()
                      else
                        for (final s in filtered)
                          _staffCard(
                            s,
                            stats['${s['id']}'] ?? const _Stat.empty(),
                            data.catalog,
                            isTop: topId == '${s['id']}',
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

  /// Ekip panosu — web'deki hero kartın mobil karşılığı: kadro, aktif/pasif
  /// oranı, ekip şeridi ve 4 gerçek metrik (bu ay, başarı, puan, yetki kapsamı).
  Widget _teamPulse(List<Map<String, dynamic>> all, Map<String, _Stat> stats,
      List<_PermPage> catalog) {
    final total = all.length;
    final active = all.where((s) => s['isActive'] != false).length;
    var monthCompleted = 0, monthResolved = 0;
    var ratingSum = 0.0, ratingWeight = 0;
    for (final s in all) {
      final st = stats['${s['id']}'];
      if (st != null) {
        monthCompleted += st.monthCompleted;
        monthResolved += st.resolved;
      }
      final r = (s['averageRating'] as num?)?.toDouble();
      final c = (s['ratingCount'] as num?)?.toInt() ?? 0;
      if (r != null && c > 0) {
        ratingSum += r * c;
        ratingWeight += c;
      }
    }
    final successRate =
        monthResolved > 0 ? (monthCompleted / monthResolved * 100).round() : 0;
    final rating = ratingWeight > 0 ? ratingSum / ratingWeight : 0.0;
    final granted = <String>{};
    for (final s in all) {
      granted.addAll(_perms(s).where((k) => !k.contains('.')));
    }
    final covered =
        catalog.where((p) => granted.contains(p.key)).length;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.auto_awesome_rounded, size: 15, color: _rose),
              const SizedBox(width: 6),
              const Text('EKİP PANOSU',
                  style: TextStyle(
                      fontSize: 10.5,
                      letterSpacing: 1.2,
                      fontWeight: FontWeight.w800,
                      color: _rose)),
              const Spacer(),
              if (total > 0) _avatarStrip(all),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text('$total',
                  style: const TextStyle(
                      fontSize: 32, fontWeight: FontWeight.w900)),
              const SizedBox(width: 7),
              const Text('kişilik kadro',
                  style: TextStyle(fontSize: 12.5, color: AppColors.muted)),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('$active aktif',
                  style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: AppColors.success)),
              Text('${total - active} pasif / izinli',
                  style: const TextStyle(
                      fontSize: 11, color: AppColors.muted)),
            ],
          ),
          const SizedBox(height: 5),
          ClipRRect(
            borderRadius: BorderRadius.circular(5),
            child: LinearProgressIndicator(
              value: total > 0 ? active / total : 0,
              minHeight: 8,
              backgroundColor: const Color(0xFFF4E6EC),
              color: AppColors.success,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _pulseTile('Bu ay iş', '$monthCompleted', AppColors.primary),
              const SizedBox(width: 8),
              _pulseTile('Başarı', '%$successRate', AppColors.success),
              const SizedBox(width: 8),
              _pulseTile(
                  'Puan', ratingWeight > 0 ? _fmt1(rating) : '—', _gold),
              const SizedBox(width: 8),
              _pulseTile('Yetki kapsamı',
                  catalog.isEmpty ? '—' : '$covered/${catalog.length}', _rose),
            ],
          ),
        ],
      ),
    );
  }

  Widget _avatarStrip(List<Map<String, dynamic>> all) {
    final shown = all.take(4).toList();
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final s in shown)
          Padding(
            padding: const EdgeInsets.only(left: 3),
            child: _avatar(
                valueOf(s, const ['fullName', 'name'], fallback: 'P'),
                s['photoUrl'],
                26),
          ),
        if (all.length > shown.length)
          Padding(
            padding: const EdgeInsets.only(left: 4),
            child: Text('+${all.length - shown.length}',
                style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primaryDark)),
          ),
      ],
    );
  }

  Widget _pulseTile(String label, String value, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 9),
        decoration: BoxDecoration(
          color: AppColors.surfaceSoft.withValues(alpha: .45),
          borderRadius: BorderRadius.circular(13),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          children: [
            Text(value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: 16, fontWeight: FontWeight.w900, color: color)),
            const SizedBox(height: 2),
            Text(label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 9.5, color: AppColors.muted)),
          ],
        ),
      ),
    );
  }

  /// Kadro ↔ Yetki kapsamı sekmesi (web'deki kapsam sekmelerinin karşılığı).
  Widget _tabs() {
    Widget tab(int i, String label, IconData icon) {
      final on = _tab == i;
      return Expanded(
        child: GestureDetector(
          onTap: () => setState(() => _tab = i),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            padding: const EdgeInsets.symmetric(vertical: 9),
            decoration: BoxDecoration(
              color: on ? _rose : Colors.transparent,
              borderRadius: BorderRadius.circular(11),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon,
                    size: 15,
                    color: on ? Colors.white : AppColors.muted),
                const SizedBox(width: 6),
                Text(label,
                    style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: on ? Colors.white : AppColors.ink)),
              ],
            ),
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(children: [
        tab(0, 'Kadro', Icons.groups_rounded),
        tab(1, 'Yetki kapsamı', Icons.verified_user_rounded),
      ]),
    );
  }

  Widget _sortButton() {
    return PopupMenuButton<_Sort>(
      initialValue: _sort,
      tooltip: 'Sırala',
      onSelected: (v) => setState(() => _sort = v),
      itemBuilder: (_) => [
        for (final e in _sortLabels.entries)
          PopupMenuItem(value: e.key, child: Text(e.value)),
      ],
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 11),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.border),
        ),
        child: const Icon(Icons.swap_vert_rounded,
            size: 19, color: AppColors.primaryDark),
      ),
    );
  }

  /// Hangi sayfa kaç kişide açık? — web'deki "Sayfa Kapsamı" panelinin karşılığı.
  /// (Matris telefon ekranına sığmaz; kapsam listesi aynı bilgiyi taşır.)
  Widget _coverageList(
      List<Map<String, dynamic>> all, List<_PermPage> catalog) {
    if (catalog.isEmpty) {
      return _hint('Yetki kataloğu yüklenemedi.');
    }
    final rows = catalog.map((p) {
      final holders = all
          .where((s) => _perms(s).contains(p.key))
          .toList(growable: false);
      final partial = holders
          .where((s) => _permCell(_perms(s).toSet(), p).state == 1)
          .length;
      return (page: p, holders: holders, partial: partial);
    }).toList()
      ..sort((a, b) => b.holders.length.compareTo(a.holders.length));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final r in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: 9),
            child: Material(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(16),
              child: InkWell(
                borderRadius: BorderRadius.circular(16),
                onTap: () => _openPageSheet(r.page, r.holders),
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 34,
                        height: 34,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: AppColors.surfaceSoft,
                          borderRadius: BorderRadius.circular(11),
                        ),
                        child: Icon(_permIcon(r.page.key),
                            size: 17, color: _rose),
                      ),
                      const SizedBox(width: 11),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(r.page.label,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                          fontSize: 13,
                                          fontWeight: FontWeight.w700)),
                                ),
                                Text(
                                    r.holders.isEmpty
                                        ? 'kimsede yok'
                                        : '${r.holders.length} kişi${r.partial > 0 ? ' · ${r.partial} kısmi' : ''}',
                                    style: const TextStyle(
                                        fontSize: 10.5,
                                        color: AppColors.muted)),
                              ],
                            ),
                            const SizedBox(height: 6),
                            ClipRRect(
                              borderRadius: BorderRadius.circular(4),
                              child: LinearProgressIndicator(
                                value: all.isEmpty
                                    ? 0
                                    : r.holders.length / all.length,
                                minHeight: 6,
                                backgroundColor: const Color(0xFFF4E6EC),
                                color: _rose,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _hint(String text) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Center(
            child: Text(text,
                style: const TextStyle(
                    fontSize: 12.5, color: AppColors.muted))),
      );

  /// Seçili sayfanın dosyası: açıklama, kimlerde açık, işlem kırılımı.
  Future<void> _openPageSheet(
      _PermPage page, List<Map<String, dynamic>> holders) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
        ),
        constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * 0.85),
        child: SafeArea(
          top: false,
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 42,
                      height: 42,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: AppColors.surfaceSoft,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child:
                          Icon(_permIcon(page.key), size: 21, color: _rose),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(page.label,
                              style: const TextStyle(
                                  fontSize: 18, fontWeight: FontWeight.w800)),
                          if (page.description.isNotEmpty)
                            Text(page.description,
                                style: const TextStyle(
                                    fontSize: 11.5, color: AppColors.muted)),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                _label('Sayfayı görebilenler (${holders.length})'),
                const SizedBox(height: 8),
                if (holders.isEmpty)
                  const Text('Bu sayfa hiçbir personele açık değil.',
                      style:
                          TextStyle(fontSize: 12.5, color: AppColors.muted))
                else
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (final h in holders)
                        Builder(builder: (_) {
                          final cell = _permCell(_perms(h).toSet(), page);
                          return Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 9, vertical: 5),
                            decoration: BoxDecoration(
                              color: AppColors.surfaceSoft,
                              borderRadius: BorderRadius.circular(9),
                              border: Border.all(color: AppColors.border),
                            ),
                            child: Text(
                                '${valueOf(h, const ['fullName', 'name'], fallback: 'Personel')}'
                                '${cell.state == 1 ? ' · ${cell.granted}/${cell.total}' : ''}',
                                style: const TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.primaryDark)),
                          );
                        }),
                    ],
                  ),
                const SizedBox(height: 16),
                _label('İşlem yetkileri'),
                const SizedBox(height: 8),
                if (page.actions.isEmpty)
                  const Text(
                      'Bu sayfada ayrı işlem yetkisi yok — sayfa açıksa tam erişim verilir.',
                      style:
                          TextStyle(fontSize: 12.5, color: AppColors.muted))
                else
                  for (final a in page.actions)
                    Builder(builder: (_) {
                      final owners = holders
                          .where((h) =>
                              _hasAction(_perms(h).toSet(), page, a))
                          .toList();
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 9),
                        child: Container(
                          padding: const EdgeInsets.all(11),
                          decoration: BoxDecoration(
                            color: AppColors.surfaceSoft.withValues(alpha: .4),
                            borderRadius: BorderRadius.circular(13),
                            border: Border.all(color: AppColors.border),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(a.label,
                                        style: const TextStyle(
                                            fontSize: 12.5,
                                            fontWeight: FontWeight.w700)),
                                  ),
                                  Text('${owners.length}/${holders.length}',
                                      style: const TextStyle(
                                          fontSize: 11,
                                          color: AppColors.muted)),
                                ],
                              ),
                              const SizedBox(height: 6),
                              ClipRRect(
                                borderRadius: BorderRadius.circular(4),
                                child: LinearProgressIndicator(
                                  value: holders.isEmpty
                                      ? 0
                                      : owners.length / holders.length,
                                  minHeight: 5,
                                  backgroundColor: const Color(0xFFF4E6EC),
                                  color: AppColors.primary,
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    }),
                const SizedBox(height: 6),
                Center(
                  child: TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Kapat'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _label(String t) => Text(t,
      style: const TextStyle(
          fontSize: 11.5,
          fontWeight: FontWeight.w800,
          letterSpacing: .3,
          color: AppColors.muted));

  Widget _staffCard(
      Map<String, dynamic> s, _Stat stat, List<_PermPage> catalog,
      {bool isTop = false}) {
    final name = valueOf(s, const ['fullName', 'name'], fallback: 'Personel');
    final role = valueOf(s, const ['title', 'role'], fallback: '');
    final dept = valueOf(s, const ['specialties', 'dept'], fallback: '');
    final active = s['isActive'] != false;
    final rating = (s['averageRating'] as num?)?.toDouble();
    final ratingCount = (s['ratingCount'] as num?)?.toInt() ?? 0;
    final perms = _perms(s);
    final pageCount = perms.where((k) => !k.contains('.')).length;

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: () => _openDetail(s, stat, catalog),
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
                          Row(
                            children: [
                              Flexible(
                                child: Text(name,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w800)),
                              ),
                              if (isTop) ...[
                                const SizedBox(width: 6),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: _gold.withValues(alpha: .16),
                                    borderRadius: BorderRadius.circular(7),
                                  ),
                                  child: const Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(Icons.workspace_premium_rounded,
                                          size: 11, color: Color(0xFFB88938)),
                                      SizedBox(width: 3),
                                      Text('Ayın 1.',
                                          style: TextStyle(
                                              fontSize: 9,
                                              fontWeight: FontWeight.w800,
                                              color: Color(0xFFB88938))),
                                    ],
                                  ),
                                ),
                              ],
                            ],
                          ),
                          if (role.isNotEmpty && role != '—')
                            Text(role.toUpperCase(),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontSize: 9.5,
                                    letterSpacing: .8,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.primaryDark)),
                          const SizedBox(height: 2),
                          Row(
                            children: [
                              _starRow(rating, size: 12),
                              const SizedBox(width: 5),
                              Text(
                                  rating != null
                                      ? '${_fmt1(rating)}${ratingCount > 0 ? ' · $ratingCount oy' : ''}'
                                      : 'puan yok',
                                  style: const TextStyle(
                                      fontSize: 10.5, color: AppColors.muted)),
                            ],
                          ),
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
                    _miniStat(Icons.check_circle_rounded, AppColors.success,
                        'Bu ay', '${stat.monthCompleted}'),
                    const SizedBox(width: 8),
                    _miniStat(Icons.shield_rounded, _rose, 'Sayfa yetkisi',
                        '$pageCount'),
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
  const _StaffData(
      {required this.staff, required this.appts, this.catalog = const []});
  final List<Map<String, dynamic>> staff;
  final List<Map<String, dynamic>> appts;
  final List<_PermPage> catalog;
}

class _Stat {
  const _Stat({
    required this.total,
    required this.completed,
    required this.monthCompleted,
    required this.successRate,
    required this.weekly,
    required this.topServices,
    this.resolved = 0,
  });
  const _Stat.empty()
      : total = 0,
        completed = 0,
        monthCompleted = 0,
        successRate = 0,
        resolved = 0,
        weekly = const [0, 0, 0, 0, 0, 0, 0],
        topServices = const [];
  final int total;
  final int completed;
  final int monthCompleted;
  final int successRate;

  /// Bu ay sonuçlanan randevu (tamamlanan + iptal/gelmedi) — ekip başarı oranı için.
  final int resolved;
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
    required this.catalog,
    required this.onCredentials,
  });
  final ApiClient api;
  final Map<String, dynamic> staff;
  final _Stat stat;
  final List<_PermPage> catalog;
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

  /// ICS takvim aboneliği linki — Google/Apple takvim "URL ile abone ol".
  Future<void> _calendarLink() async {
    try {
      var res = await widget.api.get('/api/admin/schedule/calendar-link/${s['id']}');
      var url = res is Map ? '${res['url'] ?? ''}' : '';

      // Görüntüleme isteği ARTIK token üretmez (bkz. randevu ekranı) → URL her zaman boş gelir.
      // Üretim yalnızca POST /rotate ile olur.
      if (url.isEmpty) {
        if (!mounted) return;
        final hasActive = res is Map && res['hasActiveLink'] == true;
        final renew = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Takvim bağlantısı'),
            content: Text(
              hasActive
                  ? 'Bu takvim için zaten aktif bir bağlantı var. Güvenlik gereği bağlantı sunucuda '
                      'saklanmaz, bu yüzden tekrar gösterilemez. Yeni bağlantı oluşturursanız eskisi '
                      'anında geçersiz olur.'
                  : 'Bu takvim için henüz bağlantı oluşturulmadı. Bağlantı yalnızca oluşturulduğu '
                      'anda bir kez gösterilir; saklamayı unutmayın.',
              style: const TextStyle(fontSize: 12.5),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Vazgeç')),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: Text(hasActive ? 'Yeni bağlantı oluştur' : 'Bağlantı oluştur'),
              ),
            ],
          ),
        );
        if (renew != true) return;
        res = await widget.api
            .post('/api/admin/schedule/calendar-link/${s['id']}/rotate', const {});
        url = res is Map ? '${res['url'] ?? ''}' : '';
      }

      if (url.isEmpty || !mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Takvim Aboneliği'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Bu linki Google Takvim (Ayarlar → URL ile ekle) veya iPhone '
                '(Ayarlar → Takvim → Takvim Aboneliği) ile ekleyin; personelin '
                'randevuları telefonun takviminde canlı görünür.',
                style: TextStyle(fontSize: 12.5),
              ),
              const SizedBox(height: 10),
              SelectableText(url, style: const TextStyle(fontSize: 11)),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: url));
                if (ctx.mounted) {
                  Navigator.pop(ctx);
                  _toast('Takvim linki kopyalandı.');
                }
              },
              child: const Text('Kopyala'),
            ),
            TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Kapat')),
          ],
        ),
      );
    } catch (e) {
      _toast('$e');
    }
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
                  'Yetki dosyası (${perms.where((p) => !p.contains('.')).length} sayfa · ${perms.where((p) => p.contains('.')).length} işlem)'),
              const SizedBox(height: 8),
              if (perms.isEmpty)
                const Text(
                    'Yetki tanımlı değil — “Rol Düzenle” ile sayfa ve işlem yetkilerini açın.',
                    style: TextStyle(color: AppColors.muted, fontSize: 12.5))
              else
                // Gerçek katalog: sayfa etiketi + tam/kısmi işlem rozeti (web paritesi).
                ..._permFileRows(perms.toSet()),
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
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _workingHours,
                      icon: const Icon(Icons.schedule_rounded, size: 18),
                      label: const Text('Çalışma Saatleri'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _calendarLink,
                      icon: const Icon(Icons.event_available_rounded, size: 18),
                      label: const Text('Takvim Aboneliği'),
                    ),
                  ),
                ],
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

  /// Yetki dosyası satırları: sayfa ikonu + katalog etiketi + tam / açık-toplam işlem.
  /// Katalog dışı (eski/özel) anahtarlar en sonda çip olarak gösterilir.
  List<Widget> _permFileRows(Set<String> perms) {
    final rows = <Widget>[];
    for (final page in widget.catalog) {
      final cell = _permCell(perms, page);
      if (cell.state == 0) continue;
      rows.add(Padding(
        padding: const EdgeInsets.only(bottom: 7),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: AppColors.surfaceSoft.withValues(alpha: .45),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              Icon(_permIcon(page.key), size: 16, color: _rose),
              const SizedBox(width: 9),
              Expanded(
                child: Text(page.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 12.5, fontWeight: FontWeight.w600)),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: (cell.state == 2 ? AppColors.success : _rose)
                      .withValues(alpha: .13),
                  borderRadius: BorderRadius.circular(7),
                ),
                child: Text(
                    cell.state == 2 ? 'tam' : '${cell.granted}/${cell.total}',
                    style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                        color:
                            cell.state == 2 ? AppColors.success : _rose)),
              ),
            ],
          ),
        ),
      ));
    }
    final known = <String>{};
    for (final p in widget.catalog) {
      known.add(p.key);
      known.addAll(p.actions.map((a) => a.key));
    }
    final orphans = perms.where((k) => !known.contains(k)).toList();
    if (orphans.isNotEmpty) {
      rows.add(Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final k in orphans)
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.border),
                ),
                child: Text(_permLabel(widget.catalog, k),
                    style: const TextStyle(
                        fontSize: 10.5, color: AppColors.muted)),
              ),
          ],
        ),
      ));
    }
    return rows;
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
