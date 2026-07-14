import 'package:flutter/material.dart';

import '../../core/auth/permissions.dart';
import '../../core/network/api_client.dart';
import '../../shared/crud/crud_screen.dart';

class ExpenseCategoriesScreen extends StatelessWidget {
  const ExpenseCategoriesScreen({required this.api, super.key});
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    final me = api.auth?.user;
    return CrudListScreen(
      canCreate: me?.canAction(Perm.accountingExpenses) ?? true,
      canUpdate: me?.canAction(Perm.accountingExpenses) ?? true,
      canDelete: me?.canAction(Perm.accountingExpenses) ?? true,
      eyebrow: 'Ön Muhasebe',
      title: 'Gider Kategorileri',
      subtitle: 'Kurum özel gider kategorileri.',
      icon: Icons.folder_special_rounded,
      loader: () => api.get('/api/admin/expense-categories/'),
      titleKeys: const ['name'],
      subtitleKeys: const ['description'],
      statusKeys: const ['isActive'],
      createLabel: 'Yeni kategori',
      fields: const [
        CrudField(key: 'name', label: 'Kategori adı', required: true),
        CrudField(
          key: 'isActive',
          label: 'Aktif',
          type: CrudFieldType.toggle,
          defaultValue: true,
        ),
      ],
      onCreate: (body) => api.post('/api/admin/expense-categories/', body),
      onUpdate: (item, body) =>
          api.put('/api/admin/expense-categories/${item['id']}', body),
      onDelete: (item) =>
          api.delete('/api/admin/expense-categories/${item['id']}'),
    );
  }
}
