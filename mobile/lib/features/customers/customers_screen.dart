import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/auth/permissions.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/kvkk/kvkk_view_sheet.dart';
import '../../shared/widgets/async_list_page.dart';

const _genders = [
  CrudOption('Female', 'Kadın'),
  CrudOption('Male', 'Erkek'),
  CrudOption('Other', 'Diğer'),
  CrudOption('Unspecified', 'Belirtilmemiş'),
];

class CustomersScreen extends StatelessWidget {
  const CustomersScreen({required this.api, required this.auth, super.key});
  final ApiClient api;
  final AuthController auth;

  String? _cleanId(dynamic value) {
    final id = value?.toString().trim();
    if (id == null || id.isEmpty || id.toLowerCase() == 'null') return null;
    return id;
  }

  Future<String> _resolveBranchId([Map<String, dynamic>? item]) async {
    final existing = _cleanId(item?['branchId']);
    if (existing != null) return existing;

    final sessionBranch = _cleanId(api.auth?.user?.branchId);
    if (sessionBranch != null) return sessionBranch;

    final data = await api.get('/api/admin/branches/');
    final branches = data is List
        ? data.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList()
        : const <Map<String, dynamic>>[];
    if (branches.isNotEmpty) {
      final branch = branches.firstWhere(
        (b) => b['isDefault'] == true,
        orElse: () => branches.first,
      );
      final branchId = _cleanId(branch['id'] ?? branch['branchId']);
      if (branchId != null) return branchId;
    }

    throw const ApiException(
      'Müşteri oluşturmak için şube bilgisi bulunamadı. Çıkış yapıp şube seçerek tekrar giriş yapın.',
    );
  }

