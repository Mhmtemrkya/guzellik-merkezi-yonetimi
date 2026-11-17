import 'package:flutter/material.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/auth/permissions.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/widgets/async_list_page.dart';
import 'message_kit.dart';
import 'notification_summary_panel.dart';
import 'send_message_sheet.dart';
import 'template_composer_sheet.dart';

/// Hazır yaşam döngüsü otomasyonları — web `TemplatePresetGallery` ile aynı içerik; metinler
/// [suggestedTexts]'ten gelir (kısa ve emojisiz — SMS parça başına ücretlenir).
const _automationPresets = <(String title, String trigger, String hint)>[
  ('Randevu Hatırlatma', 'AppointmentReminder', 'Randevudan 24 saat önce otomatik'),
  ('Doğum Günü Kutlaması', 'BirthdayGreeting', 'Doğum gününde otomatik (yılda 1)'),
  ('Ödeme Hatırlatma', 'PaymentDue', 'Vadesi gelen taksiti olana (günde en çok 1)'),
  ('Sizi Özledik', 'WinBack', 'Uzun süredir gelmeyene (ayda en çok 1)'),
  ('Paket Yenileme', 'SessionRenewal', 'Paketi bitmek üzere olana (ayda en çok 1)'),
];

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({required this.api, required this.auth, super.key});
  final ApiClient api;
  final AuthController auth;

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  /// Liste özel sayfalardan (oluşturucu/gönderim) sonra yenilensin diye anahtar artırılır.
  int _version = 0;

  ApiClient get api => widget.api;
  void _reload() => setState(() => _version++);

  String get _salonName => '';

  Future<void> _openComposer({Map<String, dynamic>? template, String? trigger, String? channel}) async {
    final me = widget.auth.user;
    final changed = await showTemplateComposerSheet(
      context,
      api: api,
      template: template,
      initialTrigger: trigger,
      initialChannel: channel,
      salonName: _salonName,
      canDelete: me?.canAction(Perm.notificationsTemplates) ?? true,
      onSend: (t) => _openSend(templateId: '${t['id']}'),
    );
    if (changed) _reload();
  }

  Future<void> _openSend({String? templateId}) async {
    final sent = await showSendMessageSheet(
      context,
      api: api,
      initialTemplateId: templateId,
      salonName: _salonName,
      onCreateTemplate: () => _openComposer(),
    );
    if (sent) _reload();
  }

  /// Hazır otomasyonlar — kanal seçilir (SMS öncelikli), tek dokunuşla AKTİF eklenir ya da
  /// oluşturucuda düzenlenerek eklenir.
  Future<void> _openPresets() async {
    var channel = 'Sms';
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (sheetCtx) => StatefulBuilder(
        builder: (sheetCtx, setSheet) => SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Hazır otomasyonlar', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              const Text(
                'Tek dokunuşla eklenir ve AKTİF başlar — otomatik tarama (15 dk) göndermeye başlar.',
                style: TextStyle(fontSize: 11.5, color: AppColors.muted),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                children: [
                  for (final c in const ['Sms', 'WhatsApp'])
                    ChoiceChip(
                      label: Text(channelTitle(c)),
                      selected: channel == c,
                      onSelected: (_) => setSheet(() => channel = c),
                    ),
                ],
              ),
              if (channel == 'WhatsApp')
                Container(
                  margin: const EdgeInsets.only(top: 8),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEF6E7),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFF3D9A0)),
                  ),
                  child: const Text(
                    "WhatsApp'ta serbest metin yalnız son 24 saatte size yazmış müşteriye iletilir (Meta kuralı). "
                    'Randevu hatırlatması dışındaki otomatik mesajlar için SMS önerilir.',
                    style: TextStyle(fontSize: 11.5, height: 1.35),
                  ),
                ),
              const SizedBox(height: 12),
              for (final p in _automationPresets)
                Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    title: Text(p.$1, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
                    subtitle: Text(
                      usesWhatsAppReminderFlow(channel, p.$2)
                          ? 'İki yönlü onaylı WhatsApp hatırlatması (Evet / Hayır / Ertele).'
                          : '${p.$3}\n${suggestedTexts[p.$2]?.first ?? ''}',
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 11),
                    ),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        IconButton(
                          tooltip: 'Düzenleyerek ekle',
                          icon: const Icon(Icons.edit_rounded, size: 20),
                          onPressed: () {
                            Navigator.pop(sheetCtx);
                            _openComposer(trigger: p.$2, channel: channel);
                          },
                        ),
                        IconButton(
                          tooltip: 'Ekle',
                          icon: const Icon(Icons.add_circle_rounded, color: AppColors.primary),
                          onPressed: () async {
                            try {
                              final res = await api.post('/api/admin/notification-templates/', {
                                'name': '${p.$1} · ${channelTitle(channel)}',
                                'channel': channel,
                                'trigger': p.$2,
                                'body': suggestedTexts[p.$2]?.first ?? '',
                                'status': 'Active',
                                'branchId': api.auth?.user?.branchId,
                              });
                              if (!sheetCtx.mounted) return;
                              Navigator.pop(sheetCtx);
                              final pending = res is Map && res['pendingApproval'] == true;
                              if (mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                                  content: Text(pending
                                      ? '"${p.$1}" onaya gönderildi.'
                                      : '"${p.$1}" (${channelTitle(channel)}) eklendi ve aktifleştirildi.'),
                                ));
                              }
                              _reload();
                            } catch (e) {
                              if (sheetCtx.mounted) {
                                ScaffoldMessenger.of(sheetCtx).showSnackBar(SnackBar(content: Text('$e')));
                              }
                            }
                          },
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = widget.auth;
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
    // Şablon oluşturma/düzenleme/gönderme ayrı işlem izni (Notifications.Templates) — sunucu
    // aynı izni /notification-templates altındaki tüm yazma uçlarında arar.
    final canTemplates = me?.canAction(Perm.notificationsTemplates) ?? true;
    return CrudListScreen(
      key: ValueKey(_version),
      // Oluşturma/düzenleme genel form yerine şablon oluşturucuyla yapılır.
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      eyebrow: 'İletişim',
      title: 'Bildirimler',
      subtitle: 'SMS, WhatsApp ve e-posta şablonları — gönder, otomatikleştir.',
      icon: Icons.notifications_active_rounded,
      guideKey: 'notifications',
      guideUid: me?.email,
      loader: () => api.get(
        '/api/admin/notification-templates/',
        query: {'page': 1, 'pageSize': 200},
      ),
      titleKeys: const ['name', 'title'],
      subtitleKeys: const ['body'],
      statusKeys: const ['status'],
      statusLabel: (item) =>
          '${channelTitle('${item['channel']}')} · ${'${item['status']}' == 'Active' ? 'Aktif' : '${item['status']}' == 'PendingApproval' ? 'Onayda' : 'Taslak'}',
      onItemTap: canTemplates ? (item) => _openComposer(template: item) : null,
      headerExtra: Builder(
        builder: (ctx) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ÖZET + OTOMASYON DURUMU (web StatCard'lar + AutomationStatusPanel).
            NotificationSummaryPanel(api: api),
            const SizedBox(height: 12),
            if (canTemplates)
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      style: FilledButton.styleFrom(backgroundColor: AppColors.primaryDark, minimumSize: const Size(0, 46)),
                      onPressed: () => _openSend(),
                      icon: const Icon(Icons.send_rounded, size: 18),
                      label: const Text('Mesaj gönder', overflow: TextOverflow.ellipsis),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(minimumSize: const Size(0, 46)),
                      onPressed: () => _openComposer(),
                      icon: const Icon(Icons.add_rounded, size: 18),
                      label: const Text('Şablon oluştur', overflow: TextOverflow.ellipsis),
                    ),
                  ),
                ],
              ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (canTemplates)
                  OutlinedButton.icon(
                    onPressed: _openPresets,
                    icon: const Icon(Icons.auto_awesome_rounded),
                    label: const Text('Hazır otomasyonlar'),
                  ),
                OutlinedButton.icon(
                  onPressed: () async {
                    try {
                      final res = await api.post('/api/admin/notification-templates/payment-reminders/run');
                      if (ctx.mounted) {
                        final sent = res is num ? res : (res is Map ? res['sent'] : null);
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
              ],
            ),
          ],
        ),
      ),
    );
  }
}
