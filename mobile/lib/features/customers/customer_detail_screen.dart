import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/customer_call.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/sparkline.dart';
import '../accounting/adisyon_detail_sheet.dart';
import '../accounting/on_muhasebe_screen.dart' show AccountDetailSheet;
import '../appointments/appointment_form.dart';
import '../appointments/calendar_theme.dart';

/// Müşteri detay ekranının açıldığı sekme.
enum CustomerTab { overview, appointments, adisyon, health, notes }

const _genders = <String, String>{
  'Female': 'Kadın',
  'Male': 'Erkek',
  'Other': 'Diğer',
  'Unspecified': 'Belirtilmemiş',
};

const _genderOptions = <CrudOption>[
  CrudOption('Female', 'Kadın'),
  CrudOption('Male', 'Erkek'),
  CrudOption('Other', 'Diğer'),
  CrudOption('Unspecified', 'Belirtilmemiş'),
];

const _trMonthsShort = [
  'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
  'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara',
];

// Web DONUT_COLORS ile aynı — net ayrışan dilimler.
const _donutColors = [
  Color(0xFFC85776), Color(0xFF7C5CBF), Color(0xFF2FAE8E),
  Color(0xFFE8932F), Color(0xFF4A9FE0), Color(0xFFD65A8E),
];

String _methodLabel(String raw) {
  switch (raw) {
    case 'Cash':
      return 'Nakit';
    case 'CreditCard':
    case 'Card':
      return 'Kredi Kartı';
    case 'BankTransfer':
    case 'Transfer':
      return 'Havale/EFT';
    case 'Other':
      return 'Diğer';
    default:
      return raw.isEmpty ? 'Diğer' : raw;
  }
}

/// Müşteri Detayı — web `CustomerDetailModal`'ın mobil karşılığı.
///
/// Tam ekran, sekmeli: Genel Bakış · Randevu & Seans · Adisyon & İşlemler ·
/// Sağlık & Günlük · Notlar. Hem Müşteriler hem Ön Muhasebe sayfasından açılır.
class CustomerDetailScreen extends StatefulWidget {
  const CustomerDetailScreen({
    required this.api,
    required this.customerId,
    this.customer,
    this.initialTab = CustomerTab.overview,
    super.key,
  });

  final ApiClient api;
  final String customerId;
  final Map<String, dynamic>? customer;
  final CustomerTab initialTab;

  @override
  State<CustomerDetailScreen> createState() => _CustomerDetailScreenState();
}

class _CustomerDetailScreenState extends State<CustomerDetailScreen> {
  late Map<String, dynamic> _customer = {
    'id': widget.customerId,
    ...?widget.customer,
  };
  List<Map<String, dynamic>> _accounts = const [];
  List<Map<String, dynamic>> _appts = const [];
  bool _loading = true;
  String? _error;
  // Tembel sekmeleri (adisyon, seans, sağlık) yenilemek için sayaç.
  int _refreshKey = 0;

  ApiClient get _api => widget.api;
  String get _id => widget.customerId;

  bool _busyVip = false;

  /// Başlıktaki VIP rozetine dokununca etiketi ekler/kaldırır (web paritesi).
  Future<void> _toggleVip() async {
    if (_busyVip) return;
    final next = _customer['isVip'] != true;
    setState(() => _busyVip = true);
    try {
      await _api.post('/api/admin/customers/$_id/vip', {'vip': next});
      setState(() => _customer['isVip'] = next);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(
                next ? 'VIP etiketi eklendi.' : 'VIP etiketi kaldırıldı.')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _busyVip = false);
    }
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait<dynamic>([
        _api.get('/api/admin/customers/$_id').catchError((_) => null),
        _api
            .get('/api/admin/accounts/', query: {'page': 1, 'pageSize': 500})
            .catchError((_) => const <dynamic>[]),
        _api
            .get('/api/admin/appointments/',
                query: {'page': 1, 'pageSize': 500})
            .catchError((_) => const <dynamic>[]),
      ]);

      if (results[0] is Map) {
        _customer = (results[0] as Map).cast<String, dynamic>();
      }
      _accounts = apiItems(results[1])
          .where((a) => '${a['customerId']}' == _id)
          .toList();
      _appts = apiItems(results[2])
          .where((a) => '${a['customerId']}' == _id)
          .toList()
        ..sort((x, y) =>
            '${y['startUtc']}'.compareTo('${x['startUtc']}'));

