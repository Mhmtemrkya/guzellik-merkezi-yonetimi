import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme/responsive.dart';
import '../../core/auth/permissions.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/guide/guide_content.dart';
import '../../shared/guide/page_guide.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import '../appointments/calendar_theme.dart';
import 'product_form_sheet.dart';

/// Stok & Ürün — web `ProductLibrary` bileşeninin mobil karşılığı.
///
/// 4 özet kartı + durum sekmeleri (Tümü / Kritik / Satış / Sarf) + arama +
/// ürün listesi (durum renkli) + seçili ürün detayı (stok/fiyat/diğer + Stok
/// Girişi/Çıkışı/Düzenle/Sil) + Son Stok Hareketleri + Stok Özeti kutuları.
class StockScreen extends StatefulWidget {
  const StockScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<StockScreen> createState() => _StockScreenState();
}

const _movementTypes = [
  CrudOption('Inbound', 'Giriş (Alım)'),
  CrudOption('Outbound', 'Çıkış (Sarf)'),
  CrudOption('Sale', 'Satış'),
  CrudOption('Adjustment', 'Düzeltme/Sayım'),
  CrudOption('Damage', 'Fire/Bozulma'),
];

const _moveTypeKeys = ['Inbound', 'Outbound', 'Sale', 'Adjustment', 'Damage'];

/// Ürün ekleme/düzenleme artık web ProductFormDialog paritesindeki
/// [showProductFormSheet] ile yapılır (görsel + barkod okutma + canlı önizleme).
String _categoryLabel(String key) => productCategoryLabel(key);

enum _Tab { all, critical, sale, consumable }

class _StockScreenState extends State<StockScreen> {
  late Future<_StockData> _future;

  _Tab _tab = _Tab.all;
  String _query = '';

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_StockData> _load() async {
    final results = await Future.wait<dynamic>([
      widget.api
          .get('/api/admin/products/', query: {'page': 1, 'pageSize': 500}),
      // DİKKAT: bu uç page/pageSize DEĞİL `limit` alır ve parametre nullable olmadığından
      // gönderilmezse 400 döner (hareketler sessizce boş görünüyordu). Web de limit:300 yollar.
      widget.api
          .get('/api/admin/stock-movements/', query: {'limit': 300})
          .catchError((_) => const <dynamic>[]),
    ]);
    final loaded = _StockData(
      products: apiItems(results[0]),
      movements: apiItems(results[1]),
    );
    return loaded;
  }

  Future<void> _reload() async {
    setState(() {
      _future = _load();
    });
    await _future;
  }

  // --- Durum / türetme ---

  String _status(Map<String, dynamic> p) {
    final stock = (p['currentStock'] as num?)?.toDouble() ?? 0;
    final min = (p['minStockLevel'] as num?)?.toDouble() ?? 0;
    if (p['isOutOfStock'] == true || stock <= 0) return 'out';
    if (p['isCritical'] == true || stock <= min) return 'critical';
    return 'sufficient';
  }

  String _moveType(dynamic raw) {
    if (raw is num) {
      final i = raw.toInt();
      return (i >= 0 && i < _moveTypeKeys.length)
          ? _moveTypeKeys[i]
          : 'Outbound';
    }
    final s = '$raw';
    return _moveTypeKeys.contains(s) ? s : 'Outbound';
  }

  List<Map<String, dynamic>> _filter(List<Map<String, dynamic>> products) {
    var list = products;
    switch (_tab) {
      case _Tab.critical:
        list = list.where((p) => _status(p) != 'sufficient').toList();
      case _Tab.sale:
        list = list
            .where((p) => ((p['salePrice'] as num?)?.toDouble() ?? 0) > 0)
            .toList();
      case _Tab.consumable:
        list = list
            .where((p) =>
                '${p['category']}' == 'Consumable' ||
                ((p['salePrice'] as num?)?.toDouble() ?? 0) <= 0)
            .toList();
      case _Tab.all:
        break;
    }
    if (_query.isNotEmpty) {
      list = list.where((p) {
        final hay =
            '${p['name'] ?? ''} ${p['barcode'] ?? ''}'
                .toLowerCase();
        return hay.contains(_query);
      }).toList();
    }
    return list;
  }

