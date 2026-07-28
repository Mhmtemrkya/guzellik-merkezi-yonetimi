import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/auth/permissions.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/responsive.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';

const String _uncategorized = 'Kategorisiz';

/// Ağaçta bir üst kategori: kendi sayaçları + alt kategorileri.
class _Cat {
  _Cat(this.name);
  final String name;
  String? customId;
  int serviceCount = 0;
  int packageCount = 0;
  final Map<String, _Sub> subs = {};

  bool get isCustom => customId != null;
  int get total => serviceCount + packageCount;
}

class _Sub {
  _Sub(this.name);
  final String name;
  String? customId;
  int serviceCount = 0;
  int packageCount = 0;
  int get total => serviceCount + packageCount;
}

/// Hizmet + paket tek listede; tür rozetle ayrışır (web ile aynı desen).
class _Row {
  const _Row({
    required this.isPackage,
    required this.name,
    required this.sub,
    required this.meta,
    required this.price,
    required this.active,
  });
  final bool isPackage;
  final String name;
  final String sub;
  final String meta;
  final double price;
  final bool active;
}

class _CatData {
  const _CatData({
    required this.cats,
    required this.services,
    required this.packages,
    required this.rawCats,
  });
  final List<_Cat> cats;
  final List<Map<String, dynamic>> services;
  final List<Map<String, dynamic>> packages;

  /// Ham kategori kayıtları — sıralama (kardeş id listesi) ve üst/alt ilişkisi için.
  final List<Map<String, dynamic>> rawCats;
}

/// Kategoriler — web `paketler?scope=categories` sayfasının mobil karşılığı.
///
/// Web'deki "ağaç + içerik" yerleşiminin dar ekran uyarlaması: kategoriler akordeon
/// kart listesi; açılan kartta o kategorinin işlemleri (alt kategori ekle, yeniden
/// adlandır, sırala, sil), alt kategori süzgeci ve içindeki hizmet/paketler görünür.
///
/// Web ile aynı iki kural:
///  • Yeniden adlandırma kayıtları da taşır — kategori adı hizmet/paket üzerinde METİN
///    olarak durduğu için yalnız kategori kaydını değiştirmek kayıtları eski adla ortada
///    bırakır.
///  • Kaydı olmayan ("otomatik") kategori/alt kategori de silinebilir: adı kullanan
///    hizmet ve paketlerden temizlenir, kayıtların kendisi silinmez.
class ServiceCategoriesScreen extends StatefulWidget {
  const ServiceCategoriesScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<ServiceCategoriesScreen> createState() =>
      _ServiceCategoriesScreenState();
}

class _ServiceCategoriesScreenState extends State<ServiceCategoriesScreen> {
  late Future<_CatData> _future;
  final _money = NumberFormat.currency(locale: 'tr_TR', symbol: '₺', decimalDigits: 0);

  String _query = '';
  String? _openCat; // açık akordeon kartı
  String _selectedSub = ''; // '' = tümü
  int _typeTab = 0; // 0 tümü · 1 hizmet · 2 paket
  bool _busy = false;

