import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/json_helpers.dart';

class BranchesScreen extends StatelessWidget {
  const BranchesScreen({required this.api, super.key});
  final ApiClient api;

  /// Şehir + canlı personel sayısını tek satırda gösterebilmek için türetilmiş alan
  /// ekler ([valueOf] yalnızca ilk dolu anahtarı yazdırdığından iki alan yan yana gelmiyordu).
  Future<dynamic> _load() async {
    final items = apiItems(await api.get('/api/admin/branches/'));
    for (final item in items) {
      final city = valueOf(item, const ['city'], fallback: '');
      final staff = numberOf(item, const ['staffCount', 'staff']).toInt();
      item['_summary'] = [
        if (city.isNotEmpty) city,
        '$staff personel',
      ].join(' · ');
    }
    return items;
  }

  @override
  Widget build(BuildContext context) {
    return CrudListScreen(
      eyebrow: 'Kurum',
      title: 'Şubeler',
      subtitle: 'Şube yönetimi ve personel dağılımı.',
      icon: Icons.store_mall_directory_rounded,
      loader: _load,
      titleKeys: const ['name'],
      subtitleKeys: const ['_summary', 'city'],
      statusKeys: const ['isDefault'],
      createLabel: 'Yeni şube',
      // Personel sayısı şubeye kayıtlı personelden otomatik gelir; elle kapasite alanı yok.
      fields: const [
        CrudField(key: 'name', label: 'Şube adı', required: true),
        CrudField(key: 'city', label: 'Şehir', required: true),
        CrudField(
          key: 'isDefault',
          label: 'Varsayılan şube',
          type: CrudFieldType.toggle,
        ),
      ],
      onCreate: (body) => api.post('/api/admin/branches/', body),
      onUpdate: (item, body) =>
          api.put('/api/admin/branches/${item['id']}', body),
      // Şube silme ucu backend'de yok (randevu/personel/cari şubeye bağlı) — buton gösterilmiyor.
      canDelete: false,
    );
  }
}