  // --- Aksiyonlar (form'lar CrudFormSheet ile) ---

  Future<void> _createProduct() async {
    final body = await showProductFormSheet(context);
    if (body == null) return;
    body['branchId'] = widget.api.auth?.user?.branchId;
    await _guard(() => widget.api.post('/api/admin/products/', body),
        'Ürün eklendi.');
  }

  Future<void> _guard(Future<void> Function() task, String ok) async {
    try {
      await task();
      await _reload();
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(ok)));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _openDetail(Map<String, dynamic> product) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _ProductDetailSheet(
        api: widget.api,
        product: product,
        status: _status(product),
      ),
    );
    if (changed == true) _reload();
  }

  // --- Görünüm ---

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        floatingActionButton: !(widget.api.auth?.user?.canAction(Perm.stockManage) ?? true)
            ? null
            : FloatingActionButton.extended(
          onPressed: _createProduct,
          icon: const Icon(Icons.add_rounded),
          label: const Text('Ürün ekle'),
        ),
        body: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: _reload,
            child: FutureBuilder<_StockData>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done &&
                    !snapshot.hasData) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snapshot.hasError) {
                  return _errorState('${snapshot.error}');
                }
                final data = snapshot.data ?? const _StockData(products: [], movements: []);
                final filtered = _filter(data.products);
                return ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 110),
                  children: [
                    PageHeader(
                      eyebrow: 'İşletme',
                      title: 'Stok & Ürün',
                      subtitle: 'Ürün, sarf, kritik stok ve depo görünümü.',
                      // Sayfa kılavuzu (web Topbar'daki kitap simgesi).
                      action: IconButton(
                        tooltip: 'Sayfa kılavuzu',
                        color: AppColors.primaryDark,
                        onPressed: () {
                          final guide = GuideContent.forKey('stock');
                          if (guide == null) return;
                          showPageGuide(context,
                              pageKey: 'stock',
                              uid: widget.api.auth?.user?.email ?? 'anon',
                              content: guide);
                        },
                        icon: const Icon(Icons.menu_book_rounded),
                      ),
                    ),
                    const SizedBox(height: 16),
                    _statsGrid(data.products, data.movements),
                    const SizedBox(height: 14),
                    _tabs(data.products),
                    const SizedBox(height: 12),
                    _searchField(),
                    const SizedBox(height: 12),
                    if (filtered.isEmpty)
                      _empty(_query.isNotEmpty || _tab != _Tab.all
                          ? 'Eşleşen ürün yok.'
                          : 'Ürün kaydı yok.')
                    else
                      for (final p in filtered) _productRow(p),
                    const SizedBox(height: 18),
                    _movementsSection(data),
                    const SizedBox(height: 14),
                    _summarySection(data),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _errorState(String message) => Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off_rounded, size: 44, color: AppColors.primary),
              const SizedBox(height: 12),
              Text(message, textAlign: TextAlign.center),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: _reload,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Tekrar dene'),
              ),
            ],
          ),
        ),
      );

  // 4 özet kartı (2x2)
  Widget _statsGrid(
      List<Map<String, dynamic>> products, List<Map<String, dynamic>> movements) {
    final critical = products.where((p) => _status(p) == 'critical').length;
    final out = products.where((p) => _status(p) == 'out').length;
    final costValue = products.fold<double>(
        0,
        (s, p) =>
            s +
            ((p['currentStock'] as num?)?.toDouble() ?? 0) *
                ((p['cost'] as num?)?.toDouble() ?? 0));
    final saleValue = products.fold<double>(
        0,
        (s, p) =>
            s +
            ((p['currentStock'] as num?)?.toDouble() ?? 0) *
                ((p['salePrice'] as num?)?.toDouble() ?? 0));
    final cards = <Widget>[
      _statCard('Toplam ürün', '${products.length}', Icons.inventory_2_rounded,
          AppColors.primaryDark),
      _statCard('Kritik / tükenen', '${critical + out}',
          Icons.warning_amber_rounded, AppColors.warning,
          sub: '$critical kritik · $out tükenen'),
      _statCard('Stok maliyeti', CalendarText.tl(costValue),
          Icons.layers_rounded, AppColors.primary),
      _statCard('Satış değeri', CalendarText.tl(saleValue),
          Icons.trending_up_rounded, AppColors.success),
    ];
    return AdaptiveStatGrid(
      phoneCols: 2,
      height: 118,
      children: cards,
    );
  }

  Widget _statCard(String label, String value, IconData icon, Color color,
      {String? sub}) {
    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Container(
            width: 32,
            height: 32,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: color.withValues(alpha: .12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 17, color: color),
          ),
          Text(label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  fontSize: 10.5,
                  color: AppColors.muted,
                  fontWeight: FontWeight.w600)),
          Text(value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w800,
                  color: AppColors.ink)),
          if (sub != null)
            Text(sub,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 9.5, color: AppColors.muted)),
        ],
      ),
    );
  }

  Widget _tabs(List<Map<String, dynamic>> products) {
    const items = <(_Tab, String)>[
      (_Tab.all, 'Tümü'),
      (_Tab.critical, 'Kritik stok'),
      (_Tab.sale, 'Satış ürünleri'),
      (_Tab.consumable, 'Sarf malzeme'),
    ];
    return SizedBox(
      height: 38,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: items.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (_, i) {
          final (tab, label) = items[i];
          final selected = _tab == tab;
          return GestureDetector(
            onTap: () => setState(() => _tab = tab),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              decoration: BoxDecoration(
                color: selected ? AppColors.primary : AppColors.surface,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                    color: selected ? AppColors.primary : AppColors.border),
              ),
              child: Text(label,
                  style: TextStyle(
                      color: selected ? Colors.white : AppColors.muted,
                      fontSize: 13,
                      fontWeight: FontWeight.w700)),
            ),
          );
        },
      ),
    );
  }

  Widget _searchField() {
    return TextField(
      onChanged: (v) => setState(() => _query = v.trim().toLowerCase()),
      decoration: const InputDecoration(
        isDense: true,
        prefixIcon: Icon(Icons.search_rounded, size: 18),
        hintText: 'Ürün adı, barkod, SKU ara…',
      ),
    );
  }

  Widget _productRow(Map<String, dynamic> p) {
    final status = _status(p);
    final (statusLabel, statusColor) = _statusMeta(status);
    final stock = (p['currentStock'] as num?)?.toDouble() ?? 0;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => _openDetail(p),
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.border),
            ),
            child: Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppColors.surfaceSoft,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.inventory_2_rounded,
                      color: AppColors.primaryDark, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(valueOf(p, const ['name'], fallback: 'Ürün'),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontWeight: FontWeight.w700, fontSize: 14)),
                      const SizedBox(height: 3),
                      Row(
                        children: [
                          _miniChip(_categoryLabel('${p['category']}')),
                          const SizedBox(width: 6),
                          Flexible(
                            child: Text(
                                'BARKOD ${valueOf(p, const ['barcode'], fallback: '—')}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontSize: 9.5,
                                    color: AppColors.muted,
                                    letterSpacing: .3)),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(_trimNum(stock),
                        style: TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w800,
                            color: statusColor)),
                    const SizedBox(height: 3),
                    _badge(statusLabel, statusColor),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // Son Stok Hareketleri (web ProductLibrary "Son Stok Hareketleri" bloğu paritesi)
  Widget _movementsSection(_StockData data) {
    final moves = data.movements.take(8).toList();
    final stockById = {
      for (final p in data.products) '${p['id']}': p,
    };
    return _card(
      title: 'Son Stok Hareketleri',
      icon: Icons.swap_vert_rounded,
      badge: '${data.movements.length}',
      action: data.movements.length > 8
          ? TextButton(
              onPressed: () => _showAllMovements(data, stockById),
              child: const Text('Tümü'),
            )
          : null,
      child: moves.isEmpty
          ? _empty('Hareket kaydı yok.')
          : Column(
              children: [
                for (final m in moves) _movementRow(m, stockById),
              ],
            ),
    );
  }

  Future<void> _showAllMovements(
      _StockData data, Map<String, Map<String, dynamic>> stockById) async {
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
        constraints:
            BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.9),
        child: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 14, 8, 6),
                child: Row(
                  children: [
                    const Icon(Icons.swap_vert_rounded,
                        size: 18, color: AppColors.primary),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                          'Stok Hareketleri (${data.movements.length})',
                          style: const TextStyle(
                              fontSize: 16, fontWeight: FontWeight.w800)),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ],
                ),
              ),
              Flexible(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
                  children: [
                    for (final m in data.movements) _movementRow(m, stockById),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _movementRow(
      Map<String, dynamic> m, Map<String, Map<String, dynamic>> stockById) {
    final type = _moveType(m['type']);
    final (label, color) = _moveMeta(type);
    final inbound = type == 'Inbound' || type == 'Adjustment';
    final qty = (m['quantity'] as num?)?.toDouble() ?? 0;
    final when = parseUtcToLocal(m['occurredAtUtc']);
    final prod = stockById['${m['productId']}'];
    final prodName = valueOf(m, const ['productName'], fallback: '') == '—'
        ? valueOf(prod ?? const {}, const ['name'], fallback: '—')
        : valueOf(m, const ['productName'], fallback: '—');
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: color.withValues(alpha: .12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(
                inbound
                    ? Icons.south_west_rounded
                    : Icons.north_east_rounded,
                size: 16,
                color: color),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(prodName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontWeight: FontWeight.w700, fontSize: 13)),
                Row(
                  children: [
                    _badge(label, color),
                    if (when != null) ...[
                      const SizedBox(width: 6),
                      Text(DateFormat('d MMM, HH:mm', 'tr_TR').format(when),
                          style: const TextStyle(
                              fontSize: 10, color: AppColors.muted)),
                    ],
                  ],
                ),
                // Web tablosundaki "Kullanıcı" kolonu.
                if (valueOf(m, const ['staffName'], fallback: '') != '')
                  Text(valueOf(m, const ['staffName']),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style:
                          const TextStyle(fontSize: 10, color: AppColors.muted)),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text('${inbound ? '+' : '-'}${_trimNum(qty)}',
                  style: TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 14,
                      color: inbound ? AppColors.success : AppColors.danger)),
              // Web tablosundaki "Stok" kolonu: hareketten sonraki güncel stok.
              if (prod != null)
                Text(
                    'stok ${_trimNum((prod['currentStock'] as num?)?.toDouble() ?? 0)}',
                    style:
                        const TextStyle(fontSize: 9.5, color: AppColors.muted)),
            ],
          ),
        ],
      ),
    );
  }

  // Stok Özeti
  Widget _summarySection(_StockData data) {
    final products = data.products;
    final totalUnits =
        products.fold<double>(0, (s, p) => s + ((p['currentStock'] as num?)?.toDouble() ?? 0));
    final criticalUnits = products
        .where((p) => _status(p) == 'critical')
        .fold<double>(0, (s, p) => s + ((p['currentStock'] as num?)?.toDouble() ?? 0));
    final out = products.where((p) => _status(p) == 'out').length;
    final since = DateTime.now().subtract(const Duration(days: 30));
    final sales30 = data.movements.where((m) {
      final t = _moveType(m['type']);
      if (t != 'Sale' && t != 'Outbound') return false;
      final d = parseUtcToLocal(m['occurredAtUtc']);
      return d != null && d.isAfter(since);
    }).fold<double>(0, (s, m) => s + ((m['quantity'] as num?)?.toDouble() ?? 0));
    final turnover =
        totalUnits > 0 ? (sales30 / totalUnits * 10).round() / 10 : 0;
    return _card(
      title: 'Stok Özeti',
      icon: Icons.assessment_rounded,
      child: AdaptiveStatGrid(
        phoneCols: 2,
        height: 62,
        children: [
          _summaryTile(Icons.widgets_rounded, AppColors.success,
              'Toplam stok adedi', '${totalUnits.round()} adet'),
          _summaryTile(Icons.warning_amber_rounded, AppColors.warning,
              'Kritik stok adedi', '${criticalUnits.round()} adet'),
          _summaryTile(Icons.inventory_rounded, AppColors.danger,
              'Tükenen ürün', '$out adet'),
          _summaryTile(Icons.autorenew_rounded, AppColors.primary,
              'Stok devir hızı', '$turnover'.replaceAll('.', ',')),
        ],
      ),
    );
  }

  Widget _summaryTile(IconData icon, Color color, String k, String v) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.surfaceSoft.withValues(alpha: .5),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 32,
            height: 32,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: color.withValues(alpha: .14),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 16, color: color),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(k,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 9.5, color: AppColors.muted)),
                Text(v,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                        color: AppColors.ink)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // --- Küçük yardımcılar ---

  (String, Color) _statusMeta(String status) => switch (status) {
        'out' => ('Tükenen', AppColors.danger),
        'critical' => ('Kritik', AppColors.warning),
        _ => ('Aktif', AppColors.success),
      };

  (String, Color) _moveMeta(String type) => switch (type) {
        'Inbound' => ('Stok Girişi', AppColors.success),
        'Outbound' => ('Stok Çıkışı', AppColors.danger),
        'Sale' => ('Satış', Color(0xFF7C5CBF)),
        'Adjustment' => ('Sayım', AppColors.warning),
        'Damage' => ('Fire', AppColors.danger),
        _ => (type, AppColors.muted),
      };

  Widget _miniChip(String label) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
        decoration: BoxDecoration(
          color: AppColors.surfaceSoft,
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(label,
            style: const TextStyle(
                fontSize: 9.5,
                color: AppColors.primaryDark,
                fontWeight: FontWeight.w700)),
      );

  Widget _badge(String label, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color: color.withValues(alpha: .12),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(label,
            style: TextStyle(
                fontSize: 9.5, fontWeight: FontWeight.w800, color: color)),
      );

  Widget _card(
          {required String title,
          required IconData icon,
          required Widget child,
          String? badge,
          Widget? action}) =>
      Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 15, color: AppColors.primary),
                const SizedBox(width: 7),
                Flexible(
                  child: Text(title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w800,
                          color: AppColors.primaryDark)),
                ),
                if (badge != null) ...[
                  const SizedBox(width: 6),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceSoft,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(badge,
                        style: const TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
                            color: AppColors.primaryDark)),
                  ),
                ],
                const Spacer(),
                ?action,
              ],
            ),
            const SizedBox(height: 12),
            child,
          ],
        ),
      );

  Widget _empty(String text) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Center(
          child: Text(text,
              style: const TextStyle(color: AppColors.muted, fontSize: 13)),
        ),
      );

  String _trimNum(double v) =>
      v == v.roundToDouble() ? '${v.toInt()}' : '$v';
}

