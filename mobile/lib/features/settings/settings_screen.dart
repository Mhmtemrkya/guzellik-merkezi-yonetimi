import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import '../appointments/calendar_theme.dart';

/// Ayarlar — web "ayarlar" sayfasının mobil paritesi: Kurum Profili, Ödeme &
/// Taksit, WhatsApp, Gelir Bilgileri + Gelir Kalemleri, Kayıt Özeti, Aktif
/// Kadro, Mevcut Paket & Kullanım ve Şubeler. Gelir/istatistikler client-side
/// hesaplanır (accounts + appointments + adisyonlar).
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({required this.api, required this.auth, super.key});
  final ApiClient api;
  final AuthController auth;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

String _tl(num? v) => CalendarText.tl(v?.toDouble() ?? 0);

bool _inRange(dynamic iso, DateTime from, DateTime to) {
  final d = parseUtcToLocal(iso);
  return d != null && !d.isBefore(from) && d.isBefore(to);
}

double _paymentsSum(List<Map<String, dynamic>> accounts, DateTime from,
    DateTime to, {bool? withPackage}) {
  var s = 0.0;
  for (final a in accounts) {
    if (withPackage != null) {
      final hasPkg = a['servicePackageId'] != null &&
          '${a['servicePackageId']}'.trim().isNotEmpty;
      if (hasPkg != withPackage) continue;
    }
    for (final p in (a['payments'] as List? ?? const [])) {
      if (p is Map && _inRange(p['occurredAtUtc'], from, to)) {
        s += (p['amount'] as num?)?.toDouble() ?? 0;
      }
    }
  }
  return s;
}

double _serviceIncome(
    List<Map<String, dynamic>> appts, DateTime from, DateTime to) {
  var s = 0.0;
  for (final a in appts) {
    if ('${a['status']}' != 'Completed') continue;
    if (_inRange(a['startUtc'], from, to)) s += numberOf(a, const ['price']);
  }
  return s;
}

double _productIncome(
    List<Map<String, dynamic>> adisyonlar, DateTime from, DateTime to) {
  var s = 0.0;
  for (final a in adisyonlar) {
    if ('${a['status']}' != 'Approved') continue;
    if (!_inRange(a['approvedAtUtc'], from, to)) continue;
    for (final it in (a['items'] as List? ?? const [])) {
      if (it is Map && '${it['type']}' == 'Product') {
        s += (it['lineTotal'] as num?)?.toDouble() ?? 0;
      }
    }
  }
  return s;
}

class _SettingsScreenState extends State<SettingsScreen> {
  late Future<_SettingsData> _future;

  bool get _isPlatform => widget.auth.user?.isPlatform == true;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_SettingsData> _load() async {
    if (_isPlatform) {
      final m = await widget.api
          .get('/api/platform/messaging/settings')
          .catchError((_) => <String, dynamic>{});
      return _SettingsData(
          tenant: m is Map ? m.cast<String, dynamic>() : const {});
    }
    Future<dynamic> g(String path, [Map<String, dynamic>? q]) =>
        widget.api.get(path, query: q).catchError((_) => const <dynamic>[]);

    final r = await Future.wait<dynamic>([
      widget.api
          .get('/api/admin/tenant/')
          .catchError((_) => <String, dynamic>{}),
      widget.api
          .get('/api/admin/whatsapp/settings')
          .catchError((_) => <String, dynamic>{}),
      g('/api/admin/branches/'),
      g('/api/admin/staff/', {'page': 1, 'pageSize': 200}),
      g('/api/admin/services/', {'page': 1, 'pageSize': 200}),
      g('/api/admin/packages/', {'page': 1, 'pageSize': 200}),
      g('/api/admin/accounts/', {'page': 1, 'pageSize': 500}),
      g('/api/admin/appointments/', {'page': 1, 'pageSize': 500}),
      g('/api/admin/adisyonlar/', {'page': 1, 'pageSize': 200}),
      widget.api
          .get('/api/admin/logs/', query: {'page': 1, 'pageSize': 1})
          .catchError((_) => <String, dynamic>{}),
      widget.api
          .get('/api/admin/usage')
          .catchError((_) => <String, dynamic>{}),
      widget.api
          .get('/api/admin/security/screenshots')
          .catchError((_) => <String, dynamic>{}),
      g('/api/admin/security/screenshots/staff'),
    ]);

    final logs = r[9];
    final logItems = apiItems(logs);
    final auditTotal = logs is Map
        ? ((logs['total'] ?? logs['totalCount'] ?? logs['count']) as num?)
                ?.toInt() ??
            logItems.length
        : logItems.length;

    return _SettingsData(
      tenant: r[0] is Map ? (r[0] as Map).cast<String, dynamic>() : const {},
      whatsapp: r[1] is Map ? (r[1] as Map).cast<String, dynamic>() : const {},
      branches: apiItems(r[2]),
      staff: apiItems(r[3]),
      services: apiItems(r[4]),
      packages: apiItems(r[5]),
      accounts: apiItems(r[6]),
      appts: apiItems(r[7]),
      adisyonlar: apiItems(r[8]),
      auditTotal: auditTotal,
      lastLog: logItems.isNotEmpty ? logItems.first : const {},
      usage: r[10] is Map ? (r[10] as Map).cast<String, dynamic>() : const {},
      security: r[11] is Map ? (r[11] as Map).cast<String, dynamic>() : const {},
      screenshotStaff: apiItems(r[12]),
    );
  }