  bool get _canManage =>
      widget.api.auth?.user?.canAction(Perm.servicesManage) ?? true;
  bool get _canDelete =>
      widget.api.auth?.user?.canAction(Perm.servicesDelete) ?? true;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_CatData> _load() async {
    final results = await Future.wait<dynamic>([
      widget.api
          .get('/api/admin/service-categories/')
          .catchError((_) => const <dynamic>[]),
      widget.api
          .getAllPaged('/api/admin/services/')
          .catchError((_) => <String, dynamic>{'items': const []}),
      widget.api
          .getAllPaged('/api/admin/packages/')
          .catchError((_) => <String, dynamic>{'items': const []}),
    ]);
    final rawCats = apiItems(results[0]);
    final services = apiItems(results[1]);
    final packages = apiItems(results[2]);

    final byId = {for (final c in rawCats) '${c['id']}': c};
    final cats = <String, _Cat>{};
    _Cat touch(String name) =>
        cats.putIfAbsent(name.isEmpty ? _uncategorized : name,
            () => _Cat(name.isEmpty ? _uncategorized : name));

    // 1) Kayıtlı üst kategoriler (liste SortOrder'a göre gelir → ekleme sırası korunur).
    for (final c in rawCats) {
      if (c['parentId'] != null) continue;
      touch('${c['name'] ?? ''}').customId = '${c['id']}';
    }
    // 2) Kayıtlı alt kategoriler — üst kategorisi silinmiş öksüzler listelenmez.
    for (final c in rawCats) {
      final parentId = c['parentId'];
      if (parentId == null) continue;
      final parent = byId['$parentId'];
      if (parent == null) continue;
      final cat = touch('${parent['name'] ?? ''}');
      final name = '${c['name'] ?? ''}';
      cat.subs.putIfAbsent(name, () => _Sub(name)).customId = '${c['id']}';
    }
    // 3) Hizmet/paketlerde geçen (kaydı olmayan) adlar.
    for (final s in services) {
      final cat = touch(_text(s['category']));
      cat.serviceCount++;
      final sub = _text(s['subCategory']);
      if (sub.isNotEmpty) {
        cat.subs.putIfAbsent(sub, () => _Sub(sub)).serviceCount++;
      }
    }
    for (final p in packages) {
      final cat = touch(_text(p['category']));
      cat.packageCount++;
      final sub = _text(p['subCategory']);
      if (sub.isNotEmpty) {
        cat.subs.putIfAbsent(sub, () => _Sub(sub)).packageCount++;
      }
    }

    final list = cats.values.toList();
    // "Kategorisiz" her zaman en sonda; kayıtlılar kendi sırasında, türetilenler adete göre.
    list.sort((a, b) {
      if ((a.name == _uncategorized) != (b.name == _uncategorized)) {
        return a.name == _uncategorized ? 1 : -1;
      }
      if (a.isCustom != b.isCustom) return a.isCustom ? -1 : 1;
      if (!a.isCustom) {
        final byCount = b.total.compareTo(a.total);
        if (byCount != 0) return byCount;
      }
      return 0;
    });
    return _CatData(
      cats: list,
      services: services,
      packages: packages,
      rawCats: rawCats,
    );
  }

  static String _text(dynamic v) => '${v ?? ''}'.trim();

  Future<void> _reload() async {
    setState(() => _future = _load());
    await _future;
  }

