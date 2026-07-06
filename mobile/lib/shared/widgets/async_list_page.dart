import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/responsive.dart';
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
    this.filters = const [],
    this.emptyText = 'Henüz kayıt bulunmuyor.',
    this.floatingAction,
    this.itemAction,
    this.itemActionIcon,
    this.onItemTap,
    this.headerExtra,
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
  final List<ListFilterOption> filters;
  final String emptyText;
  final Widget? floatingAction;
  final EntityAction? itemAction;
  final IconData? itemActionIcon;
  final void Function(Map<String, dynamic> item)? onItemTap;
  final Widget? headerExtra;

  @override
  State<AsyncListPage> createState() => _AsyncListPageState();
}

class _AsyncListPageState extends State<AsyncListPage> {
  late Future<dynamic> future;
  String query = '';
  // -1 = Tümü; aksi halde widget.filters index'i.
  int filterIndex = -1;

  @override
  void initState() {
    super.initState();
    future = widget.loader();
  }

  void refresh() => setState(() => future = widget.loader());

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        floatingActionButton: widget.floatingAction,
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
                    child: PageHeader(
                      eyebrow: widget.eyebrow,
                      title: widget.title,
                      subtitle: widget.subtitle,
                    ),
                  ),
                ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(18, 8, 18, 14),
                  sliver: SliverToBoxAdapter(
                    child: TextField(
                      onChanged: (value) =>
                          setState(() => query = value.trim().toLowerCase()),
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

  /// Ortak liste kartı. [compact] tablet grid'inde: alt yazı tek satır,
  /// durum rozeti sağa alınır ki kart yüksekliği sabit kalsın.
  Widget _itemCard(Map<String, dynamic> item, {required bool compact}) {
    return Card(
      clipBehavior: Clip.antiAlias,
      margin: EdgeInsets.zero,
      child: InkWell(
        onTap: widget.onItemTap == null ? null : () => widget.onItemTap!(item),
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
                    if (widget.statusKeys.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      StatusBadge(valueOf(item, widget.statusKeys)),
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
