import 'package:flutter/material.dart';

import '../../core/auth/permissions.dart';
import '../../core/network/api_client.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/json_helpers.dart';

class ServiceCategoriesScreen extends StatelessWidget {
  const ServiceCategoriesScreen({required this.api, super.key});
  final ApiClient api;

  /// Kategoriyi kardeşleri arasında öne/geri taşı (elle sıralama → SortOrder).
  Future<bool> _move(BuildContext context, Map<String, dynamic> item, int dir) async {
    try {
      final data = await api.get('/api/admin/service-categories/');
      // Liste zaten SortOrder'a göre gelir; aynı üst kategori altındaki kardeşleri diz.
      final siblings = apiItems(data)
          .where((c) => c['parentId'] == item['parentId'])
          .toList();
      final ids = siblings.map((c) => '${c['id']}').toList();
      final i = ids.indexOf('${item['id']}');
      final j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return false;
      final tmp = ids[i];
      ids[i] = ids[j];
      ids[j] = tmp;
      await api.post('/api/admin/service-categories/reorder', {'orderedIds': ids});
      return true;
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = api.auth?.user;
    final canManage = me?.canAction(Perm.servicesManage) ?? true;
    return CrudListScreen(
      rowActions: canManage
          ? [
              CrudRowAction(
                label: 'Öne al',
                icon: Icons.arrow_upward_rounded,
                run: (ctx, item) => _move(ctx, item, -1),
              ),
              CrudRowAction(
                label: 'Geri al',
                icon: Icons.arrow_downward_rounded,
                run: (ctx, item) => _move(ctx, item, 1),
              ),
            ]
          : const [],
      canCreate: me?.canAction(Perm.servicesManage) ?? true,
      canUpdate: me?.canAction(Perm.servicesManage) ?? true,
      canDelete: me?.canAction(Perm.servicesManage) ?? true,
      eyebrow: 'İşletme',
      title: 'Hizmet Kategorileri',
      subtitle: 'Özel hizmet kategori yönetimi — üst kategori seçerek alt kategori oluşturabilirsiniz.',
      icon: Icons.category_rounded,
      loader: () => api.get('/api/admin/service-categories/'),
      titleKeys: const ['name'],
      subtitleKeys: const ['description'],
      statusKeys: const ['isActive'],
      createLabel: 'Yeni kategori',
      fields: [
        const CrudField(key: 'name', label: 'Kategori adı', required: true),
        // Üst kategori seçilirse bu kayıt onun alt kategorisi olur (ParentId ağacı).
        // Boş bırakılırsa üst-seviye kategori olur.
        CrudField(
          key: 'parentId',
          label: 'Üst kategori (opsiyonel — alt kategori için seç)',
          type: CrudFieldType.select,
          optionsLoader: () async {
            final data = await api.get('/api/admin/service-categories/');
            return apiItems(data)
                .where((c) => c['parentId'] == null)
                .map((c) => CrudOption('${c['id']}', valueOf(c, const ['name'])))
                .toList();
          },
        ),
        const CrudField(
          key: 'isActive',
          label: 'Aktif',
          type: CrudFieldType.toggle,
          defaultValue: true,
        ),
      ],
      onCreate: (body) => api.post('/api/admin/service-categories/', body),
      onUpdate: (item, body) =>
          api.put('/api/admin/service-categories/${item['id']}', body),
      onDelete: (item) =>
          api.delete('/api/admin/service-categories/${item['id']}'),
    );
  }
}