      if (mounted) setState(() => _loading = false);
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = '$e';
        });
      }
    }
  }

  Future<void> _reload() async {
    setState(() => _refreshKey++);
    await _load();
  }

  // --- Türetilen değerler ---

  String get _name => valueOf(_customer, const ['fullName', 'name'], fallback: 'Müşteri');
  double get _spent => _accounts.fold(
      0, (s, a) => s + ((a['paidAmount'] as num?)?.toDouble() ?? 0));
  double get _debt => _accounts.fold(
      0, (s, a) => s + ((a['remainingAmount'] as num?)?.toDouble() ?? 0));

  DateTime? get _lastApptDate {
    for (final a in _appts) {
      final d = parseUtcToLocal(a['startUtc']);
      if (d != null) return d;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: DefaultTabController(
        length: 5,
        initialIndex: widget.initialTab.index,
        child: Scaffold(
          backgroundColor: Colors.transparent,
          body: SafeArea(
            bottom: false,
            child: Column(
              children: [
                _header(),
                Expanded(
                  child: _loading
                      ? const Center(child: CircularProgressIndicator())
                      : _error != null
                          ? _errorState()
                          : TabBarView(
                              children: [
                                _OverviewTab(state: this),
                                _AppointmentsTab(state: this),
                                _AdisyonTab(
                                  key: ValueKey('adisyon-$_refreshKey'),
                                  api: _api,
                                  customerId: _id,
                                  customerName: _name,
                                  accounts: _accounts,
                                  onChanged: _reload,
                                ),
                                _HealthTab(
                                  key: ValueKey('health-$_refreshKey'),
                                  api: _api,
                                  customerId: _id,
                                  customerName: _name,
                                ),
                                _NotesTab(
                                  api: _api,
                                  customer: _customer,
                                  onChanged: _reload,
                                ),
                              ],
                            ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _errorState() => Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off_rounded,
                  size: 44, color: AppColors.primary),
              const SizedBox(height: 12),
              Text(_error ?? '', textAlign: TextAlign.center),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: _load,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Tekrar dene'),
              ),
            ],
          ),
        ),
      );

  Widget _header() {
    final blacklisted = _customer['isBlacklisted'] == true;
    final last = _lastApptDate;
    final active90 = last != null &&
        DateTime.now().difference(last).inDays <= 90;
    return Container(
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .82),
        border: const Border(bottom: BorderSide(color: AppColors.border)),
      ),
      padding: const EdgeInsets.fromLTRB(8, 6, 12, 0),
      child: Column(
        children: [
          Row(
            children: [
              IconButton(
                tooltip: 'Geri',
                onPressed: () => context.pop(),
                icon: const Icon(Icons.arrow_back_rounded),
                color: AppColors.ink,
              ),
              _avatar(),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 19,
                        fontWeight: FontWeight.w800,
                        color: AppColors.ink,
                        letterSpacing: -.4,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        _miniBadge(
                          active90 ? 'Aktif Müşteri' : 'Pasif',
                          active90 ? AppColors.success : AppColors.muted,
                        ),
                        if (_customer['isVip'] == true) ...[
                          const SizedBox(width: 6),
                          _miniBadge('VIP', const Color(0xFF9A7420),
                              icon: Icons.workspace_premium_rounded),
                        ],
                        if (blacklisted) ...[
                          const SizedBox(width: 6),
                          _miniBadge('Kara liste', AppColors.danger,
                              icon: Icons.block_rounded),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          _kpiStrip(last),
          const SizedBox(height: 6),
          const TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            labelColor: AppColors.primaryDark,
            unselectedLabelColor: AppColors.muted,
            indicatorColor: AppColors.primary,
            indicatorWeight: 2.5,
            labelStyle: TextStyle(fontSize: 13, fontWeight: FontWeight.w800),
            unselectedLabelStyle:
                TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
            tabs: [
              Tab(text: 'Genel Bakış'),
              Tab(text: 'Randevu & Seans'),
              Tab(text: 'Adisyon & İşlemler'),
              Tab(text: 'Sağlık & Günlük'),
              Tab(text: 'Notlar'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _avatar() {
    final initials = _name
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .take(2)
        .map((p) => p[0].toUpperCase())
        .join();
    return Container(
      width: 44,
      height: 44,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF3A1A2A), AppColors.primary],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Text(
        initials.isEmpty ? '?' : initials,
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w800,
          fontSize: 15,
        ),
      ),
    );
  }

  Widget _kpiStrip(DateTime? last) {
    final items = <(String, String)>[
      ('Toplam Randevu', '${_appts.length}'),
      ('Toplam Harcama', CalendarText.tl(_spent)),
      ('Açık Borç', CalendarText.tl(_debt)),
      ('Son İşlem',
          last == null ? '—' : DateFormat('d MMM yyyy', 'tr_TR').format(last)),
    ];
    return SizedBox(
      height: 60,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 4),
        itemCount: items.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (_, i) {
          final (label, value) = items[i];
          final danger = label == 'Açık Borç' && _debt > 0;
          return Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .7),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: const TextStyle(
                        fontSize: 9.5,
                        height: 1.1,
                        color: AppColors.muted,
                        fontWeight: FontWeight.w600,
                        letterSpacing: .3)),
                const SizedBox(height: 3),
                Text(value,
                    style: TextStyle(
                        fontSize: 15,
                        height: 1.1,
                        fontWeight: FontWeight.w800,
                        color: danger ? AppColors.danger : AppColors.ink)),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _miniBadge(String label, Color color, {IconData? icon}) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color: color.withValues(alpha: .1),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: color.withValues(alpha: .3)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, size: 11, color: color),
              const SizedBox(width: 3),
            ],
            Text(label,
                style: TextStyle(
                    color: color,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700)),
          ],
        ),
      );

  // --- Aksiyonlar (Genel Bakış'tan tetiklenir) ---

  Future<void> _editCustomer() async {
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: 'Müşteriyi düzenle',
        icon: Icons.person_rounded,
        initial: _customer,
        fields: const [
          CrudField(key: 'fullName', label: 'Ad soyad', required: true),
          CrudField(
            key: 'phone',
            label: 'Telefon',
            required: true,
            hint: '05XXXXXXXXX',
            digitsOnly: true,
            maxLength: 11,
          ),
          CrudField(key: 'email', label: 'E-posta'),
          CrudField(key: 'birthDate', label: 'Doğum tarihi', type: CrudFieldType.date),
          CrudField(
            key: 'gender',
            label: 'Cinsiyet',
            type: CrudFieldType.select,
            options: _genderOptions,
            defaultValue: 'Female',
          ),
          CrudField(
            key: 'kvkkConsent',
            label: 'KVKK onayı var',
            type: CrudFieldType.toggle,
            defaultValue: true,
          ),
          CrudField(key: 'notes', label: 'Notlar', type: CrudFieldType.multiline),
        ],
      ),
    );
    final body = result?.body;
    if (body == null) return;
    body['branchId'] =
        _customer['branchId'] ?? _api.auth?.user?.branchId;
    try {
      await _api.put('/api/admin/customers/$_id', body);
      await _reload();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Müşteri güncellendi.')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _createAppointment() async {
    final created = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => AppointmentForm(api: _api, presetCustomerId: _id),
    );
    if (created == true) {
      await _reload();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Randevu oluşturuldu.')));
      }
    }
  }

  Future<void> _deleteCustomer() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Müşteriyi sil'),
        content: Text('$_name kaydını silmek istediğinize emin misiniz?'),
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
      await _api.delete('/api/admin/customers/$_id');
      if (mounted) {
        context.pop();
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Müşteri silindi.')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }
}

