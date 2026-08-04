import 'dart:async';
import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/responsive.dart';
import '../export/export_helper.dart';
import '../guide/guide_content.dart';
import '../guide/page_guide.dart';
import '../json_helpers.dart';
import 'app_background.dart';
import 'page_header.dart';
import 'status_badge.dart';

typedef EntityLoader = Future<dynamic> Function();
typedef EntityAction = Future<void> Function(Map<String, dynamic> item);

/// Arama kutusunun altında çip olarak görünen istemci-tarafı liste filtresi
/// (ör. Müşteriler → VIP). "Tümü" çipi otomatik eklenir.
class ListFilterOption {
  const ListFilterOption(this.label, this.test);
  final String label;
  final bool Function(Map<String, dynamic> item) test;
}

/// Listede seçili kayıtlar üzerinde çalışan, silme dışı toplu işlem
/// (ör. "KVKK onay mesajı gönder"). Kullanıcıya gösterilecek sonuç metnini döner.
class BulkListAction {
  const BulkListAction({
    required this.label,
    required this.icon,
    required this.run,
  });

  final String label;
  final IconData icon;
  final Future<String> Function(List<Map<String, dynamic>> items) run;
}

class AsyncListPage extends StatefulWidget {
  const AsyncListPage({
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.loader,
    required this.icon,
    required this.titleKeys,
    required this.subtitleKeys,
    this.trailingKeys = const [],
    this.statusKeys = const [],
    this.statusLabel,
    this.filters = const [],
    this.emptyText = 'Henüz kayıt bulunmuyor.',
    this.floatingAction,
    this.itemAction,
    this.itemActionIcon,
    this.onItemTap,
    this.headerExtra,
    this.canExport = false,
    this.guideKey,
    this.guideUid,
    this.onBulkDelete,
    this.bulkActions = const [],
    this.remoteSearch,
    super.key,
  });

  final String eyebrow;
  final String title;
  final String subtitle;
  final EntityLoader loader;
  final IconData icon;
  final List<String> titleKeys;
  final List<String> subtitleKeys;
  final List<String> trailingKeys;
  final List<String> statusKeys;

  /// Durum rozetinin metnini kayıttan üretir. Verilmezse [statusKeys] değeri
  /// ham haliyle basılır — bool alanlarda "true/false" görünür. Dışa aktarmadaki
  /// "Durum" kolonu da bu metni kullanır.
  final String Function(Map<String, dynamic> item)? statusLabel;
  final List<ListFilterOption> filters;
  final String emptyText;
  final Widget? floatingAction;
  final EntityAction? itemAction;
  final IconData? itemActionIcon;
  final void Function(Map<String, dynamic> item)? onItemTap;
  final Widget? headerExtra;

  /// Verilirse listede toplu seçim açılır: karta uzun basınca seçim modu başlar,
  /// sonraki dokunuşlar seçer/kaldırır ve alt çubuktan seçilenler topluca silinir.
  final Future<void> Function(List<Map<String, dynamic>> items)? onBulkDelete;

  /// true ise başlıkta "Dışa aktar" düğmesi çıkar: ekrandaki (filtrelenmiş) satırlar
  /// Excel/PDF olarak paylaşılır. Kolonlar title/subtitle/trailing/status anahtarlarından
  /// türetilir — her ekran için ayrı tablo tanımlamaya gerek kalmaz.
  final bool canExport;

  /// Verilirse başlıkta kılavuz düğmesi çıkar (GuideContent anahtarı).
  final String? guideKey;

  /// Kılavuzun "görüldü" kaydı kullanıcı başına tutulur.
  final String? guideUid;

  /// Silme dışındaki toplu işlemler (ör. "KVKK onay mesajı gönder"). Dolu ise
  /// silme yetkisi olmasa bile seçim modu açılır.
  final List<BulkListAction> bulkActions;

  /// SUNUCU-TARAFLI arama. Verilirse arama kutusu bellekte filtrelemez; terimi sunucuya
  /// gönderir (350 ms debounce) ve dönen sayfayı gösterir. Ölçek kuralı: 12 bin / 1 milyon
  /// müşteride tüm liste indirilmez — web müşteriler sayfasıyla aynı davranış.
  final Future<dynamic> Function(String query)? remoteSearch;

  @override
  State<AsyncListPage> createState() => _AsyncListPageState();
}

