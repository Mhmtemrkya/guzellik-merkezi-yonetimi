import 'package:flutter/material.dart';

import '../../core/auth/permissions.dart';
import '../../core/network/api_client.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/json_helpers.dart';

class ServiceCategoriesScreen extends StatelessWidget {
  const ServiceCategoriesScreen({required this.api, super.key});
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    final me = api.auth?.user;
    return CrudListScreen(
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
