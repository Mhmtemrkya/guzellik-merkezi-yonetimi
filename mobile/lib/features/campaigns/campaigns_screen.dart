import 'package:flutter/material.dart';

import '../../core/auth/permissions.dart';
import '../../core/network/api_client.dart';
import '../../shared/crud/crud_options.dart';
import '../../shared/crud/crud_screen.dart';

const _discountTypes = [
  CrudOption('Percent', 'Yüzde (%)'),
  CrudOption('Amount', 'Tutar (₺)'),
];

const _campaignTargets = [
  CrudOption('All', 'Tüm Hizmetler'),
  CrudOption('Service', 'Belirli Hizmet'),
  CrudOption('Package', 'Belirli Paket'),
];

class CampaignsScreen extends StatelessWidget {
  const CampaignsScreen({required this.api, super.key});
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    final options = CrudOptions(api);
    final me = api.auth?.user;
    return CrudListScreen(
      canCreate: me?.canAction(Perm.servicesManage) ?? true,
      canUpdate: me?.canAction(Perm.servicesManage) ?? true,
      canDelete: me?.canAction(Perm.servicesManage) ?? true,
      eyebrow: 'Pazarlama',
      title: 'Kampanyalar',
      subtitle: 'İndirim kampanyaları ve geçerlilik tarihleri.',
      icon: Icons.campaign_rounded,
      loader: () => api.get('/api/admin/campaigns/'),
      titleKeys: const ['name', 'title'],
      subtitleKeys: const ['discountType', 'startDate', 'endDate'],
      trailingKeys: const ['discountValue'],
      statusKeys: const ['isActive'],
      createLabel: 'Yeni kampanya',
      fields: [
        const CrudField(key: 'name', label: 'Kampanya adı', required: true),
        const CrudField(
          key: 'discountType',
          label: 'İndirim tipi',
          type: CrudFieldType.select,
          options: _discountTypes,
          defaultValue: 'Percent',
        ),
        const CrudField(
          key: 'discountValue',
          label: 'İndirim değeri',
          type: CrudFieldType.decimal,
          required: true,
        ),
        const CrudField(
          key: 'target',
          label: 'Hedef',
          type: CrudFieldType.select,
          options: _campaignTargets,
          defaultValue: 'All',
        ),
        CrudField(
          key: 'targetId',
          label: 'Hedef hizmet (opsiyonel)',
          type: CrudFieldType.select,
          optionsLoader: options.services,
        ),
        const CrudField(
          key: 'startDate',
          label: 'Başlangıç',
          type: CrudFieldType.date,
          required: true,
        ),
        const CrudField(
          key: 'endDate',
          label: 'Bitiş',
          type: CrudFieldType.date,
          required: true,
        ),
        const CrudField(
          key: 'isActive',
          label: 'Aktif',
          type: CrudFieldType.toggle,
          defaultValue: true,
        ),
      ],
      onCreate: (body) => api.post('/api/admin/campaigns/', body),
      onUpdate: (item, body) =>
          api.put('/api/admin/campaigns/${item['id']}', body),
      onDelete: (item) => api.delete('/api/admin/campaigns/${item['id']}'),
      decorateCreate: (body) => body['branchId'] = api.auth?.user?.branchId,
    );
  }
}
