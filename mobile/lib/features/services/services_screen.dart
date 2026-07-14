import 'package:flutter/material.dart';

import '../../core/auth/permissions.dart';
import '../../core/network/api_client.dart';
import '../../shared/widgets/async_list_page.dart';
import 'service_form.dart';

/// "Hizmetler" sayfası — hizmet havuzu listesi + yeni hizmet tanımlama.
class ServicesScreen extends StatefulWidget {
  const ServicesScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<ServicesScreen> createState() => _ServicesScreenState();
}

class _ServicesScreenState extends State<ServicesScreen> {
  int _refreshKey = 0;

  void _refresh() => setState(() => _refreshKey++);

  Future<void> _openForm([Map<String, dynamic>? item]) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => ServiceForm(api: widget.api, item: item),
    );
    if (changed == true) _refresh();
  }

  @override
  Widget build(BuildContext context) {
    return AsyncListPage(
      key: ValueKey(_refreshKey),
      eyebrow: 'İşletme',
      title: 'Hizmetler',
      subtitle: 'Hizmet havuzu, süre, seans ve fiyat yönetimi.',
      icon: Icons.spa_rounded,
      loader: () => widget.api.get(
        '/api/admin/services/',
        query: {'page': 1, 'pageSize': 200},
      ),
      titleKeys: const ['name'],
      subtitleKeys: const ['category', 'durationMinutes'],
      trailingKeys: const ['price'],
      statusKeys: const ['status', 'isActive'],
      onItemTap: _openForm,
      floatingAction: (widget.api.auth?.user?.canAction(Perm.servicesManage) ?? true)
          ? FloatingActionButton.extended(
              onPressed: () => _openForm(),
              icon: const Icon(Icons.add_rounded),
              label: const Text('Hizmet ekle'),
            )
          : null,
    );
  }
}
