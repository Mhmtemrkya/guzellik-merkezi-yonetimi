import 'package:flutter/material.dart';

import '../../core/auth/permissions.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import '../appointments/calendar_theme.dart';
import '../catalog/catalog_kit.dart';
import '../catalog/catalog_sales_panel.dart';
import 'service_form.dart';

/// HİZMET KATALOĞU (mobil) — web `/panel/paketler?scope=services` ekranının karşılığı.
///
/// 2026 Ağustos'unda web ile birlikte sıfırdan kuruldu. Eskiden burada genel amaçlı
/// `AsyncListPage` vardı: hizmetler düz bir liste olarak çıkıyor, durum/kategori süzgeci
/// bulunmuyor, karta basınca doğrudan düzenleme formu açılıyordu.
///
/// Yeni akış web ile birebir:
///  • Tek genel bakış kartı (sayaçlar doğrudan süzgeç) + arama + kategori şeridi
///  • Kart ızgarası; karta basınca KÜNYE sayfası açılır (düzenleme ayrı bir adım)
///  • Künyede yalnız GERÇEK veri: kaydın kendi alanları, hizmeti içeren paketler,
///    uzmanlık tanımına göre bu hizmeti verebilen personel ve sunucudan bu hizmete
///    göre süzülen satış listesi. Tahmini kâr / kapsamı kesilmiş "rezervasyon" yok.
class ServicesScreen extends StatefulWidget {
  const ServicesScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<ServicesScreen> createState() => _ServicesScreenState();
}

class _CatalogData {
  const _CatalogData({required this.services, required this.packages, required this.staff});
  final List<Map<String, dynamic>> services;
  final List<Map<String, dynamic>> packages;
  final List<Map<String, dynamic>> staff;
}

const _sortOptions = <(String, String)>[
  ('name', 'Ada göre (A→Z)'),
  ('price-desc', 'Fiyat: yüksekten'),
  ('price-asc', 'Fiyat: düşükten'),
  ('duration-desc', 'Süre: uzundan'),
  ('duration-asc', 'Süre: kısadan'),
];

class _ServicesScreenState extends State<ServicesScreen> {
  late Future<_CatalogData> _future;
  final _search = TextEditingController();

  String _status = 'all';
  String _category = '';
  String _sort = 'name';
  String _query = '';

  final Set<String> _selected = <String>{};
  bool _bulkBusy = false;

  bool get _canManage => widget.api.auth?.user?.canAction(Perm.servicesManage) ?? true;
  bool get _canDelete => widget.api.auth?.user?.canAction(Perm.servicesDelete) ?? true;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<_CatalogData> _load() async {
    final services = await fetchAllCatalogPages(widget.api, '/api/admin/services/');
    final packages = await widget.api
        .get('/api/admin/packages/', query: {'page': 1, 'pageSize': 200})
        .then(apiItems)
        .catchError((_) => <Map<String, dynamic>>[]);
    final staff = await widget.api
        .get('/api/admin/staff/', query: {'page': 1, 'pageSize': 200})
        .then(apiItems)
        .catchError((_) => <Map<String, dynamic>>[]);
    return _CatalogData(services: services, packages: packages, staff: staff);
  }

  Future<void> _reload() async {
    setState(() => _future = _load());
    await _future;
  }

  /// HAM kategori adı — API alanı. Gösterimde boşsa "Kategorisiz" yazılır ama
  /// PAYLOAD'a asla uydurma bir ad girmez (web'deki normalizer tuzağının karşılığı).
  String _rawCategory(Map<String, dynamic> item) => '${item['category'] ?? ''}'.trim();
  String _categoryLabel(Map<String, dynamic> item) {
    final raw = _rawCategory(item);
    return raw.isEmpty ? 'Kategorisiz' : raw;
  }

  num _price(Map<String, dynamic> item) => (item['price'] as num?) ?? 0;
  int _duration(Map<String, dynamic> item) => ((item['durationMinutes'] as num?) ?? 0).toInt();