  void _reload() => setState(() {
        _future = _load();
      });

  Future<void> _guard(Future<void> Function() task, String ok) async {
    try {
      await task();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ok)));
      }
      _reload();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  // ---- Kurum profili / finans kaydı (tam payload, alanları korur) ----
  Future<void> _saveTenant(
      Map<String, dynamic> t, Map<String, dynamic> e, String okMsg) async {
    dynamic pick(String k) => e.containsKey(k) ? e[k] : t[k];
    final body = {
      'name': e['name'] ?? t['name'],
      'plan': t['plan'] ?? t['subscriptionPlanKey'],
      'status': t['status'] ?? 'Active',
      'domain': pick('domain'),
      'ownerName': pick('ownerName'),
      'phone': pick('phone'),
      'taxNumber': pick('taxNumber'),
      'currency': '${pick('currency') ?? 'TRY'}'.toUpperCase(),
      'maxInstallments': pick('maxInstallments') ?? t['maxInstallments'] ?? 12,
      'overdueGraceDays':
          pick('overdueGraceDays') ?? t['overdueGraceDays'] ?? 3,
      'legalName': pick('legalName'),
      'taxOffice': pick('taxOffice'),
      'email': pick('email'),
      'subscriptionPeriod': t['subscriptionPeriod'],
    };
    await _guard(() => widget.api.put('/api/admin/tenant/', body), okMsg);
  }

  Future<void> _editProfile(Map<String, dynamic> t) async {
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: 'Kurum profilini düzenle',
        icon: Icons.business_rounded,
        initial: t,
        fields: const [
          CrudField(key: 'name', label: 'Kurum adı', required: true),
          CrudField(key: 'legalName', label: 'Yasal işletme adı'),
          CrudField(key: 'ownerName', label: 'Yetkili kişi'),
          CrudField(key: 'phone', label: 'İletişim telefonu'),
          CrudField(key: 'email', label: 'E-posta'),
          CrudField(key: 'taxNumber', label: 'Vergi numarası'),
          CrudField(key: 'taxOffice', label: 'Vergi dairesi'),
        ],
      ),
    );
    if (result?.body == null) return;
    await _saveTenant(t, result!.body!, 'Kurum profili güncellendi.');
  }

  Future<void> _editFinance(Map<String, dynamic> t) async {
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: 'Ödeme & taksit ayarları',
        icon: Icons.credit_card_rounded,
        initial: t,
        fields: const [
          CrudField(
              key: 'currency', label: 'Para birimi', defaultValue: 'TRY'),
          CrudField(
              key: 'maxInstallments',
              label: 'Maksimum taksit (ay)',
              type: CrudFieldType.number,
              defaultValue: 12),
          CrudField(
              key: 'overdueGraceDays',
              label: 'Vade toleransı (gün)',
              type: CrudFieldType.number,
              defaultValue: 3),
        ],
      ),
    );
    if (result?.body == null) return;
    await _saveTenant(t, result!.body!, 'Ödeme ayarları kaydedildi.');
  }

  Future<void> _editWhatsApp(Map<String, dynamic> w) async {
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: 'WhatsApp ayarları',
        icon: Icons.chat_rounded,
        initial: w,
        fields: const [
          CrudField(key: 'enabled', label: 'Aktif', type: CrudFieldType.toggle),
          CrudField(key: 'phoneNumberId', label: 'Phone Number ID'),
          CrudField(
              key: 'accessToken',
              label: 'Access Token (değişmezse boş bırakın)'),
          CrudField(key: 'businessAccountId', label: 'Business Account ID'),
          CrudField(key: 'verifyToken', label: 'Verify Token'),
          CrudField(
              key: 'reminderTemplate',
              label: 'Hatırlatma şablonu',
              type: CrudFieldType.multiline),
        ],
      ),
    );
    if (result?.body == null) return;
    await _guard(
        () => widget.api.put('/api/admin/whatsapp/settings', result!.body!),
        'WhatsApp ayarları kaydedildi.');
  }

  Future<void> _editBranch(Map<String, dynamic>? b) async {
    final isEdit = b != null;
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: isEdit ? 'Şubeyi düzenle' : 'Yeni şube',
        icon: Icons.store_mall_directory_rounded,
        initial: b,
        fields: const [
          CrudField(key: 'name', label: 'Şube adı', required: true),
          CrudField(key: 'city', label: 'Şehir'),
          CrudField(
              key: 'isDefault',
              label: 'Varsayılan şube',
              type: CrudFieldType.toggle),
          CrudField(
              key: 'staffCount',
              label: 'Personel kapasitesi',
              type: CrudFieldType.number),
          CrudField(
              key: 'roomCount',
              label: 'Oda kapasitesi',
              type: CrudFieldType.number),
        ],
      ),
    );
    if (result?.body == null) return;
    await _guard(
      () => isEdit
          ? widget.api.put('/api/admin/branches/${b['id']}', result!.body!)
          : widget.api.post('/api/admin/branches/', result!.body!),
      isEdit ? 'Şube güncellendi.' : 'Şube oluşturuldu.',
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: () async => _reload(),
            child: FutureBuilder<_SettingsData>(
              future: _future,
              builder: (context, snapshot) {
                return ListView(
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 110),
                  children: [
                    PageHeader(
                      eyebrow: _isPlatform ? 'Platform' : 'Yönetim',
                      title: _isPlatform ? 'Sistem Ayarları' : 'Ayarlar',
                      subtitle: _isPlatform
                          ? 'Global mesajlaşma ve servis ayarları.'
                          : 'Kurum profili, finans kuralları ve entegrasyonlar.',
                    ),
                    const SizedBox(height: 14),
                    if (snapshot.connectionState != ConnectionState.done &&
                        !snapshot.hasData)
                      const Padding(
                        padding: EdgeInsets.all(40),
                        child: Center(child: CircularProgressIndicator()),
                      )
                    else if (_isPlatform)
                      _platform(snapshot.data!)
                    else
                      ..._admin(snapshot.data ?? _SettingsData()),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _platform(_SettingsData d) {
    final m = d.tenant;
    return _card(
      title: 'Mesajlaşma sağlayıcıları',
      icon: Icons.hub_rounded,
      rows: [
        ['SMS sağlayıcı', valueOf(m, const ['smsProvider', 'provider'])],
        ['E-posta sağlayıcı', valueOf(m, const ['emailProvider'])],
        ['Gönderen', valueOf(m, const ['senderName', 'fromEmail'])],
      ],
    );
  }

  List<Widget> _admin(_SettingsData d) {
    final t = d.tenant;
    final activeStaff = d.staff.where((s) => s['isActive'] != false).length;
    final groups = <String>{};
    for (final s in d.services) {
      final g = valueOf(s,
          const ['group', 'category', 'categoryName', 'groupName'],
          fallback: '');
      if (g.isNotEmpty) groups.add(g);
    }
    final specialties = <String>{};
    for (final s in d.staff) {
      final sp = valueOf(s, const ['specialties', 'dept'], fallback: '');
      if (sp.isNotEmpty) specialties.add(sp);
    }

    final now = DateTime.now();
    final m0 = DateTime(now.year, now.month, 1);
    final prevM0 = DateTime(now.year, now.month - 1, 1);
    final end = now.add(const Duration(days: 1));
    final incomeMonth =
        _paymentsSum(d.accounts, m0, end) + _serviceIncome(d.appts, m0, end);
    final incomePrev = _paymentsSum(d.accounts, prevM0, m0) +
        _serviceIncome(d.appts, prevM0, m0);
    final growth = incomePrev > 0
        ? ((incomeMonth - incomePrev) / incomePrev * 100).round()
        : (incomeMonth > 0 ? 100 : 0);

    final kalemler = <_Kalem>[
      _Kalem('Hizmet Satışları', _serviceIncome(d.appts, m0, end),
          Icons.bolt_rounded),
      _Kalem('Paket Satışları',
          _paymentsSum(d.accounts, m0, end, withPackage: true),
          Icons.inventory_2_rounded),
      _Kalem('Ürün Satışları', _productIncome(d.adisyonlar, m0, end),
          Icons.shopping_bag_rounded),
      _Kalem('Diğer Gelirler',
          _paymentsSum(d.accounts, m0, end, withPackage: false),
          Icons.account_balance_wallet_rounded),
    ];
    final kalemToplam = kalemler.fold<double>(0, (s, k) => s + k.value);

    return [
      _profileCard(t, d.branches.length, activeStaff, groups.length,
          d.packages.length),
      const SizedBox(height: 12),
      _paymentCard(t),
      const SizedBox(height: 12),
      _card(
        title: 'WhatsApp Entegrasyonu',
        icon: Icons.chat_rounded,
        onEdit: () => _editWhatsApp(d.whatsapp),
        rows: [
          ['Durum', d.whatsapp['enabled'] == true ? 'Aktif' : 'Pasif'],
          ['Phone Number ID', valueOf(d.whatsapp, const ['phoneNumberId'])],
          ['Sağlayıcı', valueOf(d.whatsapp, const ['provider'])],
          [
            'Kurulu',
            (d.whatsapp['configured'] == true ||
                    d.whatsapp['hasCredentials'] == true)
                ? 'Evet'
                : 'Hayır'
          ],
        ],
      ),
      const SizedBox(height: 12),
      _securityCard(d.security, d.screenshotStaff),
      const SizedBox(height: 12),
      _incomeCard(incomeMonth, growth),
      const SizedBox(height: 12),
      _incomeItemsCard(kalemler, kalemToplam),
      const SizedBox(height: 12),
      _recordSummaryCard(d.auditTotal, d.lastLog),
      const SizedBox(height: 12),
      _activeStaffCard(d.staff, activeStaff, specialties.toList()),
      const SizedBox(height: 12),
      _planUsageCard(d.usage),
      const SizedBox(height: 12),
      _branchesCard(d.branches),
      const SizedBox(height: 12),
      _linksCard(),
    ];
  }

  // ----------------------------- Kartlar -----------------------------

  /// Güvenlik — personel ekran görüntüsü izni. Kapalıyken personel cihazında
  /// FLAG_SECURE uygulanır (ekran görüntüsü/kaydı engellenir).
  Widget _securityCard(
      Map<String, dynamic> security, List<Map<String, dynamic>> staff) {
    final allowed = security['allowStaffScreenshots'] == true;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.shield_rounded,
                  size: 18, color: AppColors.primary),
              const SizedBox(width: 8),
              Text('Güvenlik',
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: 6),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: allowed,
            title: const Text('Personel ekran görüntüsü alabilsin',
                style: TextStyle(fontSize: 14)),
            subtitle: const Text(
              'Kapalıyken personel, mobil uygulamada ekran görüntüsü ve ekran kaydı alamaz.',
              style: TextStyle(fontSize: 12),
            ),
            onChanged: (v) => _guard(
              () async {
                await widget.api.put('/api/admin/security/screenshots',
                    {'allowStaffScreenshots': v});
              },
              v
                  ? 'Personel ekran görüntüsü izni açıldı.'
                  : 'Personel ekran görüntüsü izni kapatıldı.',
            ),
          ),
          if (staff.isNotEmpty) ...[
            const Divider(height: 20),
            const Text('Personel bazlı istisnalar',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            for (final s in staff) _staffScreenshotRow(s),
          ],
        ],
      ),
    );
  }

  Widget _staffScreenshotRow(Map<String, dynamic> s) {
    final allow = s['allow']; // null = kurum varsayılanı
    final effective = s['effective'] == true;
    final name = valueOf(s, const ['fullName', 'email']);
    final userId = '${s['tenantUserId'] ?? ''}';
    final value = allow == null ? 'default' : (allow == true ? 'allow' : 'deny');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name,
                    style: const TextStyle(fontSize: 13),
                    overflow: TextOverflow.ellipsis),
                Text(
                  'Uygulanan: ${effective ? 'İzinli' : 'Engelli'}'
                  '${allow == null ? ' (varsayılan)' : ''}',
                  style: TextStyle(
                      fontSize: 11,
                      color: effective ? Colors.green : AppColors.primary),
                ),
              ],
            ),
          ),
          DropdownButton<String>(
            value: value,
            underline: const SizedBox.shrink(),
            style: const TextStyle(fontSize: 12, color: Colors.black87),
            items: const [
              DropdownMenuItem(value: 'default', child: Text('Varsayılan')),
              DropdownMenuItem(value: 'allow', child: Text('İzinli')),
              DropdownMenuItem(value: 'deny', child: Text('Engelli')),
            ],
            onChanged: (v) {
              if (v == null || userId.isEmpty) return;
              _guard(
                () async {
                  await widget.api.put(
                      '/api/admin/security/screenshots/staff/$userId',
                      {'allow': v == 'default' ? null : v == 'allow'});
                },
                'Personel ekran görüntüsü izni güncellendi.',
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _profileCard(Map<String, dynamic> t, int branches, int activeStaff,
      int groups, int packages) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.business_rounded,
                  size: 16, color: AppColors.primary),
              const SizedBox(width: 6),
              const Expanded(
                child: Text('KURUM PROFİLİ',
                    style: TextStyle(
                        fontSize: 10,
                        letterSpacing: 1.5,
                        fontWeight: FontWeight.w800,
                        color: AppColors.primary)),
              ),
              _editChip(() => _editProfile(t)),
            ],
          ),
          const SizedBox(height: 10),
          Text(valueOf(t, const ['name', 'tenantName'], fallback: 'Kurum'),
              style: const TextStyle(
                  fontSize: 26, fontWeight: FontWeight.w900, height: 1.05)),
          const SizedBox(height: 2),
          Text(
              'Yasal: ${valueOf(t, const ['legalName', 'name'], fallback: '—')}',
              style: const TextStyle(fontSize: 12, color: AppColors.muted)),
          const SizedBox(height: 14),
          Row(
            children: [
              _profileBox(Icons.receipt_long_rounded, 'Vergi No',
                  valueOf(t, const ['taxNumber'])),
              const SizedBox(width: 8),
              _profileBox(Icons.account_balance_rounded, 'Vergi Dairesi',
                  valueOf(t, const ['taxOffice'])),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              _profileBox(Icons.phone_rounded, 'İletişim',
                  valueOf(t, const ['phone'])),
              const SizedBox(width: 8),
              _profileBox(Icons.mail_rounded, 'E-posta',
                  valueOf(t, const ['email'])),
            ],
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 6),
            decoration: BoxDecoration(
              color: AppColors.surfaceSoft.withValues(alpha: .5),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.border),
            ),
            child: Row(
              children: [
                _miniStat('$branches', 'Şube', Icons.store_rounded),
                _miniStat('$activeStaff', 'Aktif Personel',
                    Icons.people_rounded),
                _miniStat('$groups', 'Hizmet Grubu', Icons.layers_rounded),
                _miniStat('$packages', 'Paket', Icons.inventory_2_rounded),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _profileBox(IconData icon, String label, String value) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            Container(
              width: 30,
              height: 30,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: const Color(0xFFFFF1F6),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Icon(icon, size: 15, color: AppColors.primary),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style:
                          const TextStyle(fontSize: 9, color: AppColors.muted)),
                  Text(value,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 12, fontWeight: FontWeight.w700)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _miniStat(String value, String label, IconData icon) {
    return Expanded(
      child: Column(
        children: [
          Icon(icon, size: 16, color: AppColors.primary),
          const SizedBox(height: 4),
          Text(value,
              style:
                  const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
          Text(label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 8.5, color: AppColors.muted)),
        ],
      ),
    );
  }

  Widget _paymentCard(Map<String, dynamic> t) {
    final grace = numberOf(t, const ['overdueGraceDays']).toInt();
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.credit_card_rounded,
                  size: 18, color: AppColors.primaryDark),
              const SizedBox(width: 8),
              const Expanded(
                child: Text('Ödeme & Taksit',
                    style:
                        TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
              ),
              _editChip(() => _editFinance(t)),
            ],
          ),
          const SizedBox(height: 10),
          _payRow(Icons.account_balance_wallet_rounded, 'Kasa Ödeme',
              'Nakit ve POS tahsilatları', valueOf(t, const ['currency'])),
          const SizedBox(height: 8),
          _payRow(Icons.percent_rounded, 'Maks. Taksit',
              'Müşteri ödemelerinde',
              '${numberOf(t, const ['maxInstallments']).toInt()} ay'),
          const SizedBox(height: 8),
          _payRow(Icons.event_repeat_rounded, 'Vade & Hatırlatma',
              'Gecikme toleransı', '$grace gün'),
          if (grace == 0) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF7E6),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFF0D08A)),
              ),
              child: const Row(
                children: [
                  Icon(Icons.warning_amber_rounded,
                      size: 16, color: Color(0xFFB7791F)),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                        'Tolerans 0 — vade gelir gelmez kayıt "gecikmiş" sayılır.',
                        style:
                            TextStyle(fontSize: 11, color: Color(0xFF8A6515))),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _payRow(IconData icon, String title, String sub, String value) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
      decoration: BoxDecoration(
        color: AppColors.surfaceSoft.withValues(alpha: .5),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: const Color(0xFFFFF1F6),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 17, color: AppColors.primary),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w700)),
                Text(sub,
                    style:
                        const TextStyle(fontSize: 10, color: AppColors.muted)),
              ],
            ),
          ),
          Text(value,
              style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.primary)),
        ],
      ),
    );
  }

  Widget _incomeCard(double incomeMonth, int growth) {
    final up = growth >= 0;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.trending_up_rounded,
                  size: 18, color: AppColors.primary),
              const SizedBox(width: 8),
              const Expanded(
                child: Text('Gelir Bilgileri',
                    style:
                        TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                decoration: BoxDecoration(
                  color: (up ? AppColors.success : AppColors.danger)
                      .withValues(alpha: .12),
                  borderRadius: BorderRadius.circular(9),
                ),
                child: Row(
                  children: [
                    Icon(
                        up
                            ? Icons.arrow_upward_rounded
                            : Icons.arrow_downward_rounded,
                        size: 12,
                        color: up ? AppColors.success : AppColors.danger),
                    const SizedBox(width: 2),
                    Text('%${growth.abs()}',
                        style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                            color: up ? AppColors.success : AppColors.danger)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          const Text('Bu ayki genel gelir performansı',
              style: TextStyle(fontSize: 11.5, color: AppColors.muted)),
          const SizedBox(height: 8),
          Text(_tl(incomeMonth),
              style: const TextStyle(
                  fontSize: 30,
                  fontWeight: FontWeight.w900,
                  color: AppColors.primary)),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _incomeLink('Brüt Gelir', Icons.point_of_sale_rounded, '/cash'),
              _incomeLink('Raporlar', Icons.bar_chart_rounded, '/reports'),
              _incomeLink('Randevu Gelirleri', Icons.event_rounded,
                  '/appointments'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _incomeLink(String label, IconData icon, String route) {
    return InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: () => context.push(route),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
        decoration: BoxDecoration(
          color: const Color(0xFFFFF1F6),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: const Color(0xFFEFBFD0)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: AppColors.primary),
            const SizedBox(width: 6),
            Text(label,
                style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primaryDark)),
          ],
        ),
      ),
    );
  }

  Widget _incomeItemsCard(List<_Kalem> kalemler, double total) {
    final max = kalemler.fold<double>(1, (m, k) => k.value > m ? k.value : m);
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF5C2138), Color(0xFF3A1426)],
        ),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text('GELİR KALEMLERİ',
                    style: TextStyle(
                        fontSize: 13,
                        letterSpacing: .8,
                        fontWeight: FontWeight.w800,
                        color: Colors.white)),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  const Text('Toplam',
                      style: TextStyle(fontSize: 9, color: Colors.white54)),
                  Text(_tl(total),
                      style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w900,
                          color: Colors.white)),
                ],
              ),
            ],
          ),
          const SizedBox(height: 16),
          for (final k in kalemler) ...[
            Row(
              children: [
                Container(
                  width: 26,
                  height: 26,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: .12),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(k.icon, size: 14, color: Colors.white),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: Text(k.label,
                      style: const TextStyle(
                          fontSize: 12.5, color: Colors.white70)),
                ),
                Text(_tl(k.value),
                    style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: Colors.white)),
              ],
            ),
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: (k.value / max).clamp(0.02, 1.0),
                minHeight: 5,
                backgroundColor: Colors.white.withValues(alpha: .14),
                valueColor: const AlwaysStoppedAnimation(Color(0xFFF3A3BF)),
              ),
            ),
            const SizedBox(height: 14),
          ],
        ],
      ),
    );
  }

  Widget _recordSummaryCard(int auditTotal, Map<String, dynamic> lastLog) {
    final d = parseUtcToLocal(lastLog['createdAtUtc']);
    final dateStr =
        d != null ? '${d.day} ${_monShort[d.month - 1]} ${d.year}' : '—';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.assignment_rounded,
                  size: 18, color: AppColors.primary),
              SizedBox(width: 8),
              Text('Kayıt Özeti',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Container(
                width: 74,
                height: 74,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0xFFFFF1F6),
                  border:
                      Border.all(color: const Color(0xFFFBD2DC), width: 5),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text('$auditTotal',
                        style: const TextStyle(
                            fontSize: 18, fontWeight: FontWeight.w900)),
                    const Text('kayıt',
                        style:
                            TextStyle(fontSize: 8, color: AppColors.muted)),
                  ],
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Son işlem',
                        style:
                            TextStyle(fontSize: 10, color: AppColors.muted)),
                    Text(valueOf(lastLog, const ['actorName', 'userName']),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 13, fontWeight: FontWeight.w700)),
                    Text(dateStr,
                        style: const TextStyle(
                            fontSize: 11, color: AppColors.muted)),
                    const SizedBox(height: 8),
                    InkWell(
                      onTap: () => context.push('/logs'),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text('Tüm kayıtları gör',
                              style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.primary)),
                          Icon(Icons.chevron_right_rounded,
                              size: 16, color: AppColors.primary),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _activeStaffCard(List<Map<String, dynamic>> staff, int active,
      List<String> specialties) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.people_rounded,
                  size: 18, color: AppColors.primary),
              const SizedBox(width: 8),
              const Expanded(
                child: Text('Aktif Kadro',
                    style:
                        TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
              ),
              Text('$active / ${staff.length}',
                  style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                      color: AppColors.primary)),
            ],
          ),
          if (specialties.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final s in specialties.take(5))
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceSoft,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Text(s,
                        style: const TextStyle(
                            fontSize: 10, color: AppColors.primaryDark)),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 12),
          for (final p in staff.take(3))
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  _avatar(valueOf(p, const ['fullName', 'name'])),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(valueOf(p, const ['fullName', 'name']),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontSize: 13, fontWeight: FontWeight.w700)),
                        Text(valueOf(p, const ['title', 'role']),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontSize: 11, color: AppColors.muted)),
                      ],
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: (p['isActive'] != false
                              ? AppColors.success
                              : AppColors.danger)
                          .withValues(alpha: .12),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(p['isActive'] != false ? 'Aktif' : 'Pasif',
                        style: TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.w800,
                            color: p['isActive'] != false
                                ? AppColors.success
                                : AppColors.danger)),
                  ),
                ],
              ),
            ),
          if (staff.isEmpty)
            const Text('Personel kaydı yok.',
                style: TextStyle(fontSize: 12, color: AppColors.muted)),
          const SizedBox(height: 2),
          InkWell(
            onTap: () => context.push('/staff'),
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('Tüm personeli gör',
                    style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: AppColors.primary)),
                Icon(Icons.chevron_right_rounded,
                    size: 16, color: AppColors.primary),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _planUsageCard(Map<String, dynamic> usage) {
    final metrics = (usage['metrics'] as List? ?? const [])
        .whereType<Map>()
        .map((e) => e.cast<String, dynamic>())
        .toList();
    final price = numberOf(usage, const ['planMonthlyPriceTRY']);
    final maxPercent = numberOf(usage, const ['maxPercent']).round();
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.inventory_2_rounded,
                  size: 18, color: AppColors.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Mevcut Paket',
                        style:
                            TextStyle(fontSize: 10, color: AppColors.muted)),
                    Text(
                        valueOf(usage, const ['planName'],
                            fallback: 'Atanmamış'),
                        style: const TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w900)),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(price == 0 ? 'Özel' : _tl(price),
                      style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w900,
                          color: AppColors.primary)),
                  const Text('aylık',
                      style: TextStyle(fontSize: 9, color: AppColors.muted)),
                ],
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              const Text('Kullanım',
                  style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: AppColors.muted)),
              const Spacer(),
              Text('%$maxPercent',
                  style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: maxPercent >= 100
                          ? AppColors.danger
                          : maxPercent >= 80
                              ? const Color(0xFFB7791F)
                              : AppColors.primary)),
            ],
          ),
          const SizedBox(height: 8),
          if (metrics.isEmpty)
            const Text('Kullanım verisi alınamadı.',
                style: TextStyle(fontSize: 12, color: AppColors.muted))
          else
            for (final m in metrics) _usageBar(m),
          const SizedBox(height: 4),
          InkWell(
            onTap: () => context.push('/paket'),
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('Paket detayı & yükselt',
                    style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: AppColors.primary)),
                Icon(Icons.chevron_right_rounded,
                    size: 16, color: AppColors.primary),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _usageBar(Map<String, dynamic> m) {
    final label = valueOf(m, const ['label', 'key']);
    final used = numberOf(m, const ['used']);
    final limit = numberOf(m, const ['limit']);
    final unlimited = m['isUnlimited'] == true || limit < 0;
    final percent = numberOf(m, const ['percent']).clamp(0, 100) / 100;
    final over = m['isOver'] == true;
    final warn = m['isWarning'] == true;
    final color = over
        ? AppColors.danger
        : warn
            ? const Color(0xFFB7791F)
            : AppColors.primary;
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11.5)),
              ),
              Text(
                  unlimited
                      ? '${used.toInt()} / ∞'
                      : '${used.toInt()} / ${limit.toInt()}',
                  style: const TextStyle(
                      fontSize: 11, fontWeight: FontWeight.w700)),
            ],
          ),
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: unlimited ? 0.04 : percent.toDouble(),
              minHeight: 5,
              backgroundColor: AppColors.surfaceSoft,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  Widget _branchesCard(List<Map<String, dynamic>> branches) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 12, 10),
            child: Row(
              children: [
                const Icon(Icons.store_mall_directory_rounded,
                    size: 18, color: AppColors.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text('Şubeler (${branches.length})',
                      style: const TextStyle(
                          fontSize: 15, fontWeight: FontWeight.w800)),
                ),
                TextButton.icon(
                  onPressed: () => _editBranch(null),
                  icon: const Icon(Icons.add_rounded, size: 16),
                  label: const Text('Ekle'),
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: AppColors.border),
          if (branches.isEmpty)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Text('Henüz şube tanımlanmadı.',
                  style: TextStyle(fontSize: 12, color: AppColors.muted)),
            )
          else
            for (var i = 0; i < branches.length; i++) ...[
              _branchRow(branches[i]),
              if (i < branches.length - 1)
                const Divider(height: 1, color: AppColors.border),
            ],
        ],
      ),
    );
  }

  Widget _branchRow(Map<String, dynamic> b) {
    final isDefault = b['isDefault'] == true;
    return InkWell(
      onTap: () => _editBranch(b),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(valueOf(b, const ['name', 'branchName']),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontSize: 13.5, fontWeight: FontWeight.w700)),
                      ),
                      if (isDefault) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFFF1F6),
                            borderRadius: BorderRadius.circular(6),
                            border:
                                Border.all(color: const Color(0xFFEFBFD0)),
                          ),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.star_rounded,
                                  size: 10, color: AppColors.primary),
                              SizedBox(width: 2),
                              Text('varsayılan',
                                  style: TextStyle(
                                      fontSize: 8.5,
                                      fontWeight: FontWeight.w700,
                                      color: AppColors.primary)),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      const Icon(Icons.location_on_rounded,
                          size: 11, color: AppColors.muted),
                      const SizedBox(width: 2),
                      Text(valueOf(b, const ['city']),
                          style: const TextStyle(
                              fontSize: 10.5, color: AppColors.muted)),
                      const SizedBox(width: 10),
                      const Icon(Icons.people_outline_rounded,
                          size: 11, color: AppColors.muted),
                      const SizedBox(width: 2),
                      Text(
                          '${numberOf(b, const ['staffCount', 'staff']).toInt()}',
                          style: const TextStyle(
                              fontSize: 10.5, color: AppColors.muted)),
                      const SizedBox(width: 10),
                      const Icon(Icons.meeting_room_outlined,
                          size: 11, color: AppColors.muted),
                      const SizedBox(width: 2),
                      Text(
                          '${numberOf(b, const ['roomCount', 'rooms']).toInt()}',
                          style: const TextStyle(
                              fontSize: 10.5, color: AppColors.muted)),
                    ],
                  ),
                ],
              ),
            ),
            const Icon(Icons.edit_rounded, size: 16, color: AppColors.muted),
          ],
        ),
      ),
    );
  }

  Widget _linksCard() {
    final links = [
      ['Hizmet Kategorileri', Icons.category_rounded, '/service-categories'],
      [
        'Gider Kategorileri',
        Icons.folder_special_rounded,
        '/expense-categories'
      ],
    ];
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var i = 0; i < links.length; i++) ...[
            ListTile(
              leading:
                  Icon(links[i][1] as IconData, color: AppColors.primaryDark),
              title: Text(links[i][0] as String,
                  style: const TextStyle(
                      fontSize: 14, fontWeight: FontWeight.w600)),
              trailing: const Icon(Icons.chevron_right_rounded),
              onTap: () => context.push(links[i][2] as String),
            ),
            if (i < links.length - 1)
              const Divider(height: 1, color: AppColors.border),
          ],
        ],
      ),
    );
  }

  // ----------------------------- Ortak -----------------------------

  Widget _editChip(VoidCallback onTap) {
    return InkWell(
      borderRadius: BorderRadius.circular(9),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: AppColors.surfaceSoft,
          borderRadius: BorderRadius.circular(9),
          border: Border.all(color: AppColors.border),
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.edit_rounded, size: 13, color: AppColors.primaryDark),
            SizedBox(width: 4),
            Text('Düzenle',
                style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primaryDark)),
          ],
        ),
      ),
    );
  }

  Widget _avatar(String name) {
    final initials = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .take(2)
        .map((p) => p[0].toUpperCase())
        .join();
    return Container(
      width: 40,
      height: 40,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: const Color(0xFFFBD2DC),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(initials.isEmpty ? '•' : initials,
          style: const TextStyle(
              color: Color(0xFF8E3F5B),
              fontWeight: FontWeight.w900,
              fontSize: 13)),
    );
  }

  Widget _card({
    required String title,
    required IconData icon,
    required List<List<String>> rows,
    VoidCallback? onEdit,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: AppColors.primaryDark, size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: Text(title,
                    style: const TextStyle(
                        fontWeight: FontWeight.w800, fontSize: 15)),
              ),
              if (onEdit != null) _editChip(onEdit),
            ],
          ),
          const SizedBox(height: 6),
          for (final r in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 130,
                    child: Text(r[0],
                        style: const TextStyle(
                            fontSize: 13, color: AppColors.muted)),
                  ),
                  Expanded(
                    child: Text(r[1],
                        style: const TextStyle(
                            fontSize: 13, fontWeight: FontWeight.w600)),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

const _monShort = [
  'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
  'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara',
];

class _Kalem {
  const _Kalem(this.label, this.value, this.icon);
  final String label;
  final double value;
  final IconData icon;
}

class _SettingsData {
  _SettingsData({
    this.tenant = const {},
    this.whatsapp = const {},
    this.branches = const [],
    this.staff = const [],
    this.services = const [],
    this.packages = const [],
    this.accounts = const [],
    this.appts = const [],
    this.adisyonlar = const [],
    this.auditTotal = 0,
    this.lastLog = const {},
    this.usage = const {},
    this.security = const {},
    this.screenshotStaff = const [],
  });
  final Map<String, dynamic> tenant;
  final Map<String, dynamic> whatsapp;
  final List<Map<String, dynamic>> branches;
  final List<Map<String, dynamic>> staff;
  final List<Map<String, dynamic>> services;
  final List<Map<String, dynamic>> packages;
  final List<Map<String, dynamic>> accounts;
  final List<Map<String, dynamic>> appts;
  final List<Map<String, dynamic>> adisyonlar;
  final int auditTotal;
  final Map<String, dynamic> lastLog;
  final Map<String, dynamic> usage;
  final Map<String, dynamic> security;
  final List<Map<String, dynamic>> screenshotStaff;
}