class _AsyncListPageState extends State<AsyncListPage> {
  late Future<dynamic> future;
  String query = '';
  Timer? _searchDebounce;
  // Toplu seçim (web BulkSelectBar paritesi): id -> kayıt.
  final Map<String, Map<String, dynamic>> _selected = {};
  bool _bulkBusy = false;
  // -1 = Tümü; aksi halde widget.filters index'i.
  int filterIndex = -1;

  @override
  void initState() {
    super.initState();
    future = widget.loader();
  }

  void refresh() => setState(() => future = widget.loader());

  /// Ekranda görünen (filtre + arama uygulanmış) satırlar — dışa aktarmanın kaynağı.
  List<Map<String, dynamic>> _exportable = const [];

  /// Listeyi Excel/PDF olarak dışa aktarır. Kolonlar liste kartındaki alan
  /// anahtarlarından türetilir; her ekran için ayrı tablo tanımına gerek kalmaz.
  Future<void> _exportList() async {
    final columns = <(String, String Function(Map<String, dynamic>))>[
      ('Kayıt', (item) => valueOf(item, widget.titleKeys, fallback: '')),
      ('Detay', (item) => valueOf(item, widget.subtitleKeys, fallback: '')),
      if (widget.trailingKeys.isNotEmpty)
        ('Tutar', (item) => valueOf(item, widget.trailingKeys, fallback: '')),
      if (_hasStatus) ('Durum', _statusText),
    ];

    await ExportHelper.showMenu(
      context,
      title: widget.title,
      subtitle: widget.subtitle,
      headers: columns.map((c) => c.$1).toList(),
      rows: _exportable
          .map((item) => columns.map((c) => c.$2(item)).toList())
          .toList(),
    );
  }

  bool get _hasStatus =>
      widget.statusLabel != null || widget.statusKeys.isNotEmpty;

  /// Durum rozeti metni: özel etiket varsa o, yoksa ham alan değeri.
  String _statusText(Map<String, dynamic> item) =>
      widget.statusLabel?.call(item) ??
      valueOf(item, widget.statusKeys, fallback: '');

