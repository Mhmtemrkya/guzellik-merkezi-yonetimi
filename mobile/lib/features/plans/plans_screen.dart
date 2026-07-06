import 'package:flutter/material.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/network/api_client.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/widgets/async_list_page.dart';

class PlansScreen extends StatelessWidget {
  const PlansScreen({required this.api, required this.auth, super.key});
  final ApiClient api;
  final AuthController auth;

  static const _planFields = [
    CrudField(key: 'name', label: 'Plan adı', required: true),
    CrudField(
      key: 'planKey',
      label: 'Plan anahtarı (key)',
      required: true,
      showOnEdit: false,
    ),
    CrudField(
      key: 'description',
      label: 'Açıklama',
      type: CrudFieldType.multiline,
    ),
    CrudField(
      key: 'monthlyPriceTRY',
      label: 'Aylık fiyat (₺)',
      type: CrudFieldType.decimal,
      required: true,
    ),
    CrudField(
      key: 'yearlyPriceTRY',
      label: 'Yıllık fiyat (₺)',
      type: CrudFieldType.decimal,
      defaultValue: 0,
    ),
    CrudField(
      key: 'maxBranches',
      label: 'Maks. şube',
      type: CrudFieldType.number,
      defaultValue: 1,
    ),
    CrudField(
      key: 'maxStaff',
      label: 'Maks. personel',
      type: CrudFieldType.number,
      defaultValue: 5,
    ),
    CrudField(
      key: 'maxCustomers',
      label: 'Maks. müşteri',
      type: CrudFieldType.number,
      defaultValue: 1000,
    ),
    CrudField(
      key: 'maxMonthlyAppointments',
      label: 'Aylık randevu limiti',
      type: CrudFieldType.number,
      defaultValue: 1000,
    ),
    CrudField(
      key: 'maxMonthlySmsCount',
      label: 'Aylık SMS limiti',
      type: CrudFieldType.number,
      defaultValue: 0,
    ),
    CrudField(
      key: 'maxMonthlyWhatsAppCount',
      label: 'Aylık WhatsApp limiti',
      type: CrudFieldType.number,
      defaultValue: 0,
    ),
    CrudField(
      key: 'maxMonthlyEmailCount',
      label: 'Aylık e-posta limiti',
      type: CrudFieldType.number,
      defaultValue: 0,
    ),
    CrudField(
      key: 'displayOrder',
      label: 'Sıralama',
      type: CrudFieldType.number,
      defaultValue: 0,
    ),
    CrudField(
      key: 'isActive',
      label: 'Aktif',
      type: CrudFieldType.toggle,
      defaultValue: true,
      showOnCreate: false,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    if (auth.user?.isPlatform != true) {
      return AsyncListPage(
        eyebrow: 'Abonelik',
        title: 'Abonelik Planları',
        subtitle: 'Plan özellikleri, limitler ve fiyatlandırma.',
        loader: () => api.get('/api/admin/subscription-plans'),
        icon: Icons.workspace_premium_rounded,
        titleKeys: const ['name', 'displayName'],
        subtitleKeys: const ['description', 'planKey'],
        trailingKeys: const ['monthlyPriceTRY', 'monthlyPrice'],
        statusKeys: const ['isActive', 'status'],
      );
    }
    return CrudListScreen(
      eyebrow: 'Platform',
      title: 'Abonelik Planları',
      subtitle: 'Plan özellikleri, limitler ve fiyatlandırma.',
      icon: Icons.workspace_premium_rounded,
      loader: () => api.get('/api/platform/subscription-plans/'),
      titleKeys: const ['name', 'displayName'],
      subtitleKeys: const ['description', 'planKey'],
      trailingKeys: const ['monthlyPriceTRY', 'monthlyPrice'],
      statusKeys: const ['isActive', 'status'],
      createLabel: 'Yeni plan',
      fields: _planFields,
      onCreate: (body) => api.post('/api/platform/subscription-plans/', body),
      onUpdate: (item, body) =>
          api.put('/api/platform/subscription-plans/${item['id']}', body),
      onDelete: (item) =>
          api.delete('/api/platform/subscription-plans/${item['id']}'),
    );
  }
}