class _StockData {
  const _StockData({required this.products, required this.movements});
  final List<Map<String, dynamic>> products;
  final List<Map<String, dynamic>> movements;
}

// ===========================================================================
// Seçili ürün detay alt-sayfası
// ===========================================================================
class _ProductDetailSheet extends StatefulWidget {
  const _ProductDetailSheet({
    required this.api,
    required this.product,
    required this.status,
  });
  final ApiClient api;
  final Map<String, dynamic> product;
  final String status;

  @override
  State<_ProductDetailSheet> createState() => _ProductDetailSheetState();
}

class _ProductDetailSheetState extends State<_ProductDetailSheet> {
  late Map<String, dynamic> p = Map.of(widget.product);
  bool _changed = false;

  /// BU ÜRÜNÜN hareketleri — sunucudan `productId` süzgeciyle ayrıca çekilir.
  /// Sayfanın genel listesi TÜM ürünlerin son 300 hareketini getirir; oradan süzmek,
  /// hareketleri o pencerenin dışında kalan üründe "hareket kaydı yok" YALANINI yazdırırdı.
  List<Map<String, dynamic>> _movements = const [];
  bool _movesLoading = true;
  bool _movesFailed = false;

  double _n(String key) => (p[key] as num?)?.toDouble() ?? 0;