// ===========================================================================
// GENEL BAKIŞ
// ===========================================================================
class _OverviewTab extends StatelessWidget {
  const _OverviewTab({required this.state});
  final _CustomerDetailScreenState state;

  @override
  Widget build(BuildContext context) {
    final c = state._customer;
    final appts = state._appts;
    final recent = appts.take(5).toList();

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 32),
      children: [
        _Section(
          title: 'Müşteri Bilgileri',
          icon: Icons.person_rounded,
          trailing: TextButton.icon(
            onPressed: state._editCustomer,
            icon: const Icon(Icons.edit_rounded, size: 16),
            label: const Text('Düzenle'),
            style: TextButton.styleFrom(
              foregroundColor: AppColors.primaryDark,
              padding: const EdgeInsets.symmetric(horizontal: 8),
            ),
          ),
          child: Column(
            children: [
              _infoRow('Ad Soyad', state._name),
              _infoRowWidget(
                'Telefon',
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      valueOf(c, const ['phone']),
                      style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink),
                    ),
                    const SizedBox(width: 6),
                    // Maskeli görünse bile arama gerçek numarayla başlar.
                    InkWell(
                      borderRadius: BorderRadius.circular(10),
                      onTap: () => callCustomer(context, state._api, c['id']),
                      child: const Padding(
                        padding: EdgeInsets.all(4),
                        child: Icon(Icons.call_rounded,
                            size: 18, color: AppColors.primary),
                      ),
                    ),
                  ],
                ),
              ),
              _infoRow('E-posta', valueOf(c, const ['email'])),
              _infoRow('Doğum Tarihi', _fmtDate(c['birthDate'])),
              _infoRow('Cinsiyet', _genders['${c['gender']}'] ?? 'Belirtilmemiş'),
              _infoRowWidget(
                'KVKK',
                Text(
                  c['kvkkConsent'] == true ? 'Onaylı' : 'Bekliyor',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: c['kvkkConsent'] == true
                        ? AppColors.success
                        : AppColors.warning,
                  ),
                ),
              ),
              _infoRow('Müşteri No', '${c['id'] ?? ''}'.split('-').first),
            ],
          ),
        ),
        _Section(
          title: 'Hızlı İşlemler',
          icon: Icons.bolt_rounded,
          child: Column(
            children: [
              _quickAction(Icons.call_rounded, 'Müşteriyi Ara',
                  () => callCustomer(context, state._api, c['id'])),
              _quickAction(Icons.calendar_month_rounded, 'Randevu Oluştur',
                  state._createAppointment),
              _quickAction(Icons.point_of_sale_rounded, 'Adisyon / Satış',
                  () => DefaultTabController.of(context).animateTo(2)),
              _quickAction(
                  Icons.workspace_premium_rounded,
                  c['isVip'] == true ? 'VIP Etiketini Kaldır' : 'VIP Yap',
                  state._toggleVip),
              _quickAction(Icons.note_alt_rounded, 'Not Ekle',
                  () => DefaultTabController.of(context).animateTo(4)),
              _quickAction(Icons.delete_outline_rounded, 'Müşteriyi Sil',
                  state._deleteCustomer,
                  danger: true),
            ],
          ),
        ),
        _Section(
          title: 'Harcamaların Zaman İçindeki Dağılımı',
          icon: Icons.show_chart_rounded,
          child: _spendChart(),
        ),
        _Section(
          title: 'İşlem Dağılımı',
          icon: Icons.content_cut_rounded,
          child: _DonutDistribution(segments: _serviceSegments()),
        ),
        _Section(
          title: 'Ödeme Tercihleri',
          icon: Icons.pie_chart_rounded,
          child: _DonutDistribution(
              segments: _paymentSegments(), valueIsMoney: true),
        ),
        _Section(
          title: 'Son Randevular',
          icon: Icons.event_rounded,
          trailing: appts.length > 5
              ? TextButton(
                  onPressed: () => DefaultTabController.of(context).animateTo(1),
                  child: const Text('Tümünü Gör'),
                )
              : null,
          child: recent.isEmpty
              ? _empty('Randevu kaydı yok.')
              : Column(
                  children: [for (final a in recent) _ApptRow(appt: a)],
                ),
        ),
      ],
    );
  }

  // Son 6 ay tahsilat (çizgi).
  Widget _spendChart() {
    final now = DateTime.now();
    final buckets = List<int>.filled(6, 0);
    final labels = <String>[];
    final keys = <String>[];
    for (var i = 5; i >= 0; i--) {
      final d = DateTime(now.year, now.month - i, 1);
      labels.add(_trMonthsShort[d.month - 1]);
      keys.add('${d.year}-${d.month}');
    }
    var total = 0.0;
    for (final a in state._accounts) {
      for (final p in (a['payments'] as List? ?? const [])) {
        if (p is! Map) continue;
        final d = parseUtcToLocal(p['occurredAtUtc']);
        if (d == null) continue;
        final idx = keys.indexOf('${d.year}-${d.month}');
        if (idx >= 0) {
          final amount = (p['amount'] as num?)?.toDouble() ?? 0;
          buckets[idx] += amount.round();
          total += amount;
        }
      }
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          height: 86,
          child: Sparkline(values: buckets, color: AppColors.primary),
        ),
        const SizedBox(height: 4),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            for (final l in labels)
              Text(l,
                  style: const TextStyle(
                      fontSize: 9, color: AppColors.muted)),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('Son 6 ay tahsilat',
                style: TextStyle(fontSize: 11, color: AppColors.muted)),
            Text(CalendarText.tl(total),
                style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.primaryDark)),
          ],
        ),
      ],
    );
  }

  List<_Seg> _serviceSegments() {
    final m = <String, int>{};
    for (final a in state._appts) {
      if ('${a['status']}'.toLowerCase() != 'completed') continue;
      final k = valueOf(a, const ['serviceName'], fallback: 'Diğer');
      m[k] = (m[k] ?? 0) + 1;
    }
    final sorted = m.entries.toList()
      ..sort((x, y) => y.value.compareTo(x.value));
    final segs = <_Seg>[];
    for (var i = 0; i < sorted.length && i < 5; i++) {
      segs.add(_Seg(sorted[i].key, sorted[i].value.toDouble(),
          _donutColors[i % _donutColors.length], '${sorted[i].value}×'));
    }
    final rest =
        sorted.skip(5).fold<int>(0, (s, e) => s + e.value);
    if (rest > 0) {
      segs.add(_Seg('Diğer', rest.toDouble(), _donutColors[5], '$rest×'));
    }
    return segs;
  }

  List<_Seg> _paymentSegments() {
    final sum = <String, double>{};
    final count = <String, int>{};
    for (final a in state._accounts) {
      for (final p in (a['payments'] as List? ?? const [])) {
        if (p is! Map) continue;
        final k = _methodLabel('${p['method'] ?? ''}'.trim());
        sum[k] = (sum[k] ?? 0) + ((p['amount'] as num?)?.toDouble() ?? 0);
        count[k] = (count[k] ?? 0) + 1;
      }
    }
    final sorted = sum.entries.toList()
      ..sort((x, y) => y.value.compareTo(x.value));
    return [
      for (var i = 0; i < sorted.length; i++)
        _Seg(sorted[i].key, sorted[i].value,
            _donutColors[i % _donutColors.length],
            '${count[sorted[i].key]} tahsilat'),
    ];
  }

  Widget _quickAction(IconData icon, String label, VoidCallback onTap,
      {bool danger = false}) {
    final color = danger ? AppColors.danger : AppColors.ink;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          decoration: BoxDecoration(
            color: danger
                ? AppColors.danger.withValues(alpha: .06)
                : AppColors.surfaceSoft.withValues(alpha: .5),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
                color: (danger ? AppColors.danger : AppColors.border)
                    .withValues(alpha: danger ? .3 : 1)),
          ),
          child: Row(
            children: [
              Icon(icon, size: 19, color: danger ? AppColors.danger : AppColors.primary),
              const SizedBox(width: 10),
              Expanded(
                child: Text(label,
                    style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w700,
                        color: color)),
              ),
              Icon(Icons.chevron_right_rounded,
                  size: 18, color: color.withValues(alpha: .4)),
            ],
          ),
        ),
      ),
    );
  }
}

