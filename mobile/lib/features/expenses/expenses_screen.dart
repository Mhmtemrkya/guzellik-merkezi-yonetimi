import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../shared/crud/crud_options.dart';
import '../../shared/crud/crud_screen.dart';

const _expenseCategories = [
  CrudOption('Salary', 'Maaş'),
  CrudOption('Tax', 'Vergi'),
  CrudOption('Rent', 'Kira'),
  CrudOption('Utilities', 'Faturalar'),
  CrudOption('Supplies', 'Sarf Malzeme'),
  CrudOption('Inventory', 'Stok/Ürün'),
  CrudOption('Marketing', 'Pazarlama'),
  CrudOption('Maintenance', 'Bakım'),
  CrudOption('Professional', 'Danışmanlık'),
  CrudOption('Equipment', 'Ekipman'),
  CrudOption('Office', 'Ofis'),
  CrudOption('Other', 'Diğer'),
];

const _paymentMethods = [
  CrudOption('Cash', 'Nakit'),
  CrudOption('Card', 'Kart'),
  CrudOption('BankTransfer', 'Havale/EFT'),
  CrudOption('Check', 'Çek'),
];

class ExpensesScreen extends StatelessWidget {
  const ExpensesScreen({required this.api, super.key});
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    final options = CrudOptions(api);
    return CrudListScreen(
      eyebrow: 'Ön Muhasebe',
      title: 'Giderler',
      subtitle: 'Gider kayıtları, kategori ve ödeme yöntemleri.',
      icon: Icons.receipt_long_rounded,
      loader: () =>
          api.get('/api/admin/expenses/', query: {'page': 1, 'pageSize': 200}),
      titleKeys: const ['description', 'category'],
      subtitleKeys: const ['vendor', 'occurredAtUtc', 'staffName'],
      trailingKeys: const ['amount'],
      statusKeys: const ['status', 'category'],
      createLabel: 'Yeni gider',
      fields: [
        const CrudField(
          key: 'category',
          label: 'Kategori',
          type: CrudFieldType.select,
          options: _expenseCategories,
          defaultValue: 'Other',
        ),
        const CrudField(
          key: 'amount',
          label: 'Tutar',
          type: CrudFieldType.decimal,
          required: true,
        ),
        const CrudField(
          key: 'paymentMethod',
          label: 'Ödeme yöntemi',
          type: CrudFieldType.select,
          options: _paymentMethods,
          defaultValue: 'Cash',
        ),
        const CrudField(
          key: 'occurredAtUtc',
          label: 'Tarih',
          type: CrudFieldType.date,
          dateOnly: false,
          required: true,
        ),
        CrudField(
          key: 'staffMemberId',
          label: 'Personel (opsiyonel)',
          type: CrudFieldType.select,
          optionsLoader: options.staff,
        ),
        const CrudField(key: 'periodLabel', label: 'Dönem etiketi'),
        const CrudField(
          key: 'description',
          label: 'Açıklama',
          type: CrudFieldType.multiline,
        ),
        const CrudField(key: 'reference', label: 'Referans/Fiş no'),
      ],
      onCreate: (body) => api.post('/api/admin/expenses/', body),
      onUpdate: (item, body) =>
          api.put('/api/admin/expenses/${item['id']}', body),
      onDelete: (item) => api.delete('/api/admin/expenses/${item['id']}'),
      decorateCreate: (body) => body['branchId'] = api.auth?.user?.branchId,
    );
  }
}