  @override
  void initState() {
    super.initState();
    _loadMovements();
  }

  Future<void> _loadMovements() async {
    try {
      final res = await widget.api.get('/api/admin/stock-movements/',
          query: {'productId': '${p['id']}', 'limit': 200});
      if (!mounted) return;
      setState(() {
        _movements = apiItems(res);
        _movesLoading = false;
        _movesFailed = false;
      });
    } catch (_) {
      // "Okunamadı" ile "yok" AYNI ŞEY DEĞİL — sessiz boş liste gerçek dışı bir cümle yazardı.
      if (!mounted) return;
      setState(() {
        _movesLoading = false;
        _movesFailed = true;
      });
    }
  }

  Future<void> _refresh() async {
    try {
      final data = await widget.api.get('/api/admin/products/${p['id']}');
      if (mounted && data is Map) {
        setState(() => p = data.cast<String, dynamic>());
      }
    } catch (_) {
      // tekil uç yoksa sessizce geç; ana liste kapanışta yenilenir.
    }
  }

  Future<void> _edit() async {
    final body = await showProductFormSheet(context, product: p);
    if (body == null) return;
    body['branchId'] = p['branchId'] ?? widget.api.auth?.user?.branchId;
    try {
      await widget.api.put('/api/admin/products/${p['id']}', body);
      _changed = true;
      await _refresh();
      await _loadMovements();
      _toast('Ürün güncellendi.');
    } catch (e) {
      _toast('$e');
    }
  }

