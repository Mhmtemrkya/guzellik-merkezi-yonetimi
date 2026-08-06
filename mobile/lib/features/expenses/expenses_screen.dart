import 'package:flutter/material.dart';

import '../../core/auth/permissions.dart';
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
    final me = api.auth?.user;
    return CrudListScreen(
      canCreate: me?.canAction(Perm.accountingExpenses) ?? true,
      canUpdate: me?.canAction(Perm.accountingExpenses) ?? true,
      canDelete: me?.canAction(Perm.accountingExpenses) ?? true,
      // Müşteri iadeleri gider listesinde de görünür (gider özeti onları zaten sayıyordu),
      // ama elle girilmiş kayıt değildir: düzenlenemez/silinemez.
      isReadOnlyItem: (item) => item['isSystemGenerated'] == true,
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
      // ONAYLANMIŞ GİDER SİLİNMEZ, GEREKÇEYLE GEÇERSİZ KILINIR (web ile aynı kural):
      // silme onaylı kaydı gizliyor, gerçekleşmiş kasa çıkışı raporlardan düşüyordu.
      onDelete: (item) => _removeExpense(context, api, item),
      decorateCreate: (body) => body['branchId'] = api.auth?.user?.branchId,
    );
  }

  /// Onay bekleyen kayıt silinir; ONAYLANMIŞ kayıt yalnız gerekçeyle geçersiz kılınabilir.
  static Future<void> _removeExpense(
      BuildContext context, ApiClient api, Map<String, dynamic> item) async {
    final id = '${item['id']}';
    final approved = item['isApproved'] == true;
    if (!approved) {
      await api.delete('/api/admin/expenses/$id');
      return;
    }

    final reason = await _askVoidReason(context);
    if (reason == null || reason.trim().isEmpty) {
      throw Exception('Geçersiz kılma iptal edildi: gerekçe zorunlu.');
    }
    await api.post('/api/admin/expenses/$id/void', {'reason': reason.trim()});
  }

  static Future<String?> _askVoidReason(BuildContext context) {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Gideri geçersiz kıl'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
                'Onaylanmış gider silinemez. Kayıt iz olarak kalır, toplamlardan düşer.'),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Gerekçe (zorunlu)',
                hintText: 'ör. yanlış girildi, para çıkmadı',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Vazgeç')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text),
            child: const Text('Geçersiz kıl'),
          ),
        ],
      ),
    );
  }
}