// ===========================================================================
// RANDEVU & SEANS
// ===========================================================================
class _AppointmentsTab extends StatelessWidget {
  const _AppointmentsTab({required this.state});
  final _CustomerDetailScreenState state;

  @override
  Widget build(BuildContext context) {
    final appts = state._appts;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 32),
      children: [
        _SessionsCard(api: state._api, customerId: state._id),
        _Section(
          title: 'Randevu Geçmişi',
          icon: Icons.history_rounded,
          child: appts.isEmpty
              ? _empty('Randevu kaydı yok.')
              : Column(children: [for (final a in appts) _ApptRow(appt: a)]),
        ),
      ],
    );
  }
}

class _SessionsCard extends StatefulWidget {
  const _SessionsCard({required this.api, required this.customerId});
  final ApiClient api;
  final String customerId;

  @override
  State<_SessionsCard> createState() => _SessionsCardState();
}

class _SessionsCardState extends State<_SessionsCard> {
  late Future<List<Map<String, dynamic>>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<Map<String, dynamic>>> _load() async {
    final data = await widget.api
        .get('/api/admin/accounts/sessions/${widget.customerId}');
    return apiItems(data)
        .where((s) => ((s['totalSessions'] as num?)?.toInt() ?? 0) > 0)
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Map<String, dynamic>>>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const SizedBox.shrink();
        }
        final sessions = snapshot.data ?? const [];
        if (sessions.isEmpty) return const SizedBox.shrink();
        return _Section(
          title: 'Satılan Paket / Seanslar',
          icon: Icons.layers_rounded,
          child: Column(
            children: [for (final s in sessions) _sessionRow(s)],
          ),
        );
      },
    );
  }

  Widget _sessionRow(Map<String, dynamic> s) {
    final total = (s['totalSessions'] as num?)?.toInt() ?? 0;
    final used = (s['usedSessions'] as num?)?.toInt() ?? 0;
    final remaining =
        (s['remainingSessions'] as num?)?.toInt() ?? (total - used);
    final ratio = total == 0 ? 0.0 : (used / total).clamp(0.0, 1.0);
    final done = remaining <= 0;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: done
              ? AppColors.success.withValues(alpha: .06)
              : AppColors.surfaceSoft.withValues(alpha: .45),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
              color: (done ? AppColors.success : AppColors.border)
                  .withValues(alpha: done ? .3 : 1)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(valueOf(s, const ['serviceName'], fallback: 'Hizmet'),
                      style: const TextStyle(fontWeight: FontWeight.w800)),
                ),
                Text(done ? 'Tamamlandı' : '$remaining kaldı',
                    style: TextStyle(
                        fontWeight: FontWeight.w800,
                        color: done ? AppColors.success : AppColors.primaryDark)),
              ],
            ),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: ratio,
                minHeight: 8,
                backgroundColor: AppColors.surfaceSoft,
                color: done ? AppColors.success : AppColors.primary,
              ),
            ),
            const SizedBox(height: 6),
            Text('$used / $total seans kullanıldı',
                style: const TextStyle(fontSize: 12, color: AppColors.muted)),
          ],
        ),
      ),
    );
  }
}

