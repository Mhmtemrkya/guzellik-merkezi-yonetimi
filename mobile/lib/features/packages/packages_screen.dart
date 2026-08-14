import 'package:flutter/material.dart';

import '../../core/auth/permissions.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import '../appointments/calendar_theme.dart';
import '../catalog/catalog_kit.dart';
import 'package_form.dart';

/// PAKET KATALOĞU (mobil) — web `/panel/paketler?scope=packages` ekranının karşılığı.
///
/// 2026 Ağustos'unda web ile birlikte sıfırdan kuruldu. Eskiden burada genel amaçlı
/// `AsyncListPage` vardı: paketler düz bir listeydi, ne içerdikleri görünmüyordu.
///
/// İKİ AYRI İPTAL KAVRAMI, karıştırılmamalı:
///  • 'Cancelled'      → paket TANIMI iptal edildi (kurum vazgeçti, gerekçesiyle).
///  • 'Müşteri iptali' → paketin MÜŞTERİ SATIŞI iptal edildi; paketin durumu değişmez.
///    Kaynak İPTAL ARŞİVİ'dir (`/api/admin/accounts/cancelled`), canlı cari listesi değil.
class PackagesScreen extends StatefulWidget {
  const PackagesScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<PackagesScreen> createState() => _PackagesScreenState();
}

class _PackageData {
  const _PackageData({required this.packages, required this.cancelledPackageIds});
  final List<Map<String, dynamic>> packages;
  final Set<String> cancelledPackageIds;
}

const _sortOptions = <(String, String)>[
  ('name', 'Ada göre (A→Z)'),
  ('price-desc', 'Fiyat: yüksekten'),
  ('price-asc', 'Fiyat: düşükten'),
  ('sessions-desc', 'Seans: çoktan'),
];

class _PackagesScreenState extends State<PackagesScreen> {
  late Future<_PackageData> _future;
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

  Future<_PackageData> _load() async {
    final packages = await fetchAllCatalogPages(widget.api, '/api/admin/packages/');
    final cancelledIds = <String>{};
    try {
      final raw = await widget.api.get('/api/admin/accounts/cancelled');
      for (final sale in apiItems(raw)) {
        final id = '${sale['servicePackageId'] ?? ''}'.trim();
        if (id.isNotEmpty && id != 'null') cancelledIds.add(id);
      }
    } catch (_) {
      // İptal arşivi okunamazsa sekme boş kalır; katalog listesi yine çalışır.
    }
    return _PackageData(packages: packages, cancelledPackageIds: cancelledIds);
  }

  Future<void> _reload() async {
    setState(() => _future = _load());
    await _future;
  }

  String _categoryLabel(Map<String, dynamic> item) {
    final raw = '${item['category'] ?? ''}'.trim();
    return raw.isEmpty ? 'Kategorisiz' : raw;
  }

  num _price(Map<String, dynamic> item) => (item['totalPrice'] as num?) ?? 0;
  int _sessions(Map<String, dynamic> item) {
    final total = item['totalSessions'];
    if (total is num) return total.toInt();
    final items = item['items'];
    if (items is List) {
      var sum = 0;
      for (final line in items) {
        if (line is Map) sum += ((line['sessionCount'] as num?) ?? 0).toInt();
      }
      return sum;
    }
    return 0;
  }

  List<Map<String, dynamic>> _itemsOf(Map<String, dynamic> pkg) {
    final items = pkg['items'];
    if (items is! List) return const [];
    return items.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList();
  }