  @override
  void dispose() {
    _searchDebounce?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        floatingActionButton: _selected.isEmpty ? widget.floatingAction : null,
        bottomNavigationBar: _selected.isEmpty ? null : _bulkBar(),
        body: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: () async {
              refresh();
              await future;
            },
            // Tablet/iPad: liste içeriği tam genişlikte yayılmaz, ortalanıp sınırlanır.
            child: ResponsiveCenter(
              maxWidth: 1100,
              child: CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              slivers: [
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(18, 22, 18, 12),
                  sliver: SliverToBoxAdapter(
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: PageHeader(
                            eyebrow: widget.eyebrow,
                            title: widget.title,
                            subtitle: widget.subtitle,
                          ),
                        ),
                        // Sayfa kılavuzu (web Topbar'daki kitap simgesi).
                        if (widget.guideKey != null)
                          IconButton(
                            tooltip: 'Sayfa kılavuzu',
                            onPressed: () {
                              final guide = GuideContent.forKey(widget.guideKey!);
                              if (guide == null) return;
                              showPageGuide(
                                context,
                                pageKey: widget.guideKey!,
                                uid: widget.guideUid ?? 'anon',
                                content: guide,
                              );
                            },
                            icon: const Icon(Icons.menu_book_rounded),
                          ),
                        if (widget.canExport)
                          IconButton(
                            tooltip: 'Dışa aktar',
                            onPressed: _exportList,
                            icon: const Icon(Icons.ios_share_rounded),
                          ),
                      ],
                    ),
                  ),
                ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(18, 8, 18, 14),
                  sliver: SliverToBoxAdapter(
                    child: TextField(
                      onChanged: (value) {
                        final term = value.trim();
                        if (widget.remoteSearch == null) {
                          setState(() => query = term.toLowerCase());
                          return;
                        }
                        // Sunucu araması: her tuşta istek atmamak için debounce.
                        _searchDebounce?.cancel();
                        _searchDebounce = Timer(
                          const Duration(milliseconds: 350),
                          () => setState(() {
                            query = '';
                            future = widget.remoteSearch!(term);
                          }),
                        );
                      },
                      decoration: const InputDecoration(
                        prefixIcon: Icon(Icons.search_rounded),
                        hintText: 'Ara...',
                      ),
                    ),
                  ),
                ),
                if (widget.filters.isNotEmpty)
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(18, 0, 18, 12),
                    sliver: SliverToBoxAdapter(
                      child: Wrap(
                        spacing: 8,
                        children: [
                          ChoiceChip(
                            label: const Text('Tümü'),
                            selected: filterIndex == -1,
                            onSelected: (_) =>
                                setState(() => filterIndex = -1),
                          ),
                          for (var i = 0; i < widget.filters.length; i++)
                            ChoiceChip(
                              label: Text(widget.filters[i].label),
                              selected: filterIndex == i,
                              onSelected: (_) =>
                                  setState(() => filterIndex = i),
                            ),
                        ],
                      ),
                    ),
                  ),
                if (widget.headerExtra != null)
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(18, 0, 18, 12),
                    sliver: SliverToBoxAdapter(child: widget.headerExtra),
                  ),
                FutureBuilder<dynamic>(
                  future: future,
                  builder: (context, snapshot) {
                    if (snapshot.connectionState != ConnectionState.done) {
                      return const SliverFillRemaining(
                        hasScrollBody: false,
                        child: Center(child: CircularProgressIndicator()),
                      );
                    }
                    if (snapshot.hasError) {
                      return SliverFillRemaining(
                        hasScrollBody: false,
                        child: _ErrorState(
                          message: '${snapshot.error}',
                          onRetry: refresh,
                        ),
                      );
                    }
                    final activeFilter =
                        filterIndex >= 0 && filterIndex < widget.filters.length
                            ? widget.filters[filterIndex]
                            : null;
                    final items = apiItems(snapshot.data).where((item) {
                      if (activeFilter != null && !activeFilter.test(item)) {
                        return false;
                      }
                      if (query.isEmpty) return true;
                      return item.values
                          .join(' ')
                          .toLowerCase()
                          .contains(query);
                    }).toList();
                    // Dışa aktarma, EKRANDA GÖRÜNEN (filtre + arama uygulanmış) satırları
                    // kullanır — kullanıcı ne görüyorsa onu alır.
                    _exportable = items;
                    if (items.isEmpty) {
                      return SliverFillRemaining(
                        hasScrollBody: false,
                        child: Center(
                          child: Padding(
                            padding: const EdgeInsets.all(40),
                            child: Text(
                              widget.emptyText,
                              textAlign: TextAlign.center,
                              style: const TextStyle(color: AppColors.muted),
                            ),
                          ),
                        ),
                      );
                    }
                    // Tablet/iPad: tek kolonlu upuzun liste yerine 2-3 kolonlu
                    // kompakt kart grid'i; telefonda klasik liste.
                    final width = context.screenWidth;
                    final gridColumns =
                        width >= 1000 ? 3 : (width >= 700 ? 2 : 1);
                    if (gridColumns > 1) {
                      return SliverPadding(
                        padding: const EdgeInsets.fromLTRB(18, 0, 18, 110),
                        sliver: SliverGrid.builder(
                          gridDelegate:
                              SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: gridColumns,
                            mainAxisSpacing: 10,
                            crossAxisSpacing: 10,
                            mainAxisExtent: 108,
                          ),
                          itemCount: items.length,
                          itemBuilder: (context, index) =>
                              _itemCard(items[index], compact: true),
                        ),
                      );
                    }
                    return SliverPadding(
                      padding: const EdgeInsets.fromLTRB(18, 0, 18, 110),
                      sliver: SliverList.separated(
                        itemCount: items.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 10),
                        itemBuilder: (context, index) =>
                            _itemCard(items[index], compact: false),
                      ),
                    );
                  },
                ),
              ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// Toplu seçim çubuğu: seçili sayısı + temizle + sil (web BulkSelectBar paritesi).
  Widget _bulkBar() {
    return SafeArea(
      child: Container(
        margin: const EdgeInsets.fromLTRB(14, 0, 14, 12),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: AppColors.border),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDark.withValues(alpha: .12),
              blurRadius: 24,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                '${_selected.length} kayıt seçildi',
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 13,
                ),
              ),
            ),
            TextButton(
              onPressed: _bulkBusy ? null : () => setState(_selected.clear),
              child: const Text('Temizle'),
            ),
            for (final action in widget.bulkActions) ...[
              const SizedBox(width: 4),
              FilledButton.icon(
                style: FilledButton.styleFrom(
                    backgroundColor: AppColors.success,
                    minimumSize: const Size(0, 40)),
                onPressed: _bulkBusy ? null : () => _runBulkAction(action),
                icon: Icon(action.icon, size: 17),
                label: Text(action.label),
              ),
            ],
            if (widget.onBulkDelete != null) ...[
              const SizedBox(width: 4),
              FilledButton.icon(
                style: FilledButton.styleFrom(
                    backgroundColor: AppColors.danger,
                    minimumSize: const Size(0, 40)),
                onPressed: _bulkBusy ? null : _runBulkDelete,
                icon: _bulkBusy
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.delete_outline_rounded, size: 17),
                label: const Text('Sil'),
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// Seçim modu silme YA DA en az bir ek toplu işlem varsa açılır.
  bool get _selectionEnabled =>
      widget.onBulkDelete != null || widget.bulkActions.isNotEmpty;

  /// Silme dışı toplu işlem — sonuç metni kullanıcıya snackbar ile bildirilir.
  Future<void> _runBulkAction(BulkListAction action) async {
    if (_selected.isEmpty) return;
    final items = _selected.values.toList();
    setState(() => _bulkBusy = true);
    String message;
    try {
      message = await action.run(items);
    } catch (e) {
      message = '$e';
    }
    if (!mounted) return;
    setState(() {
      _selected.clear();
      _bulkBusy = false;
    });
    refresh();
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _runBulkDelete() async {
    final handler = widget.onBulkDelete;
    if (handler == null || _selected.isEmpty) return;
    final count = _selected.length;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Seçilenler silinsin mi?'),
        content: Text('$count kayıt kalıcı olarak silinecek.'),
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
    setState(() => _bulkBusy = true);
    try {
      await handler(_selected.values.toList());
      if (!mounted) return;
      setState(() {
        _selected.clear();
        _bulkBusy = false;
      });
      refresh();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$count kayıt silindi.')),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _bulkBusy = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  /// Ortak liste kartı. [compact] tablet grid'inde: alt yazı tek satır,
  /// durum rozeti sağa alınır ki kart yüksekliği sabit kalsın.
  Widget _itemCard(Map<String, dynamic> item, {required bool compact}) {
    final selected = _selected.containsKey('${item['id'] ?? ''}');
    return Card(
      clipBehavior: Clip.antiAlias,
      margin: EdgeInsets.zero,
      color: selected ? AppColors.surfaceSoft : null,
      shape: selected
          ? RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(18),
              side: const BorderSide(color: AppColors.primaryDark, width: 1.4),
            )
          : null,
      child: InkWell(
        onTap: () {
          final id = '${item['id'] ?? ''}';
          if (_selected.isNotEmpty && _selectionEnabled && id.isNotEmpty) {
            setState(() {
              if (_selected.containsKey(id)) {
                _selected.remove(id);
              } else {
                _selected[id] = item;
              }
            });
            return;
          }
          widget.onItemTap?.call(item);
        },
        onLongPress: !_selectionEnabled
            ? null
            : () {
                final id = '${item['id'] ?? ''}';
                if (id.isEmpty) return;
                setState(() {
                  if (_selected.containsKey(id)) {
                    _selected.remove(id);
                  } else {
                    _selected[id] = item;
                  }
                });
              },
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: AppColors.surfaceSoft,
                  borderRadius: BorderRadius.circular(15),
                ),
                child: Icon(widget.icon, color: AppColors.primaryDark),
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      valueOf(item, widget.titleKeys),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      valueOf(item, widget.subtitleKeys),
                      maxLines: compact ? 1 : 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 12,
                      ),
                    ),
                    if (_hasStatus) ...[
                      const SizedBox(height: 8),
                      StatusBadge(_statusText(item)),
                    ],
                  ],
                ),
              ),
              if (widget.trailingKeys.isNotEmpty)
                Text(
                  valueOf(item, widget.trailingKeys),
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    color: AppColors.primaryDark,
                    fontSize: 12,
                  ),
                ),
              if (widget.itemAction != null)
                IconButton(
                  onPressed: () async {
                    await widget.itemAction!(item);
                    refresh();
                  },
                  icon: Icon(
                    widget.itemActionIcon ?? Icons.chevron_right_rounded,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.cloud_off_rounded,
            size: 44,
            color: AppColors.primary,
          ),
          const SizedBox(height: 12),
          Text(message, textAlign: TextAlign.center),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Tekrar dene'),
          ),
        ],
      ),
    ),
  );
}