// ===========================================================================
// ADİSYON & İŞLEMLER
// ===========================================================================
class _AdisyonTab extends StatefulWidget {
  const _AdisyonTab({
    required this.api,
    required this.customerId,
    required this.customerName,
    required this.accounts,
    required this.onChanged,
    super.key,
  });
  final ApiClient api;
  final String customerId;
  final String customerName;
  final List<Map<String, dynamic>> accounts;
  final Future<void> Function() onChanged;

  @override
  State<_AdisyonTab> createState() => _AdisyonTabState();
}

class _AdisyonTabState extends State<_AdisyonTab> {
  late Future<_AdisyonData> _future;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_AdisyonData> _load() async {
    final results = await Future.wait<dynamic>([
      widget.api
          .get('/api/admin/adisyonlar/open/${widget.customerId}')
          .catchError((_) => null),
      widget.api
          .get('/api/admin/adisyonlar/',
              query: {'page': 1, 'pageSize': 200})
          .catchError((_) => const <dynamic>[]),
    ]);
    final open = results[0] is Map
        ? (results[0] as Map).cast<String, dynamic>()
        : null;
    final history = apiItems(results[1])
        .where((a) =>
            '${a['customerId']}' == widget.customerId &&
            '${a['status']}' != 'Open')
        .toList()
      ..sort((x, y) =>
          '${y['createdAtUtc'] ?? ''}'.compareTo('${x['createdAtUtc'] ?? ''}'));
    return _AdisyonData(open: open, history: history);
  }

  Future<void> _refresh() async {
    setState(() { _future = _load(); });
    await _future;
    await widget.onChanged();
  }

  Future<void> _openSheet(String adisyonId) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => AdisyonDetailSheet(api: widget.api, adisyonId: adisyonId),
    );
    if (changed == true) await _refresh();
  }

  Future<void> _createAdisyon() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final created = await widget.api.post('/api/admin/adisyonlar/', {
        'branchId': widget.api.auth?.user?.branchId,
        'customerId': widget.customerId,
        'customerAccountId': null,
        'notes': null,
      });
      await _refresh();
      if (created is Map && created['id'] != null && mounted) {
        await _openSheet('${created['id']}');
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<_AdisyonData>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        final data = snapshot.data ?? const _AdisyonData(open: null, history: []);
        final open = data.open;
        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 32),
          children: [
            _Section(
              title: 'Açık Adisyon',
              icon: Icons.receipt_long_rounded,
              child: open == null
                  ? Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _empty(
                            'Açık adisyon yok. İşlemler önce adisyona düşer; onaylayınca cariye + kasaya aktarılır.'),
                        const SizedBox(height: 12),
                        FilledButton.icon(
                          onPressed: _busy ? null : _createAdisyon,
                          icon: const Icon(Icons.add_rounded),
                          label: const Text('Adisyon Aç'),
                        ),
                      ],
                    )
                  : _openAdisyonCard(open),
            ),
            if (widget.accounts.isNotEmpty)
              _Section(
                title: 'Cari Hesaplar',
                icon: Icons.account_balance_wallet_rounded,
                child: Column(
                  children: [
                    for (final acc in widget.accounts) _cariRow(acc),
                  ],
                ),
              ),
            _Section(
              title: 'İşlem Defteri',
              icon: Icons.history_edu_rounded,
              child: data.history.isEmpty
                  ? _empty('Geçmiş işlem yok.')
                  : Column(
                      children: [
                        for (final a in data.history) _historyRow(a),
                      ],
                    ),
            ),
          ],
        );
      },
    );
  }

  Widget _openAdisyonCard(Map<String, dynamic> a) {
    final charge = (a['chargeTotal'] as num?)?.toDouble() ?? 0;
    final payment = (a['paymentTotal'] as num?)?.toDouble() ?? 0;
    final items = (a['items'] as List? ?? const []);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            StatusBadgePill(status: '${a['status']}'),
            const SizedBox(width: 8),
            Text('${items.length} kalem',
                style: const TextStyle(color: AppColors.muted, fontSize: 12)),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            _tot('Borç', charge, AppColors.ink),
            _tot('Tahsilat', payment, AppColors.success),
            _tot('Net', charge - payment, AppColors.primaryDark),
          ],
        ),
        const SizedBox(height: 14),
        FilledButton.icon(
          onPressed: () => _openSheet('${a['id']}'),
          icon: const Icon(Icons.edit_note_rounded),
          label: const Text('Adisyonu Aç / Düzenle'),
        ),
      ],
    );
  }

  Widget _tot(String label, double value, Color color) => Expanded(
        child: Column(
          children: [
            Text(label,
                style: const TextStyle(fontSize: 11, color: AppColors.muted)),
            const SizedBox(height: 2),
            Text(CalendarText.tl(value),
                style: TextStyle(
                    fontWeight: FontWeight.w800, fontSize: 15, color: color)),
          ],
        ),
      );

  Widget _historyRow(Map<String, dynamic> a) {
    final charge = (a['chargeTotal'] as num?)?.toDouble() ?? 0;
    final payment = (a['paymentTotal'] as num?)?.toDouble() ?? 0;
    final date = parseUtcToLocal(a['createdAtUtc']);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => _openSheet('${a['id']}'),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.surfaceSoft.withValues(alpha: .45),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Borç ${CalendarText.tl(charge)} · Tahsilat ${CalendarText.tl(payment)}',
                      style: const TextStyle(
                          fontWeight: FontWeight.w700, fontSize: 13),
                    ),
                    if (date != null) ...[
                      const SizedBox(height: 2),
                      Text(DateFormat('d MMM yyyy', 'tr_TR').format(date),
                          style: const TextStyle(
                              fontSize: 11, color: AppColors.muted)),
                    ],
                  ],
                ),
              ),
              StatusBadgePill(status: '${a['status']}'),
            ],
          ),
        ),
      ),
    );
  }

  Widget _cariRow(Map<String, dynamic> acc) {
    final paid = (acc['paidAmount'] as num?)?.toDouble() ?? 0;
    final remaining = (acc['remainingAmount'] as num?)?.toDouble() ?? 0;
    final open = remaining > 0;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => _openAccount(acc),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.surfaceSoft.withValues(alpha: .45),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(valueOf(acc, const ['name'], fallback: 'Cari hesap'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontWeight: FontWeight.w700, fontSize: 13)),
                    const SizedBox(height: 2),
                    Text('Ödenen ${CalendarText.tl(paid)}',
                        style: const TextStyle(
                            fontSize: 11, color: AppColors.muted)),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(open ? 'Kalan' : 'Kapandı',
                      style:
                          const TextStyle(fontSize: 9.5, color: AppColors.muted)),
                  Text(CalendarText.tl(remaining),
                      style: TextStyle(
                          fontWeight: FontWeight.w800,
                          color: open ? AppColors.danger : AppColors.success)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _openAccount(Map<String, dynamic> acc) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => AccountDetailSheet(
        api: widget.api,
        account: acc,
        onChanged: () {},
      ),
    );
    await widget.onChanged();
  }
}

