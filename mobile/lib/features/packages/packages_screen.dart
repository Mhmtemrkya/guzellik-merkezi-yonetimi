import 'package:flutter/material.dart';

import '../../core/auth/permissions.dart';
import '../../core/network/api_client.dart';
import '../../shared/widgets/async_list_page.dart';
import 'package_form.dart';

/// "Paketler" sayfası — seans paketleri listesi + paket tanımlama.
class PackagesScreen extends StatefulWidget {
  const PackagesScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<PackagesScreen> createState() => _PackagesScreenState();
}

class _PackagesScreenState extends State<PackagesScreen> {
  int _refreshKey = 0;

  void _refresh() => setState(() => _refreshKey++);

  Future<void> _openForm([Map<String, dynamic>? item]) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => PackageForm(api: widget.api, item: item),
    );
    if (changed == true) _refresh();
  }

  @override
  Widget build(BuildContext context) {
    return AsyncListPage(
      key: ValueKey(_refreshKey),
      eyebrow: 'İşletme',
      title: 'Paketler',
      subtitle: 'Seans paketleri, içerik ve taksit yönetimi.',
      icon: Icons.workspaces_rounded,
      loader: () => widget.api.get(
        '/api/admin/packages/',
        query: {'page': 1, 'pageSize': 200},
      ),
      titleKeys: const ['name'],
      subtitleKeys: const ['category', 'totalSessions'],
      trailingKeys: const ['totalPrice'],
      statusKeys: const ['status', 'isActive'],
      onItemTap: _openForm,
      floatingAction: (widget.api.auth?.user?.canAction(Perm.servicesManage) ?? true)
          ? FloatingActionButton.extended(
              onPressed: () => _openForm(),
              icon: const Icon(Icons.add_rounded),
              label: const Text('Paket ekle'),
            )
          : null,
    );
  }
}
