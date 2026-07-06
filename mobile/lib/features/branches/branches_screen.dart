import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../shared/crud/crud_screen.dart';

class BranchesScreen extends StatelessWidget {
  const BranchesScreen({required this.api, super.key});
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return CrudListScreen(
      eyebrow: 'Kurum',
      title: 'Şubeler',
      subtitle: 'Şube yönetimi, personel ve oda kapasitesi.',
      icon: Icons.store_mall_directory_rounded,
      loader: () => api.get('/api/admin/branches/'),
      titleKeys: const ['name'],
      subtitleKeys: const ['city', 'staffCount', 'roomCount'],
      statusKeys: const ['isDefault'],
      createLabel: 'Yeni şube',
      fields: const [
        CrudField(key: 'name', label: 'Şube adı', required: true),
        CrudField(key: 'city', label: 'Şehir', required: true),
        CrudField(
          key: 'staffCount',
          label: 'Personel sayısı',
          type: CrudFieldType.number,
          defaultValue: 0,
        ),
        CrudField(
          key: 'roomCount',
          label: 'Oda sayısı',
          type: CrudFieldType.number,
          defaultValue: 0,
        ),
        CrudField(
          key: 'isDefault',
          label: 'Varsayılan şube',
          type: CrudFieldType.toggle,
        ),
      ],
      onCreate: (body) => api.post('/api/admin/branches/', body),
      onUpdate: (item, body) =>
          api.put('/api/admin/branches/${item['id']}', body),
      onDelete: (item) => api.delete('/api/admin/branches/${item['id']}'),
    );
  }
}
