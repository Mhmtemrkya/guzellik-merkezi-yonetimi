import 'package:flutter/material.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/auth/permissions.dart';
import '../../core/network/api_client.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/widgets/async_list_page.dart';

const _channels = [
  CrudOption('Sms', 'SMS'),
  CrudOption('WhatsApp', 'WhatsApp'),
  CrudOption('Email', 'E-posta'),
];

const _triggers = [
  CrudOption('Manual', 'Manuel'),
  CrudOption('AppointmentReminder', 'Randevu Hatırlatma'),
  CrudOption('BirthdayGreeting', 'Doğum Günü'),
  CrudOption('PaymentDue', 'Ödeme Hatırlatma'),
  CrudOption('Campaign', 'Kampanya'),
  CrudOption('WinBack', 'Geri Kazanım'),
];

const _templateStatuses = [
  CrudOption('Active', 'Aktif'),
  CrudOption('Draft', 'Taslak'),
  CrudOption('PendingApproval', 'Onay Bekliyor'),
];

const _audiences = [
  CrudOption('all', 'Tüm müşteriler'),
  CrudOption('active90', 'Son 90 günde aktif'),
  CrudOption('birthdayWeek', 'Bu hafta doğum günü'),
  CrudOption('inactive30', '30+ gün pasif'),
];

class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({required this.api, required this.auth, super.key});
  final ApiClient api;
  final AuthController auth;

  Future<bool> _send(BuildContext context, Map<String, dynamic> item) async {
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => const CrudFormSheet(
        title: 'Bildirim gönder',
        icon: Icons.send_rounded,
        fields: [
          CrudField(
            key: 'audience',
            label: 'Hedef kitle',
            type: CrudFieldType.select,
            options: _audiences,
            defaultValue: 'all',
          ),
        ],
      ),
    );
    if (result?.body == null) return false;
    final payload = {'templateId': item['id'], ...result!.body!};
    final res = await api.post('/api/admin/notification-templates/send', payload);
    if (context.mounted) {
      final sent = res is Map ? res['sent'] : null;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Gönderildi: ${sent ?? '?'} mesaj.')),
      );
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    if (auth.user?.isPlatform == true) {
      return AsyncListPage(
        eyebrow: 'Sistem',
        title: 'Sağlık uyarıları',
        subtitle: 'Platform servis ve kullanım görünümü.',
        loader: () async => [await api.get('/health/ready')],
        icon: Icons.monitor_heart_rounded,
        titleKeys: const ['status'],
        subtitleKeys: const ['message', 'database'],
        statusKeys: const ['status'],
      );
    }
    final me = auth.user;
    return CrudListScreen(
      // Şablon oluşturma/düzenleme ayrı işlem izni (Notifications.Templates).
      canCreate: me?.canAction(Perm.notificationsTemplates) ?? true,
      canUpdate: me?.canAction(Perm.notificationsTemplates) ?? true,
      canDelete: me?.canAction(Perm.notificationsTemplates) ?? true,
      eyebrow: 'İletişim',
      title: 'Bildirimler',
      subtitle: 'SMS, WhatsApp ve e-posta şablonları.',
      icon: Icons.notifications_active_rounded,
      loader: () => api.get(
        '/api/admin/notification-templates/',
        query: {'page': 1, 'pageSize': 200},
      ),
      titleKeys: const ['name', 'title'],
      subtitleKeys: const ['channel', 'trigger', 'body'],
      statusKeys: const ['status', 'channel'],
      createLabel: 'Yeni şablon',
      headerExtra: Builder(
        builder: (ctx) => Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            onPressed: () async {
              try {
                final res = await api.post('/api/admin/notification-templates/payment-reminders/run');
                if (ctx.mounted) {
                  final sent = res is Map ? res['sent'] : null;
                  ScaffoldMessenger.of(ctx).showSnackBar(
                    SnackBar(content: Text('Ödeme hatırlatmaları gönderildi: ${sent ?? '?'} mesaj.')),
                  );
                }
              } catch (e) {
                if (ctx.mounted) {
                  ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text('$e')));
                }
              }
            },
            icon: const Icon(Icons.payments_rounded),
            label: const Text('Ödeme hatırlatmalarını çalıştır'),
          ),
        ),
      ),
      fields: const [
        CrudField(key: 'name', label: 'Şablon adı', required: true),
        CrudField(
          key: 'channel',
          label: 'Kanal',
          type: CrudFieldType.select,
          options: _channels,
          defaultValue: 'Sms',
        ),
        CrudField(
          key: 'trigger',
          label: 'Tetikleyici',
          type: CrudFieldType.select,
          options: _triggers,
          defaultValue: 'Manual',
        ),
        CrudField(
          key: 'body',
          label: 'Mesaj içeriği',
          type: CrudFieldType.multiline,
          required: true,
        ),
        CrudField(
          key: 'status',
          label: 'Durum',
          type: CrudFieldType.select,
          options: _templateStatuses,
          defaultValue: 'Active',
        ),
      ],
      onCreate: (body) => api.post('/api/admin/notification-templates/', body),
      onUpdate: (item, body) =>
          api.put('/api/admin/notification-templates/${item['id']}', body),
      onDelete: (item) =>
          api.delete('/api/admin/notification-templates/${item['id']}'),
      decorateCreate: (body) => body['branchId'] = api.auth?.user?.branchId,
      decorateUpdate: (body, item) => body['branchId'] = item['branchId'],
      rowActions: [
        CrudRowAction(
          label: 'Şimdi gönder',
          icon: Icons.send_rounded,
          run: _send,
        ),
      ],
    );
  }
}