  Future<bool> _run(Future<void> Function() task) async {
    setState(() => _busy = true);
    try {
      await task();
      await _reload();
      return true;
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$e')));
      }
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // --- Hizmet/paket üzerindeki kategori METNİNİ güncelleyen yardımcılar ---------

  /// Hizmet PUT'u tam gövde ister; yalnız değişen alanı geçmek için taban yük.
  Map<String, dynamic> _servicePayload(
    Map<String, dynamic> s,
    Map<String, dynamic> over,
  ) => {
    'branchId': s['branchId'],
    'name': s['name'],
    'category': _text(s['category']).isEmpty ? null : s['category'],
    'subCategory': _text(s['subCategory']).isEmpty ? null : s['subCategory'],
    'durationMinutes': s['durationMinutes'] ?? 0,
    'price': s['price'] ?? 0,
    'defaultSessionCount': s['defaultSessionCount'] ?? 1,
    'loyaltyPointCost': s['loyaltyPointCost'],
    'isActive': s['isActive'] != false,
    'status': s['status'] ?? 'Active',
    'iconKey': s['iconKey'],
    ...over,
  };

  Future<void> _writeName(
    _CatData data, {
    required String catName,
    String? subName,
    required String? next,
  }) async {
    final isSub = subName != null;
    for (final s in data.services) {
      final sameCat = (_text(s['category']).isEmpty
              ? _uncategorized
              : _text(s['category'])) ==
          catName;
      if (!sameCat) continue;
      if (isSub && _text(s['subCategory']) != subName) continue;
      await widget.api.put(
        '/api/admin/services/${s['id']}',
        _servicePayload(s, isSub ? {'subCategory': next} : {'category': next}),
      );
    }
    for (final p in data.packages) {
      final cat = _text(p['category']).isEmpty ? _uncategorized : _text(p['category']);
      if (cat != catName) continue;
      if (isSub && _text(p['subCategory']) != subName) continue;
      await widget.api.patch('/api/admin/packages/${p['id']}/category', {
        'category': isSub ? (_text(p['category']).isEmpty ? null : p['category']) : next,
        'subCategory': isSub ? next : (_text(p['subCategory']).isEmpty ? null : p['subCategory']),
      });
    }
  }

  // --- İşlemler ----------------------------------------------------------------

  Future<String?> _prompt({
    required String title,
    required String label,
    String initial = '',
    String? note,
    String submitLabel = 'Kaydet',
  }) {
    final controller = TextEditingController(text: initial);
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: controller,
              autofocus: true,
              textInputAction: TextInputAction.done,
              decoration: InputDecoration(labelText: label),
              onSubmitted: (v) => Navigator.pop(ctx, v.trim()),
            ),
            if (note != null) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppColors.warning.withValues(alpha: .10),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  note,
                  style: const TextStyle(fontSize: 12, color: AppColors.ink),
                ),
              ),
            ],
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Vazgeç'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: Text(submitLabel),
          ),
        ],
      ),
    );
  }

  Future<void> _createCat() async {
    final name = await _prompt(
      title: 'Yeni kategori',
      label: 'Kategori adı',
      submitLabel: 'Ekle',
    );
    if (name == null || name.isEmpty) return;
    final ok = await _run(
      () => widget.api.post('/api/admin/service-categories/', {
        'name': name,
        'isActive': true,
      }),
    );
    if (ok && mounted) {
      setState(() {
        _openCat = name;
        _selectedSub = '';
      });
    }
  }

  Future<void> _createSub(_Cat cat) async {
    final name = await _prompt(
      title: '${cat.name} · alt kategori',
      label: 'Alt kategori adı',
      submitLabel: 'Ekle',
    );
    if (name == null || name.isEmpty) return;
    final ok = await _run(() async {
      // Türetilmiş üst kategoriye de alt kategori eklenebilsin: önce üst kategori
      // kuruma özel kayda çevrilir, sonra alt kategori ona bağlanır.
      var parentId = cat.customId;
      if (parentId == null) {
        final created = await widget.api.post('/api/admin/service-categories/', {
          'name': cat.name,
          'isActive': true,
        });
        parentId = created is Map ? '${created['id']}' : null;
      }
      if (parentId == null) throw 'Üst kategori oluşturulamadı';
      await widget.api.post('/api/admin/service-categories/', {
        'name': name,
        'isActive': true,
        'parentId': parentId,
      });
    });
    if (ok && mounted) setState(() => _selectedSub = name);
  }

  Future<void> _rename(_CatData data, _Cat cat, {_Sub? sub}) async {
    final current = sub?.name ?? cat.name;
    final usage = sub?.total ?? cat.total;
    final next = await _prompt(
      title: sub == null ? 'Kategoriyi yeniden adlandır' : 'Alt kategoriyi yeniden adlandır',
      label: 'Yeni ad',
      initial: current,
      note: usage > 0
          ? 'Ad değişince bu adı taşıyan $usage hizmet/paket de yeni adla güncellenir.'
          : null,
    );
    if (next == null || next.isEmpty || next == current) return;
    final customId = sub?.customId ?? cat.customId;
    final ok = await _run(() async {
      if (customId != null) {
        await widget.api.put('/api/admin/service-categories/$customId', {
          'name': next,
          'isActive': true,
          'parentId': sub == null ? null : cat.customId,
        });
      }
      await _writeName(
        data,
        catName: cat.name,
        subName: sub?.name,
        next: next,
      );
    });
    if (ok && mounted) {
      setState(() {
        if (sub == null) {
          _openCat = next;
        } else {
          _selectedSub = next;
        }
      });
    }
  }

  Future<void> _delete(_CatData data, _Cat cat, {_Sub? sub}) async {
    final customId = sub?.customId ?? cat.customId;
    final name = sub?.name ?? cat.name;
    final usage = sub?.total ?? cat.total;
    final subCount = sub == null ? cat.subs.length : 0;

    final explanation = customId == null
        ? 'Bu ${sub == null ? 'kategorinin' : 'alt kategorinin'} ayrı bir kaydı yok; '
              'adı $usage hizmet/pakette yazılı. Silince o kayıtlardan kaldırılacak — '
              'hizmet ve paketlerin kendisi silinmez.'
        : [
            if (subCount > 0) '$subCount alt kategorisi de silinecek.',
            'Bu kategorideki hizmet ve paketler silinmez; kategori adı üzerlerinde kalır.',
          ].join('\n\n');

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(
          sub == null ? 'Kategori silinsin mi?' : 'Alt kategori silinsin mi?',
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              name,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 10),
            Text(explanation, style: const TextStyle(fontSize: 13, height: 1.4)),
            const SizedBox(height: 10),
            const Text(
              'Bu işlem geri alınamaz.',
              style: TextStyle(fontSize: 12, color: AppColors.muted),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Vazgeç'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sil'),
          ),
        ],
      ),
    );
    if (ok != true) return;

    final done = await _run(() async {
      if (customId != null) {
        await widget.api.delete('/api/admin/service-categories/$customId');
        return;
      }
      await _writeName(data, catName: cat.name, subName: sub?.name, next: null);
    });
    if (done && mounted) {
      setState(() {
        if (sub == null) {
          _openCat = null;
        }
        _selectedSub = '';
      });
    }
  }

  /// Kardeşleri arasında bir sıra öne/geriye taşır (SortOrder).
  Future<void> _move(_CatData data, _Cat cat, {_Sub? sub, required int dir}) async {
    final customId = sub?.customId ?? cat.customId;
    if (customId == null) return;
    final parentId = sub == null ? null : cat.customId;
    final ids = data.rawCats
        .where((c) => '${c['parentId'] ?? ''}' == (parentId ?? ''))
        .map((c) => '${c['id']}')
        .toList();
    final i = ids.indexOf(customId);
    final j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    final tmp = ids[i];
    ids[i] = ids[j];
    ids[j] = tmp;
    await _run(
      () => widget.api.post('/api/admin/service-categories/reorder', {
        'orderedIds': ids,
      }),
    );
  }

  // --- Görünüm ------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: _reload,
            child: ResponsiveCenter(
              maxWidth: 1000,
              child: FutureBuilder<_CatData>(
                future: _future,
                builder: (context, snapshot) {
                  if (snapshot.connectionState != ConnectionState.done &&
                      !snapshot.hasData) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  final data = snapshot.data ??
                      const _CatData(
                        cats: [],
                        services: [],
                        packages: [],
                        rawCats: [],
                      );
                  final term = _query.trim().toLowerCase();
                  final cats = term.isEmpty
                      ? data.cats
                      : data.cats
                            .where(
                              (c) =>
                                  c.name.toLowerCase().contains(term) ||
                                  c.subs.keys.any(
                                    (s) => s.toLowerCase().contains(term),
                                  ),
                            )
                            .toList();
                  final subTotal = data.cats.fold<int>(
                    0,
                    (a, c) => a + c.subs.length,
                  );

                  return ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(16, 20, 16, 110),
                    children: [
                      const PageHeader(
                        eyebrow: 'İşletme',
                        title: 'Kategoriler',
                        subtitle:
                            'Hizmet ve paketler ortak kategorilerde gruplanır. '
                            'Kategoriye dokunun; alt kategorileri ve içindeki kayıtlar açılsın.',
                      ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          _stat(
                            'Kategori',
                            '${data.cats.length}',
                            Icons.folder_rounded,
                            AppColors.primary,
                          ),
                          const SizedBox(width: 10),
                          _stat(
                            'Alt kategori',
                            '$subTotal',
                            Icons.sell_rounded,
                            AppColors.warning,
                          ),
                          const SizedBox(width: 10),
                          _stat(
                            'Hizmet',
                            '${data.services.length}',
                            Icons.auto_awesome_rounded,
                            AppColors.success,
                          ),
                          const SizedBox(width: 10),
                          _stat(
                            'Paket',
                            '${data.packages.length}',
                            Icons.inventory_2_rounded,
                            const Color(0xFF7C5CBF),
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      TextField(
                        onChanged: (v) => setState(() => _query = v),
                        decoration: const InputDecoration(
                          prefixIcon: Icon(Icons.search_rounded),
                          hintText: 'Kategori ara...',
                        ),
                      ),
                      if (_canManage) ...[
                        const SizedBox(height: 12),
                        _dashedButton(
                          label: 'Yeni kategori',
                          icon: Icons.create_new_folder_rounded,
                          onTap: _busy ? null : _createCat,
                        ),
                      ],
                      const SizedBox(height: 14),
                      if (cats.isEmpty)
                        _empty(data.cats.isEmpty)
                      else
                        for (final cat in cats) ...[
                          _catCard(data, cat),
                          const SizedBox(height: 10),
                        ],
                    ],
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _stat(String label, String value, IconData icon, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 30,
              height: 30,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: color.withValues(alpha: .12),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Icon(icon, size: 16, color: color),
            ),
            const SizedBox(height: 8),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 10,
                color: AppColors.muted,
                fontWeight: FontWeight.w600,
              ),
            ),
            Text(
              value,
              style: const TextStyle(
                fontSize: 19,
                fontWeight: FontWeight.w800,
                color: AppColors.ink,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _dashedButton({
    required String label,
    required IconData icon,
    VoidCallback? onTap,
  }) {
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 13),
        decoration: BoxDecoration(
          color: AppColors.surfaceSoft.withValues(alpha: .55),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.primary.withValues(alpha: .45)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 18, color: AppColors.primaryDark),
            const SizedBox(width: 8),
            Text(
              label,
              style: const TextStyle(
                fontWeight: FontWeight.w800,
                fontSize: 13,
                color: AppColors.primaryDark,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _empty(bool noCategoryAtAll) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 44, horizontal: 20),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: .7),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          const Icon(
            Icons.folder_open_rounded,
            size: 42,
            color: AppColors.primary,
          ),
          const SizedBox(height: 12),
          Text(
            noCategoryAtAll ? 'Henüz kategori yok' : 'Eşleşen kategori yok',
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
          ),
          const SizedBox(height: 6),
          Text(
            noCategoryAtAll
                ? '“Yeni kategori” ile başlayın; hizmet ve paketlere kategori atandıkça burada gruplanır.'
                : 'Farklı bir kelime deneyin.',
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.muted, fontSize: 12.5, height: 1.4),
          ),
        ],
      ),
    );
  }

  Widget _catCard(_CatData data, _Cat cat) {
    final open = _openCat == cat.name;
    final isUncategorized = cat.name == _uncategorized;
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: open ? AppColors.primary.withValues(alpha: .55) : AppColors.border,
          width: open ? 1.4 : 1,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          InkWell(
            onTap: () => setState(() {
              _openCat = open ? null : cat.name;
              _selectedSub = '';
              _typeTab = 0;
            }),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  Container(
                    width: 42,
                    height: 42,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: open ? AppColors.rose : AppColors.surfaceSoft,
                      borderRadius: BorderRadius.circular(13),
                    ),
                    child: Icon(
                      isUncategorized
                          ? Icons.help_outline_rounded
                          : Icons.folder_rounded,
                      color: AppColors.primaryDark,
                      size: 20,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          cat.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 14.5,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          '${cat.serviceCount} hizmet · ${cat.packageCount} paket'
                          '${cat.subs.isEmpty ? '' : ' · ${cat.subs.length} alt'}',
                          style: const TextStyle(
                            color: AppColors.muted,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    open
                        ? Icons.keyboard_arrow_up_rounded
                        : Icons.keyboard_arrow_down_rounded,
                    color: AppColors.muted,
                  ),
                ],
              ),
            ),
          ),
          if (open)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Divider(height: 1, color: AppColors.border),
                  const SizedBox(height: 12),
                  if (isUncategorized)
                    Container(
                      padding: const EdgeInsets.all(11),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceSoft.withValues(alpha: .6),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Text(
                        'Kategorisi girilmemiş kayıtların toplandığı sistem grubudur — '
                        'adlandırılamaz, silinemez.',
                        style: TextStyle(fontSize: 12, height: 1.4),
                      ),
                    )
                  else
                    _actionBar(data, cat),
                  if (cat.subs.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    _subChips(data, cat),
                  ],
                  const SizedBox(height: 12),
                  _typeChips(cat),
                  const SizedBox(height: 10),
                  ..._rowsOf(data, cat),
                ],
              ),
            ),
        ],
      ),
    );
  }

  /// Kategori işlemleri — etiketli ve her zaman görünür (web ile aynı karar).
  Widget _actionBar(_CatData data, _Cat cat) {
    final sub = _selectedSub.isEmpty ? null : cat.subs[_selectedSub];
    final target = sub == null ? 'Kategori' : 'Alt kategori';
    final customId = sub?.customId ?? cat.customId;
    final siblings = data.rawCats
        .where(
          (c) => '${c['parentId'] ?? ''}' == ((sub == null ? null : cat.customId) ?? ''),
        )
        .map((c) => '${c['id']}')
        .toList();
    final orderIndex = customId == null ? -1 : siblings.indexOf(customId);
    final canReorder = _canManage && orderIndex >= 0 && siblings.length > 1;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '$target işlemleri · ${sub?.name ?? cat.name}',
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            if (_canManage && sub == null)
              _actionChip(
                'Alt kategori',
                Icons.add_rounded,
                () => _createSub(cat),
                primary: true,
              ),
            if (_canManage)
              _actionChip(
                'Yeniden adlandır',
                Icons.drive_file_rename_outline_rounded,
                () => _rename(data, cat, sub: sub),
              ),
            if (canReorder)
              _actionChip(
                'Yukarı',
                Icons.arrow_upward_rounded,
                orderIndex == 0
                    ? null
                    : () => _move(data, cat, sub: sub, dir: -1),
              ),
            if (canReorder)
              _actionChip(
                'Aşağı',
                Icons.arrow_downward_rounded,
                orderIndex == siblings.length - 1
                    ? null
                    : () => _move(data, cat, sub: sub, dir: 1),
              ),
            if (_canDelete && (customId != null || (sub?.total ?? cat.total) > 0))
              _actionChip(
                'Sil',
                Icons.delete_outline_rounded,
                () => _delete(data, cat, sub: sub),
                danger: true,
              ),
          ],
        ),
      ],
    );
  }

  Widget _actionChip(
    String label,
    IconData icon,
    VoidCallback? onTap, {
    bool primary = false,
    bool danger = false,
  }) {
    final color = danger
        ? AppColors.danger
        : (primary ? AppColors.primaryDark : AppColors.ink);
    final disabled = onTap == null || _busy;
    return Opacity(
      opacity: disabled ? .4 : 1,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: disabled ? null : onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          decoration: BoxDecoration(
            color: primary
                ? AppColors.surfaceSoft
                : (danger ? AppColors.danger.withValues(alpha: .07) : AppColors.surface),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: danger
                  ? AppColors.danger.withValues(alpha: .45)
                  : (primary ? AppColors.primary.withValues(alpha: .5) : AppColors.border),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 15, color: color),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: color,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _subChips(_CatData data, _Cat cat) {
    final subs = cat.subs.values.toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Alt kategoriler',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            ChoiceChip(
              label: Text('Tümü ${cat.total}'),
              selected: _selectedSub.isEmpty,
              onSelected: (_) => setState(() => _selectedSub = ''),
            ),
            for (final s in subs)
              ChoiceChip(
                label: Text('${s.name} ${s.total}'),
                selected: _selectedSub == s.name,
                onSelected: (_) => setState(
                  () => _selectedSub = _selectedSub == s.name ? '' : s.name,
                ),
              ),
          ],
        ),
      ],
    );
  }

  Widget _typeChips(_Cat cat) {
    const labels = ['Tümü', 'Hizmetler', 'Paketler'];
    return Wrap(
      spacing: 8,
      children: [
        for (var i = 0; i < labels.length; i++)
          ChoiceChip(
            label: Text(labels[i]),
            selected: _typeTab == i,
            onSelected: (_) => setState(() => _typeTab = i),
          ),
      ],
    );
  }

  List<Widget> _rowsOf(_CatData data, _Cat cat) {
    final rows = <_Row>[];
    bool inScope(String category, String sub) {
      final key = category.isEmpty ? _uncategorized : category;
      if (key != cat.name) return false;
      return _selectedSub.isEmpty || sub == _selectedSub;
    }

    if (_typeTab != 2) {
      for (final s in data.services) {
        if (!inScope(_text(s['category']), _text(s['subCategory']))) continue;
        rows.add(
          _Row(
            isPackage: false,
            name: '${s['name'] ?? ''}',
            sub: _text(s['subCategory']),
            meta: '${s['durationMinutes'] ?? 0} dk',
            price: numberOf(s, const ['price']),
            active: '${s['status'] ?? ''}' == 'Active' || s['isActive'] == true,
          ),
        );
      }
    }
    if (_typeTab != 1) {
      for (final p in data.packages) {
        if (!inScope(_text(p['category']), _text(p['subCategory']))) continue;
        rows.add(
          _Row(
            isPackage: true,
            name: '${p['name'] ?? ''}',
            sub: _text(p['subCategory']),
            meta: '${p['totalSessions'] ?? 0} seans',
            price: numberOf(p, const ['totalPrice']),
            active: p['isActive'] != false,
          ),
        );
      }
    }
    rows.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));

    if (rows.isEmpty) {
      return [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 26),
          alignment: Alignment.center,
          child: Text(
            'Bu ${_selectedSub.isEmpty ? 'kategoride' : 'alt kategoride'} kayıt yok.',
            style: const TextStyle(color: AppColors.muted, fontSize: 12.5),
          ),
        ),
      ];
    }
    return [for (final r in rows) _row(r)];
  }

  Widget _row(_Row r) {
    final accent = r.isPackage ? const Color(0xFF7C5CBF) : AppColors.primaryDark;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: .55),
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
              color: accent.withValues(alpha: .11),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(
              r.isPackage
                  ? Icons.inventory_2_rounded
                  : Icons.auto_awesome_rounded,
              size: 16,
              color: accent,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  r.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  [
                    r.isPackage ? 'Paket' : 'Hizmet',
                    r.meta,
                    if (r.sub.isNotEmpty) r.sub,
                    r.active ? 'Aktif' : 'Pasif',
                  ].join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppColors.muted, fontSize: 11.5),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            _money.format(r.price),
            style: const TextStyle(
              fontWeight: FontWeight.w800,
              fontSize: 13,
              color: AppColors.ink,
            ),
          ),
        ],
      ),
    );
  }
}