class _AdisyonData {
  const _AdisyonData({required this.open, required this.history});
  final Map<String, dynamic>? open;
  final List<Map<String, dynamic>> history;
}

// ===========================================================================
// SAĞLIK & GÜNLÜK
// ===========================================================================
class _HealthTab extends StatefulWidget {
  const _HealthTab({
    required this.api,
    required this.customerId,
    required this.customerName,
    super.key,
  });
  final ApiClient api;
  final String customerId;
  final String customerName;

  @override
  State<_HealthTab> createState() => _HealthTabState();
}

class _HealthTabState extends State<_HealthTab> {
  late Future<Map<String, dynamic>?> _future;

  static const _flagLabels = <String, String>{
    'isPregnant': 'Gebelik',
    'isBreastfeeding': 'Emzirme',
    'hasPacemakerOrImplant': 'Kalp pili / implant',
    'hasEpilepsy': 'Epilepsi',
    'hasDiabetes': 'Diyabet',
    'hasCancerHistory': 'Kanser öyküsü',
    'usesBloodThinners': 'Kan sulandırıcı',
    'usedIsotretinoin': 'İzotretinoin',
    'hasKeloidTendency': 'Keloid eğilimi',
    'hasActiveSkinIssue': 'Aktif cilt sorunu',
    'recentSunExposure': 'Son dönem güneş',
  };

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<Map<String, dynamic>?> _load() async {
    try {
      final data = await widget.api
          .get('/api/admin/customers/${widget.customerId}/consultation');
      return data is Map ? data.cast<String, dynamic>() : null;
    } catch (_) {
      return null;
    }
  }

  void _goConsultation() {
    context.push('/consultation', extra: {
      'customerId': widget.customerId,
      'customerName': widget.customerName,
    }).then((_) {
      if (mounted) setState(() { _future = _load(); });
    });
  }