  List<Map<String, dynamic>> _filtered(_PackageData data) {
    var list = data.packages.where((pkg) {
      if (_status == 'customerCancel') {
        if (!data.cancelledPackageIds.contains('${pkg['id']}')) return false;
      } else if (_status != 'all' && catalogStatusOf(pkg) != _status) {
        return false;
      }
      if (_category.isNotEmpty && _categoryLabel(pkg) != _category) return false;
      if (_query.trim().isNotEmpty) {
        final needle = _query.trim().toLowerCase();
        final contents = _itemsOf(pkg).map((i) => '${i['serviceName'] ?? ''}').join(' ');
        final haystack = '${pkg['name'] ?? ''} ${pkg['category'] ?? ''} $contents'.toLowerCase();
        if (!haystack.contains(needle)) return false;
      }
      return true;
    }).toList();

    switch (_sort) {
      case 'price-desc':
        list.sort((a, b) => _price(b).compareTo(_price(a)));
      case 'price-asc':
        list.sort((a, b) => _price(a).compareTo(_price(b)));
      case 'sessions-desc':
        list.sort((a, b) => _sessions(b).compareTo(_sessions(a)));
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
      builder: (_) => PackageForm(api: widget.api, item: item),
    );
    if (changed == true) await _reload();
  }

  Future<void> _deleteSelected() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Onay'),
        content: Text('${_selected.length} paket silinsin mi? Bu işlem geri alınamaz.'),
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
        await widget.api.delete('/api/admin/packages/$id');
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
                label: const Text('Paket ekle'),
              )
            : null,
        bottomNavigationBar: _selected.isEmpty
            ? null
            : SafeArea(
                child: CatalogBulkBar(
                  count: _selected.length,
                  itemLabel: 'paket',
                  busy: _bulkBusy,
                  onClear: () => setState(_selected.clear),
                  onDelete: _deleteSelected,
                ),
              ),
        body: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: _reload,
            child: FutureBuilder<_PackageData>(
              future: _future,
              builder: (context, snapshot) {
                final data = snapshot.data ??
                    const _PackageData(packages: [], cancelledPackageIds: <String>{});
                final loading =
                    snapshot.connectionState != ConnectionState.done && !snapshot.hasData;
                final packages = data.packages;
                final filtered = _filtered(data);

                final counts = <String, int>{};
                for (final pkg in packages) {
                  final key = catalogStatusOf(pkg);
                  counts[key] = (counts[key] ?? 0) + 1;
                }
                final customerCancelled = packages
                    .where((p) => data.cancelledPackageIds.contains('${p['id']}'))
                    .length;

                final categoryCounts = <String, int>{};
                for (final pkg in packages) {
                  final key = _categoryLabel(pkg);
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
                      title: 'Paketler',
                      subtitle: 'Seans paketleri, içerik, peşinat ve taksit yönetimi.',
                    ),
                    const SizedBox(height: 16),
                    CatalogOverviewCard(
                      icon: Icons.workspaces_rounded,
                      eyebrow: 'Paket kataloğu',
                      total: packages.length,
                      totalLabel: 'tanımlı paket',
                      facts: _facts(packages, categoryCounts.length),
                      segments: CatalogSegments(
                        value: _status,
                        onChanged: (next) => setState(() => _status = next),
                        options: [
                          (key: 'all', label: 'Tümü', count: packages.length),
                          (key: 'Active', label: 'Aktif', count: counts['Active'] ?? 0),
                          (key: 'Passive', label: 'Pasif', count: counts['Passive'] ?? 0),
                          (key: 'Draft', label: 'Taslak', count: counts['Draft'] ?? 0),
                          (key: 'Archived', label: 'Arşiv', count: counts['Archived'] ?? 0),
                          (key: 'Cancelled', label: 'İptal ettiğimiz', count: counts['Cancelled'] ?? 0),
                          (key: 'customerCancel', label: 'Müşteri iptali', count: customerCancelled),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    CatalogSearchField(
                      controller: _search,
                      hint: 'Paket adı, kategori veya içindeki hizmet…',
                      onChanged: (value) => setState(() => _query = value),
                    ),
                    const SizedBox(height: 10),
                    _sortRow(filtered.length),
                    const SizedBox(height: 10),
                    CatalogCategoryStrip(
                      value: _category,
                      total: packages.length,
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
                        icon: Icons.workspaces_rounded,
                        title: packages.isEmpty ? 'Henüz paket yok' : 'Süzgeçle eşleşen paket yok',
                        hint: packages.isEmpty
                            ? '“Paket ekle” ile başlayın: hizmet havuzundan hizmet seçin, fiyat ve '
                                'peşinat otomatik hesaplansın.'
                            : _status == 'customerCancel'
                                ? 'Bu sekmede yalnızca müşteri satışı iptal edilen paketler listelenir.'
                                : 'Arama metnini veya durum/kategori süzgecini değiştirmeyi deneyin.',
                        action: packages.isEmpty && _canManage
                            ? FilledButton.icon(
                                onPressed: () => _openForm(),
                                style: FilledButton.styleFrom(minimumSize: const Size(0, 46)),
                                icon: const Icon(Icons.add_rounded, size: 18),
                                label: const Text('İlk paketi oluştur'),
                              )
                            : null,
                      )
                    else
                      for (final pkg in filtered) ...[
                        _packageCard(pkg),
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
    List<Map<String, dynamic>> packages,
    int categoryCount,
  ) {
    final facts = <({String label, String value})>[
      (label: 'Kategori', value: '$categoryCount'),
    ];
    if (packages.isEmpty) return facts;
    final prices = packages.map((p) => _price(p).toDouble()).where((p) => p > 0).toList();
    final sessions = packages.map(_sessions).where((s) => s > 0).toList();
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
    if (sessions.isNotEmpty) {
      final min = sessions.reduce((a, b) => a < b ? a : b);
      final max = sessions.reduce((a, b) => a > b ? a : b);
      facts.add((label: 'Seans', value: min == max ? '$min' : '$min–$max'));
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

  Widget _packageCard(Map<String, dynamic> pkg) {
    final id = '${pkg['id'] ?? ''}';
    final status = catalogStatusOf(pkg);
    final selected = _selected.contains(id);
    final items = _itemsOf(pkg);
    final deposit = (pkg['depositAmount'] as num?) ?? 0;
    final installments = ((pkg['installmentCount'] as num?) ?? 0).toInt();

    // İndirim ölçülü aritmetiktir: kalem toplamı − satış fiyatı. Tahmini kâr YOK.
    var subtotal = 0.0;
    for (final line in items) {
      subtotal += (((line['unitPrice'] as num?) ?? 0) * ((line['sessionCount'] as num?) ?? 0))
          .toDouble();
    }
    final discount = subtotal - _price(pkg).toDouble();

    return CatalogCard(
      status: status,
      selected: selected,
      onTap: () {
        if (_selected.isNotEmpty) {
          setState(() => selected ? _selected.remove(id) : _selected.add(id));
          return;
        }
        _openForm(pkg);
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
                    selected ? Icons.check_rounded : Icons.workspaces_rounded,
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
                        '${pkg['name'] ?? '—'}',
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
                      CatalogChip(_categoryLabel(pkg)),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                CatalogStatusPill(status),
              ],
            ),
            if (items.isNotEmpty) ...[
              const SizedBox(height: 9),
              Wrap(
                spacing: 5,
                runSpacing: 5,
                children: [
                  for (final line in items.take(3))
                    CatalogChip('${line['serviceName'] ?? '—'} ×${line['sessionCount'] ?? 1}'),
                  if (items.length > 3) CatalogChip('+${items.length - 3} hizmet'),
                ],
              ),
            ],
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
                  Expanded(child: CatalogMeta(label: 'Seans', value: '${_sessions(pkg)}')),
                  Expanded(child: CatalogMeta(label: 'Satış', value: CalendarText.tl(_price(pkg)))),
                  Expanded(
                    child: CatalogMeta(
                      label: 'Peşinat',
                      value: deposit > 0 ? CalendarText.tl(deposit) : '—',
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 9),
            Row(
              children: [
                if (discount > 0.5)
                  Expanded(
                    child: Row(
                      children: [
                        const Icon(Icons.sell_rounded, size: 14, color: AppColors.success),
                        const SizedBox(width: 5),
                        Expanded(
                          child: Text(
                            'Ara toplamdan ${CalendarText.tl(discount)} indirimli',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: AppColors.success,
                            ),
                          ),
                        ),
                      ],
                    ),
                  )
                else
                  Expanded(
                    child: Text(
                      installments > 0 ? '$installments ay taksit' : 'Taksitsiz',
                      style: const TextStyle(fontSize: 11, color: AppColors.muted),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