  List<Map<String, dynamic>> _filtered(List<Map<String, dynamic>> services) {
    var list = services.where((service) {
      if (_status != 'all' && catalogStatusOf(service) != _status) return false;
      if (_category.isNotEmpty && _categoryLabel(service) != _category) return false;
      if (_query.trim().isNotEmpty) {
        final needle = _query.trim().toLowerCase();
        final haystack =
            '${service['name'] ?? ''} ${service['category'] ?? ''} ${service['subCategory'] ?? ''}'
                .toLowerCase();
        if (!haystack.contains(needle)) return false;
      }
      return true;
    }).toList();

    switch (_sort) {
      case 'price-desc':
        list.sort((a, b) => _price(b).compareTo(_price(a)));
      case 'price-asc':
        list.sort((a, b) => _price(a).compareTo(_price(b)));
      case 'duration-desc':
        list.sort((a, b) => _duration(b).compareTo(_duration(a)));
      case 'duration-asc':
        list.sort((a, b) => _duration(a).compareTo(_duration(b)));
      default:
        list.sort((a, b) => '${a['name']}'.toLowerCase().compareTo('${b['name']}'.toLowerCase()));
    }
    return list;
  }

  Future<void> _openForm([Map<String, dynamic>? item]) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: AppColors.background,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => ServiceForm(api: widget.api, item: item),
    );
    if (changed == true) await _reload();
  }

  Future<void> _openDetail(Map<String, dynamic> service, _CatalogData data) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _ServiceDetailSheet(
        api: widget.api,
        service: service,
        packages: data.packages,
        staff: data.staff,
        canManage: _canManage,
        canDelete: _canDelete,
        onEdit: () => _openForm(service),
      ),
    );
    if (changed == true) await _reload();
  }

  Future<void> _deleteSelected() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Onay'),
        content: Text('${_selected.length} hizmet silinsin mi? Bu işlem geri alınamaz.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Vazgeç')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sil'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _bulkBusy = true);
    var failed = 0;
    for (final id in _selected.toList()) {
      try {
        await widget.api.delete('/api/admin/services/$id');
      } catch (_) {
        failed++;
      }
    }
    if (!mounted) return;
    setState(() {
      _selected.clear();
      _bulkBusy = false;
    });
    if (failed > 0) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('$failed kayıt silinemedi.')));
    }
    await _reload();
  }

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        floatingActionButton: _canManage && _selected.isEmpty
            ? FloatingActionButton.extended(
                onPressed: () => _openForm(),
                icon: const Icon(Icons.add_rounded),
                label: const Text('Hizmet ekle'),
              )
            : null,
        bottomNavigationBar: _selected.isEmpty
            ? null
            : SafeArea(
                child: CatalogBulkBar(
                  count: _selected.length,
                  itemLabel: 'hizmet',
                  busy: _bulkBusy,
                  onClear: () => setState(_selected.clear),
                  onDelete: _deleteSelected,
                ),
              ),
        body: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: _reload,
            child: FutureBuilder<_CatalogData>(
              future: _future,
              builder: (context, snapshot) {
                final data = snapshot.data ??
                    const _CatalogData(services: [], packages: [], staff: []);
                final loading =
                    snapshot.connectionState != ConnectionState.done && !snapshot.hasData;
                final services = data.services;
                final filtered = _filtered(services);

                final counts = <String, int>{};
                for (final service in services) {
                  final key = catalogStatusOf(service);
                  counts[key] = (counts[key] ?? 0) + 1;
                }

                final categoryCounts = <String, int>{};
                for (final service in services) {
                  final key = _categoryLabel(service);
                  categoryCounts[key] = (categoryCounts[key] ?? 0) + 1;
                }
                final categories = categoryCounts.entries
                    .map((e) => (name: e.key, count: e.value))
                    .toList()
                  ..sort((a, b) => b.count.compareTo(a.count));

                return ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 120),
                  children: [
                    const PageHeader(
                      eyebrow: 'İşletme',
                      title: 'Hizmetler',
                      subtitle: 'Hizmet havuzu, süre, seans ve fiyat yönetimi.',
                    ),
                    const SizedBox(height: 16),
                    CatalogOverviewCard(
                      icon: Icons.auto_awesome_rounded,
                      eyebrow: 'Hizmet kataloğu',
                      total: services.length,
                      totalLabel: 'tanımlı hizmet',
                      facts: _facts(services, categoryCounts.length),
                      segments: CatalogSegments(
                        value: _status,
                        onChanged: (next) => setState(() => _status = next),
                        options: [
                          (key: 'all', label: 'Tümü', count: services.length),
                          (key: 'Active', label: 'Aktif', count: counts['Active'] ?? 0),
                          (key: 'Passive', label: 'Pasif', count: counts['Passive'] ?? 0),
                          (key: 'Draft', label: 'Taslak', count: counts['Draft'] ?? 0),
                          (key: 'Archived', label: 'Arşiv', count: counts['Archived'] ?? 0),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    CatalogSearchField(
                      controller: _search,
                      hint: 'Hizmet, kategori veya alt kategori ara…',
                      onChanged: (value) => setState(() => _query = value),
                    ),
                    const SizedBox(height: 10),
                    _sortRow(filtered.length),
                    const SizedBox(height: 10),
                    CatalogCategoryStrip(
                      value: _category,
                      total: services.length,
                      options: categories,
                      onChanged: (name) => setState(() => _category = name),
                    ),
                    const SizedBox(height: 14),
                    if (loading)
                      const Padding(
                        padding: EdgeInsets.all(40),
                        child: Center(child: CircularProgressIndicator()),
                      )
                    else if (snapshot.hasError)
                      CatalogEmpty(
                        icon: Icons.cloud_off_rounded,
                        title: 'Katalog yüklenemedi',
                        hint: '${snapshot.error}',
                      )
                    else if (filtered.isEmpty)
                      CatalogEmpty(
                        icon: Icons.spa_rounded,
                        title: services.isEmpty
                            ? 'Henüz hizmet tanımlanmamış'
                            : 'Süzgeçle eşleşen hizmet yok',
                        hint: services.isEmpty
                            ? '“Hizmet ekle” ile ilk hizmetinizi tanımlayın; paketler bu havuzdan beslenir.'
                            : 'Arama metnini veya durum/kategori süzgecini değiştirmeyi deneyin.',
                      )
                    else
                      for (final service in filtered) ...[
                        _serviceCard(service, data),
                        const SizedBox(height: 10),
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

  /// Genel bakış rozetleri — yalnızca kataloğun KENDİ gerçekleri.
  List<({String label, String value})> _facts(
    List<Map<String, dynamic>> services,
    int categoryCount,
  ) {
    final facts = <({String label, String value})>[
      (label: 'Kategori', value: '$categoryCount'),
    ];
    if (services.isEmpty) return facts;
    final durations = services.map(_duration).where((d) => d > 0).toList();
    final prices = services.map((s) => _price(s).toDouble()).where((p) => p > 0).toList();
    if (durations.isNotEmpty) {
      final min = durations.reduce((a, b) => a < b ? a : b);
      final max = durations.reduce((a, b) => a > b ? a : b);
      facts.add((label: 'Süre', value: min == max ? '$min dk' : '$min–$max dk'));
    }
    if (prices.isNotEmpty) {
      final min = prices.reduce((a, b) => a < b ? a : b);
      final max = prices.reduce((a, b) => a > b ? a : b);
      facts.add((
        label: 'Fiyat',
        value: min == max
            ? CalendarText.tl(min)
            : '${CalendarText.tl(min)} – ${CalendarText.tl(max)}',
      ));
    }
    return facts;
  }

  Widget _sortRow(int count) {
    return Row(
      children: [
        Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.border),
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: _sort,
                isDense: true,
                isExpanded: true,
                icon: const Icon(Icons.expand_more_rounded, size: 18, color: AppColors.muted),
                style: const TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.ink,
                ),
                items: [
                  for (final option in _sortOptions)
                    DropdownMenuItem(value: option.$1, child: Text(option.$2)),
                ],
                onChanged: (value) => setState(() => _sort = value ?? _sort),
              ),
            ),
          ),
        ),
        const SizedBox(width: 10),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
          decoration: BoxDecoration(
            color: AppColors.surfaceSoft,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.border),
          ),
          child: Text(
            '$count kayıt',
            style: const TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
              color: Color(0xFF5A4B53),
            ),
          ),
        ),
      ],
    );
  }

  Widget _serviceCard(Map<String, dynamic> service, _CatalogData data) {
    final id = '${service['id'] ?? ''}';
    final status = catalogStatusOf(service);
    final selected = _selected.contains(id);
    final sub = '${service['subCategory'] ?? ''}'.trim();
    final sessions = ((service['defaultSessionCount'] as num?) ?? 1).toInt();
    final loyalty = ((service['loyaltyPointCost'] as num?) ?? 0).toInt();

    return CatalogCard(
      status: status,
      selected: selected,
      onTap: () {
        if (_selected.isNotEmpty) {
          setState(() => selected ? _selected.remove(id) : _selected.add(id));
          return;
        }
        _openDetail(service, data);
      },
      onLongPress: !_canDelete
          ? null
          : () => setState(() => selected ? _selected.remove(id) : _selected.add(id)),
      child: Padding(
        padding: const EdgeInsets.all(13),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 42,
                  height: 42,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: selected ? AppColors.primaryDark : AppColors.primary,
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Icon(
                    selected ? Icons.check_rounded : Icons.spa_rounded,
                    size: 21,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(width: 11),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${service['name'] ?? '—'}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w800,
                          height: 1.25,
                          color: AppColors.ink,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Wrap(
                        spacing: 5,
                        runSpacing: 5,
                        children: [
                          CatalogChip(_categoryLabel(service)),
                          if (sub.isNotEmpty) CatalogChip(sub),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                CatalogStatusPill(status),
              ],
            ),
            const SizedBox(height: 11),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              decoration: BoxDecoration(
                color: AppColors.surfaceSoft,
                borderRadius: BorderRadius.circular(13),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(
                children: [
                  Expanded(child: CatalogMeta(label: 'Süre', value: '${_duration(service)} dk')),
                  Expanded(child: CatalogMeta(label: 'Fiyat', value: CalendarText.tl(_price(service)))),
                  Expanded(
                    child: CatalogMeta(
                      label: 'Seans',
                      value: sessions <= 1 ? 'Tek' : '$sessions×',
                    ),
                  ),
                ],
              ),
            ),
            if (loyalty > 0) ...[
              const SizedBox(height: 9),
              Row(
                children: [
                  const Icon(Icons.card_giftcard_rounded, size: 15, color: AppColors.warning),
                  const SizedBox(width: 6),
                  Text(
                    'Sadakat puanıyla hediye edilebilir · $loyalty P',
                    style: const TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.warning,
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Hizmet künyesi — web'deki `ServiceDetailModal`'in mobil karşılığı.
class _ServiceDetailSheet extends StatefulWidget {
  const _ServiceDetailSheet({
    required this.api,
    required this.service,
    required this.packages,
    required this.staff,
    required this.canManage,
    required this.canDelete,
    required this.onEdit,
  });

  final ApiClient api;
  final Map<String, dynamic> service;
  final List<Map<String, dynamic>> packages;
  final List<Map<String, dynamic>> staff;
  final bool canManage;
  final bool canDelete;
  final Future<void> Function() onEdit;

  @override
  State<_ServiceDetailSheet> createState() => _ServiceDetailSheetState();
}

class _ServiceDetailSheetState extends State<_ServiceDetailSheet> {
  late String _status = catalogStatusOf(widget.service);
  bool _busy = false;
  int _tab = 0;

  String get _id => '${widget.service['id'] ?? ''}';
  String get _name => '${widget.service['name'] ?? '—'}';
  String get _rawCategory => '${widget.service['category'] ?? ''}'.trim();

  /// Durum değişimi — payload HAM alanlardan kurulur; uydurma kategori adı yazılmaz.
  Future<void> _setStatus(String next) async {
    setState(() => _busy = true);
    try {
      await widget.api.put('/api/admin/services/$_id', {
        'branchId': widget.service['branchId'] ?? widget.api.auth?.user?.branchId,
        'name': widget.service['name'],
        'category': _rawCategory.isEmpty ? null : _rawCategory,
        'subCategory': '${widget.service['subCategory'] ?? ''}'.trim().isEmpty
            ? null
            : widget.service['subCategory'],
        'durationMinutes': widget.service['durationMinutes'],
        'price': widget.service['price'],
        'defaultSessionCount': widget.service['defaultSessionCount'] ?? 1,
        'loyaltyPointCost': widget.service['loyaltyPointCost'],
        'iconKey': widget.service['iconKey'],
        'isActive': next == 'Active',
        'status': next,
      });
      if (!mounted) return;
      setState(() {
        _status = next;
        _busy = false;
      });
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Onay'),
        content: Text('“$_name” hizmeti silinsin mi?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Vazgeç')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sil'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      await widget.api.delete('/api/admin/services/$_id');
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final sub = '${widget.service['subCategory'] ?? ''}'.trim();
    final duration = ((widget.service['durationMinutes'] as num?) ?? 0).toInt();
    final price = (widget.service['price'] as num?) ?? 0;
    final sessions = ((widget.service['defaultSessionCount'] as num?) ?? 1).toInt();
    final loyalty = ((widget.service['loyaltyPointCost'] as num?) ?? 0).toInt();

    // Bu hizmeti içeren paketler — gerçek bağ (paket kaleminde serviceDefinitionId).
    final inPackages = widget.packages.where((pkg) {
      final items = pkg['items'];
      if (items is! List) return false;
      return items.any((item) => item is Map && '${item['serviceDefinitionId']}' == _id);
    }).toList();

    // Uzmanlığı bu hizmete AÇIKÇA uyan aktif personel (randevu ekranıyla aynı kural).
    final matched = widget.staff.where((member) {
      if (member['isActive'] == false) return false;
      final specialties = '${member['specialties'] ?? ''}'.trim();
      if (specialties.isEmpty) return false;
      return staffCanPerform(specialties, _rawCategory, _name);
    }).toList();
    final unrestricted = widget.staff
        .where((member) =>
            member['isActive'] != false && '${member['specialties'] ?? ''}'.trim().isEmpty)
        .length;

    return DraggableScrollableSheet(
      initialChildSize: .92,
      minChildSize: .5,
      maxChildSize: .96,
      expand: false,
      builder: (context, controller) => Container(
        clipBehavior: Clip.antiAlias,
        decoration: const BoxDecoration(
          color: AppColors.background,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          children: [
            _header(sub, duration, price),
            _tabs(),
            Expanded(
              child: _tab == 0
                  ? ListView(
                      controller: controller,
                      padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
                      children: [
                        Row(
                          children: [
                            Expanded(child: CatalogFact(label: 'Süre', value: '$duration dk')),
                            const SizedBox(width: 9),
                            Expanded(
                              child: CatalogFact(label: 'Fiyat', value: CalendarText.tl(price)),
                            ),
                          ],
                        ),
                        const SizedBox(height: 9),
                        Row(
                          children: [
                            Expanded(
                              child: CatalogFact(
                                label: 'Varsayılan seans',
                                value: sessions <= 1 ? 'Tek seans' : '$sessions seans',
                              ),
                            ),
                            const SizedBox(width: 9),
                            Expanded(
                              child: CatalogFact(
                                label: 'Sadakat puanı',
                                value: loyalty > 0 ? '$loyalty P' : 'Hediye edilemez',
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        CatalogSection(
                          title: 'Bu hizmeti verebilen personel',
                          hint: 'Personel kartındaki uzmanlık alanına göre — randevu ekranının '
                              'kullandığı kuralın aynısı.',
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (matched.isEmpty)
                                const Text(
                                  'Uzmanlık alanı bu kategoriye ayarlı personel yok.',
                                  style: TextStyle(fontSize: 12, color: Color(0xFF705A66)),
                                )
                              else
                                Wrap(
                                  spacing: 6,
                                  runSpacing: 6,
                                  children: [
                                    for (final member in matched)
                                      CatalogChip(
                                        '${member['fullName'] ?? member['name'] ?? '—'}',
                                        tone: AppColors.primaryDark,
                                      ),
                                  ],
                                ),
                              if (unrestricted > 0) ...[
                                const SizedBox(height: 9),
                                Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    color: AppColors.surfaceSoft,
                                    borderRadius: BorderRadius.circular(12),
                                    border: Border.all(color: AppColors.border),
                                  ),
                                  child: Text(
                                    '$unrestricted personelin uzmanlık alanı tanımlı değil; onlara '
                                    'kısıt uygulanmaz, bu hizmete de atanabilirler.',
                                    style: const TextStyle(
                                      fontSize: 11.5,
                                      height: 1.4,
                                      color: Color(0xFF4A3A44),
                                    ),
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                        const SizedBox(height: 10),
                        CatalogSection(
                          title: 'Geçtiği paketler',
                          hint: 'Bu hizmeti içeren paket tanımları.',
                          trailing: CatalogChip('${inPackages.length}'),
                          child: inPackages.isEmpty
                              ? const Text(
                                  'Bu hizmet hiçbir pakete eklenmemiş.',
                                  style: TextStyle(fontSize: 12, color: Color(0xFF705A66)),
                                )
                              : Column(
                                  children: [
                                    for (final pkg in inPackages) _packageRow(pkg),
                                  ],
                                ),
                        ),
                        const SizedBox(height: 10),
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppColors.surface,
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(color: AppColors.border),
                          ),
                          child: const Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(Icons.info_outline_rounded, size: 16, color: AppColors.muted),
                              SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  'Bu ekranda tahmini rakam gösterilmez. Gerçek satış geçmişi ve '
                                  'tahsilat "Satışlar" sekmesindedir.',
                                  style: TextStyle(
                                    fontSize: 11.5,
                                    height: 1.4,
                                    color: Color(0xFF4A3A44),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    )
                  : ListView(
                      controller: controller,
                      padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
                      children: [
                        CatalogSalesPanel(
                          api: widget.api,
                          kind: 'service',
                          itemId: _id,
                          itemName: _name,
                          itemPrice: price.toDouble(),
                        ),
                      ],
                    ),
            ),
            _footer(),
          ],
        ),
      ),
    );
  }

  Widget _header(String sub, int duration, num price) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 14, 12, 14),
      color: AppColors.primary,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 42,
            height: 42,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .2),
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Icon(Icons.spa_rounded, size: 21, color: Colors.white),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'HİZMET KÜNYESİ',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: .9),
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1.6,
                  ),
                ),
                const SizedBox(height: 3),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        _name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                          height: 1.2,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: .22),
                        borderRadius: BorderRadius.circular(99),
                      ),
                      child: Text(
                        catalogStatusLabel(_status),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 10.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  '${_rawCategory.isEmpty ? 'Kategorisiz' : _rawCategory}'
                  '${sub.isEmpty ? '' : ' › $sub'} · $duration dk · ${CalendarText.tl(price)}',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: .9),
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: () => Navigator.pop(context, false),
            icon: const Icon(Icons.close_rounded, color: Colors.white),
          ),
        ],
      ),
    );
  }

  Widget _tabs() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 9, 12, 9),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(bottom: BorderSide(color: AppColors.border)),
      ),
      child: Row(
        children: [
          _tabButton('Künye', 0, Icons.description_rounded),
          const SizedBox(width: 6),
          _tabButton('Satışlar', 1, Icons.account_balance_wallet_rounded),
        ],
      ),
    );
  }

  Widget _tabButton(String label, int index, IconData icon) {
    final active = _tab == index;
    return Material(
      color: active ? AppColors.rose.withValues(alpha: .4) : Colors.transparent,
      borderRadius: BorderRadius.circular(99),
      child: InkWell(
        borderRadius: BorderRadius.circular(99),
        onTap: () => setState(() => _tab = index),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 15, color: active ? AppColors.primaryDark : AppColors.muted),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w800,
                  color: active ? AppColors.primaryDark : const Color(0xFF5A4B53),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _packageRow(Map<String, dynamic> pkg) {
    final items = pkg['items'];
    var sessions = 0;
    if (items is List) {
      for (final item in items) {
        if (item is Map && '${item['serviceDefinitionId']}' == _id) {
          sessions = ((item['sessionCount'] as num?) ?? 0).toInt();
        }
      }
    }
    return Container(
      margin: const EdgeInsets.only(bottom: 7),
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
      decoration: BoxDecoration(
        color: AppColors.surfaceSoft,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          const Icon(Icons.layers_rounded, size: 15, color: AppColors.primary),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              '${pkg['name'] ?? '—'}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                color: AppColors.ink,
              ),
            ),
          ),
          Text(
            sessions > 0 ? '$sessions seans' : '—',
            style: const TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w800,
              color: Color(0xFF5A4B53),
            ),
          ),
        ],
      ),
    );
  }

  Widget _footer() {
    if (!widget.canManage && !widget.canDelete) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 14),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          children: [
            if (widget.canManage)
              SizedBox(
                width: double.infinity,
                child: Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    if (_status != 'Active')
                      _action('Yayına al', Icons.cloud_upload_rounded, () => _setStatus('Active')),
                    if (_status == 'Active')
                      _action('Pasife al', Icons.pause_circle_outline_rounded,
                          () => _setStatus('Passive')),
                    if (_status != 'Draft')
                      _action('Taslağa al', Icons.description_rounded, () => _setStatus('Draft')),
                    if (_status != 'Archived')
                      _action('Arşivle', Icons.archive_rounded, () => _setStatus('Archived')),
                  ],
                ),
              ),
            const SizedBox(height: 10),
            Row(
              children: [
                if (widget.canDelete)
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _busy ? null : _delete,
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size(0, 46),
                        foregroundColor: AppColors.danger,
                        side: const BorderSide(color: AppColors.danger),
                      ),
                      icon: const Icon(Icons.delete_outline_rounded, size: 18),
                      label: const Text('Sil'),
                    ),
                  ),
                if (widget.canDelete && widget.canManage) const SizedBox(width: 10),
                if (widget.canManage)
                  Expanded(
                    flex: 2,
                    child: FilledButton.icon(
                      onPressed: _busy
                          ? null
                          : () async {
                              Navigator.pop(context, false);
                              await widget.onEdit();
                            },
                      style: FilledButton.styleFrom(minimumSize: const Size(0, 46)),
                      icon: const Icon(Icons.edit_rounded, size: 18),
                      label: const Text('Düzenle'),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _action(String label, IconData icon, VoidCallback onTap) {
    return OutlinedButton.icon(
      onPressed: _busy ? null : onTap,
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 40),
        foregroundColor: const Color(0xFF5A4B53),
        side: const BorderSide(color: AppColors.border),
        padding: const EdgeInsets.symmetric(horizontal: 12),
      ),
      icon: Icon(icon, size: 16),
      label: Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
    );
  }
}