  Future<void> _move(String presetType) async {
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: 'Stok hareketi',
        icon: Icons.swap_vert_rounded,
        fields: [
          CrudField(
            key: 'type',
            label: 'Hareket tipi',
            type: CrudFieldType.select,
            options: _movementTypes,
            defaultValue: presetType,
          ),
          const CrudField(
              key: 'quantity',
              label: 'Miktar',
              type: CrudFieldType.decimal,
              required: true),
          const CrudField(
              key: 'unitCost', label: 'Birim maliyet', type: CrudFieldType.decimal),
          // HAREKET TARİHİ — geçmişe dönük giriş (ör. mal dün geldi, bugün kaydediliyor).
          // Boş bırakılırsa backend "şimdi" kabul eder; stok/maliyet raporu bu tarihe yazar.
          const CrudField(
            key: 'occurredAtUtc',
            label: 'Hareket tarihi',
            type: CrudFieldType.date,
            dateOnly: false,
            defaultValue: 'today',
          ),
          const CrudField(key: 'reference', label: 'Referans / Fatura no'),
          const CrudField(key: 'notes', label: 'Not', type: CrudFieldType.multiline),
        ],
      ),
    );
    final body = result?.body;
    if (body == null) return;
    try {
      await widget.api.post('/api/admin/products/${p['id']}/movements', body);
      _changed = true;
      await _refresh();
      await _loadMovements();
      _toast('Stok hareketi eklendi.');
    } catch (e) {
      _toast('$e');
    }
  }

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Ürünü sil'),
        content: Text(
            '"${p['name'] ?? 'Ürün'}" silinsin mi? Ürün pasifleştirilir; geçmiş hareketler raporlarda kalır.'),
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
      await widget.api.delete('/api/admin/products/${p['id']}');
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      _toast('$e');
    }
  }

  void _toast(String msg) {
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  String _status() {
    final stock = _n('currentStock');
    final min = _n('minStockLevel');
    if (p['isOutOfStock'] == true || stock <= 0) return 'out';
    if (p['isCritical'] == true || stock <= min) return 'critical';
    return 'sufficient';
  }

  @override
  Widget build(BuildContext context) {
    final status = _status();
    final (statusLabel, statusColor) = switch (status) {
      'out' => ('Tükenen', AppColors.danger),
      'critical' => ('Kritik', AppColors.warning),
      _ => ('Aktif', AppColors.success),
    };
    final cost = _n('cost');
    final sale = _n('salePrice');
    final marginPct = sale > 0 ? ((sale - cost) / sale * 100).round() : null;
    final unit = valueOf(p, const ['unit'], fallback: 'adet');
    final expiry = parseUtcToLocal(p['expiryDate']);

    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      constraints:
          BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.9),
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
                  Container(
                    width: 52,
                    height: 52,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: AppColors.surfaceSoft,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Icon(Icons.inventory_2_rounded,
                        color: AppColors.primaryDark, size: 26),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(valueOf(p, const ['name'], fallback: 'Ürün'),
                            style: const TextStyle(
                                fontSize: 18, fontWeight: FontWeight.w800)),
                        const SizedBox(height: 3),
                        Text(
                            '${_categoryLabel('${p['category']}')} · BARKOD ${valueOf(p, const ['barcode'], fallback: '—')}',
                            style: const TextStyle(
                                fontSize: 11, color: AppColors.muted)),
                      ],
                    ),
                  ),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                    decoration: BoxDecoration(
                      color: statusColor.withValues(alpha: .12),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(statusLabel,
                        style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
                            color: statusColor)),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              // STOK SEVİYESİ ÇUBUĞU — çizgi asgari stok eşiğidir. Rakamlar tek başına
              // "kritiğe ne kadar var" sorusunu cevaplamıyordu (web künye modaliyle aynı).
              _stockLevelBar(statusColor, unit),
              const SizedBox(height: 10),
              _infoCard('Stok Özeti', [
                ('Mevcut Stok', '${_trimNum(_n('currentStock'))} $unit', statusColor),
                ('Min. Stok', '${_trimNum(_n('minStockLevel'))} $unit', null),
                ('Stok değeri (maliyet)', CalendarText.tl(_n('currentStock') * cost), null),
                ('Perakende değeri', CalendarText.tl(_n('currentStock') * sale), null),
              ]),
              _infoCard('Fiyat Bilgileri', [
                ('Maliyet', CalendarText.tl(cost), null),
                ('Satış Fiyatı', CalendarText.tl(sale), null),
                ('Kâr Marjı', marginPct != null ? '%$marginPct' : '—',
                    marginPct != null ? AppColors.success : null),
              ]),
              _infoCard('Diğer Bilgiler', [
                ('Marka', valueOf(p, const ['brand'], fallback: '—'), null),
                ('Raf / Dolap', valueOf(p, const ['location'], fallback: '—'), null),
                ('Son Kullanma',
                    expiry != null ? DateFormat('d MMM yyyy', 'tr_TR').format(expiry) : '—', null),
                ('Lot Numarası', valueOf(p, const ['lotNumber'], fallback: '—'), null),
                ('Birim', unit, null),
              ]),
              _movementsCard(),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _edit,
                      icon: const Icon(Icons.edit_rounded, size: 17),
                      label: const Text('Düzenle'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.danger),
                      onPressed: _delete,
                      icon: const Icon(Icons.delete_outline_rounded, size: 17),
                      label: const Text('Sil'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      style: FilledButton.styleFrom(
                          backgroundColor: AppColors.success),
                      onPressed: () => _move('Inbound'),
                      icon: const Icon(Icons.south_west_rounded, size: 17),
                      label: const Text('Stok Girişi'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton.icon(
                      style: FilledButton.styleFrom(
                          backgroundColor: const Color(0xFF2F5FA6)),
                      onPressed: () => _move('Outbound'),
                      icon: const Icon(Icons.north_east_rounded, size: 17),
                      label: const Text('Stok Çıkışı'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Center(
                child: TextButton.icon(
                  onPressed: () => Navigator.pop(context, _changed),
                  icon: const Icon(Icons.close_rounded, size: 16),
                  label: const Text('Kapat'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Stok doluluk çubuğu. Asgari seviye REFERANS noktasıdır, tavan değil — asgarinin iki katı
  /// "dolu" sayılır ki kritik eşiği çubuğun ortasında dursun ve göz eşiği bulabilsin.
  Widget _stockLevelBar(Color tone, String unit) {
    final stock = _n('currentStock');
    final min = _n('minStockLevel');
    final scale = [min * 2, stock, 1.0].reduce((a, b) => a > b ? a : b);
    final fill = (stock / scale).clamp(0.02, 1.0);
    final minPos = (min / scale).clamp(0.0, 1.0);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('STOK SEVİYESİ',
                  style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w800,
                      letterSpacing: .4,
                      color: AppColors.muted)),
              Text('${_trimNum(stock)} / asgari ${_trimNum(min)} $unit',
                  style: const TextStyle(
                      fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.ink)),
            ],
          ),
          const SizedBox(height: 8),
          LayoutBuilder(
            builder: (_, c) => SizedBox(
              height: 12,
              child: Stack(
                children: [
                  Container(
                    decoration: BoxDecoration(
                      color: AppColors.surfaceSoft,
                      borderRadius: BorderRadius.circular(6),
                    ),
                  ),
                  TweenAnimationBuilder<double>(
                    tween: Tween(begin: 0, end: fill.toDouble()),
                    duration: const Duration(milliseconds: 650),
                    curve: Curves.easeOutCubic,
                    builder: (_, v, _) => FractionallySizedBox(
                      widthFactor: v,
                      child: Container(
                        decoration: BoxDecoration(
                          color: tone,
                          borderRadius: BorderRadius.circular(6),
                        ),
                      ),
                    ),
                  ),
                  if (min > 0)
                    Positioned(
                      left: (c.maxWidth * minPos).clamp(0.0, c.maxWidth - 2),
                      top: 0,
                      bottom: 0,
                      width: 2,
                      child: Container(color: AppColors.ink.withValues(alpha: .55)),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Bu ürünün hareket defteri — en yeniden eskiye, ilk 8 kayıt.
  Widget _movementsCard() {
    final moves = [..._movements]..sort((a, b) =>
        '${b['occurredAtUtc'] ?? b['createdAtUtc'] ?? ''}'
            .compareTo('${a['occurredAtUtc'] ?? a['createdAtUtc'] ?? ''}'));
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceSoft.withValues(alpha: .5),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('STOK HAREKETLERİ',
                  style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w800,
                      letterSpacing: .4,
                      color: AppColors.muted)),
              Text(_movesLoading || _movesFailed ? '—' : '${moves.length}',
                  style: const TextStyle(
                      fontSize: 11, fontWeight: FontWeight.w800, color: AppColors.primaryDark)),
            ],
          ),
          const SizedBox(height: 8),
          if (_movesFailed)
            const Text(
                'Hareket listesi okunamadı — bu ürünün geçmişi eksik görünüyor olabilir.',
                style: TextStyle(
                    fontSize: 11.5, fontWeight: FontWeight.w700, color: AppColors.danger))
          else if (_movesLoading)
            const Text('Hareketler yükleniyor…',
                style: TextStyle(fontSize: 11.5, color: AppColors.muted))
          else if (moves.isEmpty)
            const Text('Bu ürün için hareket kaydı yok.',
                style: TextStyle(fontSize: 11.5, color: AppColors.muted))
          else
            for (final m in moves.take(8)) _movementLine(m),
        ],
      ),
    );
  }

  Widget _movementLine(Map<String, dynamic> m) {
    const labels = {
      'Inbound': 'Stok Girişi', 'Outbound': 'Stok Çıkışı',
      'Sale': 'Satış', 'Adjustment': 'Sayım', 'Damage': 'Fire',
    };
    final raw = m['type'];
    final key = raw is num
        ? (raw.toInt() >= 0 && raw.toInt() < _moveTypeKeys.length
            ? _moveTypeKeys[raw.toInt()]
            : 'Outbound')
        : (_moveTypeKeys.contains('$raw') ? '$raw' : 'Outbound');
    final inbound = key == 'Inbound' || key == 'Adjustment';
    final at = parseUtcToLocal(m['occurredAtUtc'] ?? m['createdAtUtc']);
    final qty = (m['quantity'] as num?)?.toDouble() ?? 0;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Icon(inbound ? Icons.south_west_rounded : Icons.north_east_rounded,
              size: 14, color: inbound ? AppColors.success : AppColors.danger),
          const SizedBox(width: 7),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(labels[key] ?? key,
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                Text(
                  '${at == null ? '—' : DateFormat('d MMM yyyy · HH:mm', 'tr_TR').format(at)}'
                  '${'${m['staffName'] ?? ''}'.trim().isEmpty ? '' : ' · ${m['staffName']}'}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 10, color: AppColors.muted),
                ),
              ],
            ),
          ),
          Text('${inbound ? '+' : '−'}${_trimNum(qty)}',
              style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w900,
                  color: inbound ? AppColors.success : AppColors.danger)),
        ],
      ),
    );
  }

  Widget _infoCard(String title, List<(String, String, Color?)> rows) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceSoft.withValues(alpha: .5),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: const TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                  letterSpacing: .4,
                  color: AppColors.muted)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 18,
            runSpacing: 10,
            children: [
              for (final (k, v, tone) in rows)
                SizedBox(
                  width: 140,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(k,
                          style: const TextStyle(
                              fontSize: 9.5, color: AppColors.muted)),
                      const SizedBox(height: 2),
                      Text(v,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: tone ?? AppColors.ink)),
                    ],
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  String _trimNum(double v) =>
      v == v.roundToDouble() ? '${v.toInt()}' : '$v';
}