  void _goJournal() {
    context.push('/treatment-journal', extra: {
      'customerId': widget.customerId,
      'customerName': widget.customerName,
    });
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 32),
      children: [
        FutureBuilder<Map<String, dynamic>?>(
          future: _future,
          builder: (context, snapshot) {
            final form = snapshot.data;
            final hasForm = form?['id'] != null;
            final markedFlags = hasForm
                ? _flagLabels.entries
                    .where((e) => form![e.key] == true)
                    .map((e) => e.value)
                    .toList()
                : <String>[];
            final consent = form?['consentGiven'] == true;
            return _Section(
              title: 'Müşteri Bilgi ve Onay Formu',
              icon: Icons.assignment_rounded,
              trailing: TextButton.icon(
                onPressed: _goConsultation,
                icon: Icon(hasForm ? Icons.edit_rounded : Icons.add_rounded,
                    size: 16),
                label: Text(hasForm ? 'Aç / Düzenle' : 'Form oluştur'),
                style: TextButton.styleFrom(
                    foregroundColor: AppColors.primaryDark,
                    padding: const EdgeInsets.symmetric(horizontal: 8)),
              ),
              child: snapshot.connectionState != ConnectionState.done
                  ? const Padding(
                      padding: EdgeInsets.all(8),
                      child: Center(child: CircularProgressIndicator()))
                  : !hasForm
                      ? _empty(
                          'Henüz müşteri bilgi formu yok. İşlem öncesi beyanlar ve onam için form oluşturun.')
                      : Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (markedFlags.isNotEmpty)
                              Wrap(
                                spacing: 6,
                                runSpacing: 6,
                                children: [
                                  for (final f in markedFlags)
                                    _chip(f, AppColors.primaryDark),
                                ],
                              )
                            else
                              const Text('Belirgin beyan yok.',
                                  style: TextStyle(
                                      color: AppColors.muted, fontSize: 12.5)),
                            const SizedBox(height: 10),
                            _chip(
                              consent ? 'Onam alındı' : 'Onam yok',
                              consent ? AppColors.success : AppColors.warning,
                              icon: consent
                                  ? Icons.verified_user_rounded
                                  : Icons.warning_amber_rounded,
                            ),
                          ],
                        ),
            );
          },
        ),
        _Section(
          title: 'Tedavi Günlüğü',
          icon: Icons.photo_library_rounded,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'İşlem öncesi/sonrası fotoğraflar ve tedavi notları.',
                style: TextStyle(color: AppColors.muted, fontSize: 13),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _goJournal,
                icon: const Icon(Icons.collections_rounded, size: 18),
                label: const Text('Tedavi Günlüğünü Aç'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ===========================================================================
// NOTLAR
// ===========================================================================
class _NotesTab extends StatefulWidget {
  const _NotesTab({
    required this.api,
    required this.customer,
    required this.onChanged,
  });
  final ApiClient api;
  final Map<String, dynamic> customer;
  final Future<void> Function() onChanged;

  @override
  State<_NotesTab> createState() => _NotesTabState();
}

class _NotesTabState extends State<_NotesTab> {
  late final TextEditingController _note =
      TextEditingController(text: '${widget.customer['notes'] ?? ''}');
  bool _savingNote = false;
  bool _busyBlacklist = false;

  String get _id => '${widget.customer['id']}';

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Map<String, dynamic> _fullPayload(Map<String, dynamic> extra) => {
        'branchId':
            widget.customer['branchId'] ?? widget.api.auth?.user?.branchId,
        'fullName': widget.customer['fullName'],
        'phone': widget.customer['phone'],
        'email': widget.customer['email'],
        'birthDate': widget.customer['birthDate'],
        'gender': widget.customer['gender'] ?? 'Unspecified',
        'kvkkConsent': widget.customer['kvkkConsent'] == true,
        'notes': widget.customer['notes'],
        ...extra,
      };

  Future<void> _saveNote() async {
    final text = _note.text.trim();
    if (text == '${widget.customer['notes'] ?? ''}'.trim()) return;
    setState(() => _savingNote = true);
    try {
      await widget.api.put(
          '/api/admin/customers/$_id', _fullPayload({'notes': text.isEmpty ? null : text}));
      widget.customer['notes'] = text;
      await widget.onChanged();
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Not kaydedildi.')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _savingNote = false);
    }
  }

  Future<void> _toggleBlacklist(bool next, String? reason) async {
    setState(() => _busyBlacklist = true);
    try {
      await widget.api.post('/api/admin/customers/$_id/blacklist', {
        'blacklisted': next,
        'reason': next ? (reason?.trim().isEmpty == true ? null : reason?.trim()) : null,
      });
      widget.customer['isBlacklisted'] = next;
      await widget.onChanged();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(
                next ? 'Kara listeye alındı.' : 'Kara listeden çıkarıldı.')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _busyBlacklist = false);
    }
  }

  Future<void> _askBlacklist() async {
    final controller = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Kara listeye al'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
              labelText: 'Sebep (opsiyonel)', hintText: 'ör. tekrar no-show'),
          maxLines: 2,
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Vazgeç')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Kara listeye al'),
          ),
        ],
      ),
    );
    if (ok == true) await _toggleBlacklist(true, controller.text);
  }

  @override
  Widget build(BuildContext context) {
    final blacklisted = widget.customer['isBlacklisted'] == true;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 32),
      children: [
        _Section(
          title: 'Müşteri Notu',
          icon: Icons.note_alt_rounded,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _note,
                minLines: 4,
                maxLines: 8,
                decoration: const InputDecoration(
                  hintText:
                      'Tercih, cilt tipi, alerji, kampanya isteği vb.',
                  isDense: true,
                ),
              ),
              const SizedBox(height: 10),
              FilledButton.icon(
                onPressed: _savingNote ? null : _saveNote,
                icon: _savingNote
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.check_rounded, size: 18),
                label: const Text('Notu Kaydet'),
              ),
            ],
          ),
        ),
        _Section(
          title: 'Kara Liste',
          icon: Icons.block_rounded,
          child: blacklisted
              ? Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.danger.withValues(alpha: .07),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                            color: AppColors.danger.withValues(alpha: .3)),
                      ),
                      child: Text(
                        'Bu müşteri kara listede — randevu verilemez.${widget.customer['blacklistReason'] != null ? ' Sebep: ${widget.customer['blacklistReason']}' : ''}',
                        style: const TextStyle(
                            color: AppColors.danger, fontSize: 12.5),
                      ),
                    ),
                    const SizedBox(height: 10),
                    OutlinedButton.icon(
                      onPressed: _busyBlacklist
                          ? null
                          : () => _toggleBlacklist(false, null),
                      icon: const Icon(Icons.verified_user_rounded, size: 18),
                      label: const Text('Kara listeden çıkar'),
                    ),
                  ],
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text(
                      'Kara listedeki müşteriye randevu verilemez.',
                      style: TextStyle(color: AppColors.muted, fontSize: 13),
                    ),
                    const SizedBox(height: 10),
                    OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.danger),
                      onPressed: _busyBlacklist ? null : _askBlacklist,
                      icon: const Icon(Icons.block_rounded, size: 18),
                      label: const Text('Kara listeye al'),
                    ),
                  ],
                ),
        ),
      ],
    );
  }
}

// ===========================================================================
// Ortak parça widget'lar
// ===========================================================================

class _Seg {
  const _Seg(this.label, this.value, this.color, this.sub);
  final String label;
  final double value;
  final Color color;
  final String sub;
}