  Future<bool> _blacklist(
    BuildContext context,
    Map<String, dynamic> item,
  ) async {
    final next = item['isBlacklisted'] != true;
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: next ? 'Kara listeye al' : 'Kara listeden çıkar',
        icon: Icons.block_rounded,
        fields: const [
          CrudField(
            key: 'reason',
            label: 'Sebep (opsiyonel)',
            type: CrudFieldType.multiline,
          ),
        ],
      ),
    );
    if (result == null) return false;
    await api.post('/api/admin/customers/${item['id']}/blacklist', {
      'blacklisted': next,
      'reason': result.body?['reason'],
    });
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            next ? 'Kara listeye alındı.' : 'Kara listeden çıkarıldı.',
          ),
        ),
      );
    }
    return true;
  }

  Future<bool> _vip(BuildContext context, Map<String, dynamic> item) async {
    final next = item['isVip'] != true;
    await api.post('/api/admin/customers/${item['id']}/vip', {'vip': next});
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(next ? 'VIP etiketi eklendi.' : 'VIP etiketi kaldırıldı.'),
        ),
      );
    }
    return true;
  }

  Future<void> _pushAfterClosingSheet(
    BuildContext rootContext,
    BuildContext sheetContext,
    String location,
    Map<String, dynamic> extra,
  ) async {
    final router = GoRouter.of(rootContext);
    Navigator.of(sheetContext).pop();
    await Future<void>.delayed(const Duration(milliseconds: 240));
    if (!rootContext.mounted) return;
    router.push(location, extra: extra);
  }

  @override
  Widget build(BuildContext context) {
    if (auth.user?.isPlatform == true) {
      return AsyncListPage(
        eyebrow: 'Platform',
        title: 'Tüm kurumlar',
        subtitle: 'Abonelik, kullanıcı ve kurum durumları.',
        loader: () => api.get(
          '/api/platform/tenants/',
          query: {'page': 1, 'pageSize': 200},
        ),
        icon: Icons.apartment_rounded,
        titleKeys: const ['tenantName', 'name'],
        subtitleKeys: const ['ownerEmail', 'city', 'plan'],
        statusKeys: const ['status'],
      );
    }
    final me = auth.user;
    return CrudListScreen(
      // Web işlem izni paritesi: Customers.Manage / .Delete / .Tags
      canCreate: me?.canAction(Perm.customersManage) ?? true,
      canUpdate: me?.canAction(Perm.customersManage) ?? true,
      canDelete: me?.canAction(Perm.customersDelete) ?? true,
      eyebrow: 'İşletme',
      title: 'Müşteriler',
      subtitle: 'Müşteri kartları, iletişim ve KVKK durumu.',
      icon: Icons.person_rounded,
      loader: () =>
          api.getAllPaged('/api/admin/customers/'),
      titleKeys: const ['fullName', 'name'],
      subtitleKeys: const ['phone', 'email'],
      statusKeys: const ['isBlacklisted', 'kvkkConsent'],
      filters: [
        ListFilterOption('VIP', (item) => item['isVip'] == true),
        ListFilterOption('Kara liste', (item) => item['isBlacklisted'] == true),
      ],
      // Satıra dokununca web'deki gibi zengin müşteri detayını aç.
      onItemTap: (item) {
        final id = _cleanId(item['id']);
        if (id == null) return;
        context.push('/customer-detail', extra: {
          'customerId': id,
          'customer': item,
        });
      },
      createLabel: 'Yeni müşteri',
      fields: const [
        CrudField(key: 'fullName', label: 'Ad soyad', required: true),
        CrudField(
          key: 'phone',
          label: 'Telefon',
          required: true,
          hint: '05XXXXXXXXX',
          digitsOnly: true,
          maxLength: 11,
        ),
        CrudField(key: 'email', label: 'E-posta'),
        CrudField(
          key: 'birthDate',
          label: 'Doğum tarihi',
          type: CrudFieldType.date,
        ),
        CrudField(
          key: 'gender',
          label: 'Cinsiyet',
          type: CrudFieldType.select,
          options: _genders,
          defaultValue: 'Female',
        ),
        CrudField(
          key: 'kvkkConsent',
          label: 'KVKK onayı var',
          type: CrudFieldType.toggle,
          defaultValue: false,
        ),
        CrudField(key: 'notes', label: 'Notlar', type: CrudFieldType.multiline),
      ],
      formExtra: Builder(
        builder: (ctx) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.primary,
                minimumSize: const Size.fromHeight(44),
              ),
              onPressed: () => showKvkkViewSheet(ctx, api),
              icon: const Icon(Icons.description_rounded, size: 18),
              label: const Text('KVKK aydınlatma metnini görüntüle'),
            ),
            const Padding(
              padding: EdgeInsets.only(top: 4, left: 2),
              child: Text('Metni Ayarlar ekranından düzenleyebilirsiniz.',
                  style: TextStyle(fontSize: 11, color: AppColors.muted)),
            ),
          ],
        ),
      ),
      onCreate: (body) async {
        body['branchId'] = await _resolveBranchId();
        return api.post('/api/admin/customers/', body);
      },
      onUpdate: (item, body) async {
        body['branchId'] = await _resolveBranchId(item);
        await api.put('/api/admin/customers/${item['id']}', body);
      },
      onDelete: (item) => api.delete('/api/admin/customers/${item['id']}'),
      rowActions: [
        CrudRowAction(
          label: 'Müşteri Bilgi ve Onay Formu',
          icon: Icons.assignment_rounded,
          color: AppColors.primaryDark,
          run: (sheetContext, item) async {
            final customerId = '${item['id'] ?? ''}'.trim();
            if (customerId.isEmpty || customerId.toLowerCase() == 'null') {
              ScaffoldMessenger.of(sheetContext).showSnackBar(
                const SnackBar(
                  content: Text(
                    'Müşteri kaydı henüz hazır değil. Listeyi yenileyip tekrar deneyin.',
                  ),
                ),
              );
              return true;
            }
            await _pushAfterClosingSheet(
              context,
              sheetContext,
              '/consultation',
              {
                'customerId': customerId,
                'customerName': item['fullName'] ?? item['name'] ?? '',
              },
            );
            return false;
          },
        ),
        CrudRowAction(
          label: 'Tedavi Günlüğü',
          icon: Icons.photo_library_rounded,
          color: AppColors.primary,
          run: (sheetContext, item) async {
            await _pushAfterClosingSheet(
              context,
              sheetContext,
              '/treatment-journal',
              {
                'customerId': '${item['id']}',
                'customerName': item['fullName'] ?? item['name'] ?? '',
              },
            );
            return false;
          },
        ),
        // VIP & kara liste etiketi ayrı işlem izni ister (Customers.Tags).
        if (me?.canAction(Perm.customersTags) ?? true) ...[
          CrudRowAction(
            label: 'VIP durumu',
            icon: Icons.workspace_premium_rounded,
            color: const Color(0xFFB8860B),
            run: _vip,
          ),
          CrudRowAction(
            label: 'Kara liste durumu',
            icon: Icons.block_rounded,
            color: Colors.red,
            run: _blacklist,
          ),
        ],
      ],
    );
  }
}