/// Küçük donut + yüzde/bar lejant (web MiniDonut karşılığı).
class _DonutDistribution extends StatelessWidget {
  const _DonutDistribution({required this.segments, this.valueIsMoney = false});
  final List<_Seg> segments;
  final bool valueIsMoney;

  @override
  Widget build(BuildContext context) {
    if (segments.isEmpty) {
      return _empty('Veri yok.');
    }
    final total = segments.fold<double>(0, (s, x) => s + x.value);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        SizedBox(
          width: 96,
          height: 96,
          child: CustomPaint(painter: _DonutPainter(segments, total)),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            children: [
              for (final seg in segments)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: _legendRow(seg, total),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _legendRow(_Seg seg, double total) {
    final pct = total > 0 ? (seg.value / total * 100).round() : 0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                  color: seg.color, borderRadius: BorderRadius.circular(3)),
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(seg.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, color: AppColors.ink)),
            ),
            const SizedBox(width: 6),
            Text(seg.sub,
                style: const TextStyle(fontSize: 10, color: AppColors.muted)),
            const SizedBox(width: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
              decoration: BoxDecoration(
                  color: seg.color.withValues(alpha: .12),
                  borderRadius: BorderRadius.circular(6)),
              child: Text('%$pct',
                  style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: seg.color)),
            ),
          ],
        ),
        const SizedBox(height: 4),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: pct / 100,
            minHeight: 5,
            backgroundColor: AppColors.surfaceSoft,
            color: seg.color,
          ),
        ),
      ],
    );
  }
}

class _DonutPainter extends CustomPainter {
  _DonutPainter(this.segments, this.total);
  final List<_Seg> segments;
  final double total;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2 - 6;
    const stroke = 11.0;
    final bg = Paint()
      ..color = const Color(0xFFF4E7EC)
      ..strokeWidth = stroke
      ..style = PaintingStyle.stroke;
    canvas.drawCircle(center, radius, bg);
    if (total <= 0) return;
    var start = -1.5708; // -90°
    final gap = segments.length > 1 ? 0.06 : 0.0;
    for (final seg in segments) {
      final sweep = (seg.value / total) * 6.28319;
      final paint = Paint()
        ..color = seg.color
        ..strokeWidth = stroke
        ..strokeCap = StrokeCap.round
        ..style = PaintingStyle.stroke;
      canvas.drawArc(
        Rect.fromCircle(center: center, radius: radius),
        start + gap / 2,
        (sweep - gap).clamp(0.02, 6.28319),
        false,
        paint,
      );
      start += sweep;
    }
  }

  @override
  bool shouldRepaint(covariant _DonutPainter old) =>
      old.segments != segments || old.total != total;
}

/// Randevu satırı — geçmiş/son randevu listelerinde.
class _ApptRow extends StatelessWidget {
  const _ApptRow({required this.appt});
  final Map<String, dynamic> appt;

  @override
  Widget build(BuildContext context) {
    final start = parseUtcToLocal(appt['startUtc']);
    final status = '${appt['status']}';
    final staff = valueOf(appt, const ['staffName'], fallback: '');
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        padding: const EdgeInsets.all(11),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: AppColors.surfaceSoft,
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(Icons.event_rounded,
                  size: 18, color: AppColors.primaryDark),
            ),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(valueOf(appt, const ['serviceName'], fallback: 'Hizmet'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontWeight: FontWeight.w700, fontSize: 13)),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      if (start != null)
                        Text(
                          '${DateFormat('d MMM', 'tr_TR').format(start)} · ${CalendarText.hm(start)}',
                          style: const TextStyle(
                              fontSize: 11, color: AppColors.muted),
                        ),
                      if (start != null && staff.isNotEmpty)
                        const Text('  ·  ',
                            style: TextStyle(
                                fontSize: 11, color: AppColors.muted)),
                      if (staff.isNotEmpty)
                        Flexible(
                          child: Text(staff,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontSize: 11, color: AppColors.primaryDark)),
                        ),
                    ],
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: CalendarText.statusColor(status).withValues(alpha: .12),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(CalendarText.statusLabel(status),
                  style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: CalendarText.statusColor(status))),
            ),
          ],
        ),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({
    required this.title,
    required this.icon,
    required this.child,
    this.trailing,
  });
  final String title;
  final IconData icon;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDark.withValues(alpha: .04),
            blurRadius: 24,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 15, color: AppColors.primary),
              const SizedBox(width: 7),
              Expanded(
                child: Text(title,
                    style: const TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w800,
                        color: AppColors.primaryDark)),
              ),
              if (trailing != null) trailing!,
            ],
          ),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }
}

Widget _infoRow(String label, String value) => _infoRowWidget(
      label,
      Text(value,
          textAlign: TextAlign.right,
          style: const TextStyle(
              fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.ink)),
    );

Widget _infoRowWidget(String label, Widget value) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: const TextStyle(fontSize: 12, color: AppColors.muted)),
          const SizedBox(width: 12),
          Expanded(child: Align(alignment: Alignment.centerRight, child: value)),
        ],
      ),
    );

Widget _chip(String label, Color color, {IconData? icon}) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .1),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: .28)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 13, color: color),
            const SizedBox(width: 4),
          ],
          Text(label,
              style: TextStyle(
                  color: color, fontSize: 11.5, fontWeight: FontWeight.w700)),
        ],
      ),
    );

Widget _empty(String text) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Text(text,
          style: const TextStyle(color: AppColors.muted, fontSize: 12.5)),
    );

String _fmtDate(dynamic value) {
  final d = parseUtcToLocal(value);
  if (d == null) {
    final s = '${value ?? ''}'.trim();
    return s.isEmpty ? '—' : s;
  }
  return DateFormat('d MMM yyyy', 'tr_TR').format(d);
}
