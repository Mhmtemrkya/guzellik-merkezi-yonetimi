import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';

/// Bildirim özeti + otomasyon durumu — web'deki StatCard'lar ve `AutomationStatusPanel`.
///
/// Mobilde yalnız şablon listesi vardı: kaç şablon aktif, bugün ne gönderildi, kuyrukta/başarısız
/// kaç mesaj var ve hangi otomasyonun açık olduğu görünmüyordu. Bu panel o boşluğu kapatır.
class NotificationSummaryPanel extends StatefulWidget {
  const NotificationSummaryPanel({required this.api, super.key});
  final ApiClient api;

  @override
  State<NotificationSummaryPanel> createState() => _NotificationSummaryPanelState();
}

/// Otomatik gönderim tetikleyicileri — web AUTO_TRIGGERS ile birebir.
const _autoTriggers = <(String key, String label, String desc, IconData icon)>[
  ('AppointmentReminder', 'Randevu hatırlatma', 'Randevudan 24 saat önce', Icons.event_available_rounded),
  ('BirthdayGreeting', 'Doğum günü', 'Müşterinin doğum gününde', Icons.cake_rounded),
  ('PaymentDue', 'Ödeme hatırlatma', 'Vadesi geçen taksitlerde', Icons.credit_card_rounded),
];

class _NotificationSummaryPanelState extends State<NotificationSummaryPanel> {
  late Future<_SummaryData> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_SummaryData> _load() async {
    final results = await Future.wait([
      widget.api
          .get('/api/admin/notifications/summary')
          .catchError((_) => const <String, dynamic>{}),
      widget.api
          .get('/api/admin/notification-templates/', query: {'page': 1, 'pageSize': 200})
          .catchError((_) => const <dynamic>[]),
    ]);
    return _SummaryData(
      summary: results[0] is Map ? (results[0] as Map).cast<String, dynamic>() : const {},
      templates: apiItems(results[1]),
    );
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<_SummaryData>(
      future: _future,
      builder: (context, snapshot) {
        // Yüklenirken/başarısızsa panel gizlenir — şablon listesi yine de görünür.
        if (!snapshot.hasData) return const SizedBox.shrink();
        final data = snapshot.data!;
        final s = data.summary;

        final total = numberOf(s, const ['totalTemplates']).toInt();
        final active = numberOf(s, const ['activeTemplates']).toInt();
        final sent = numberOf(s, const ['todaySent']).toInt();
        final queued = numberOf(s, const ['todayQueued']).toInt();
        final failed = numberOf(s, const ['todayFailed']).toInt();

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _stat('Aktif şablon', '$active', '$total toplam', AppColors.primaryDark),
                const SizedBox(width: 8),
                _stat('Bugün giden', '$sent', null, AppColors.success),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                _stat('Kuyrukta', '$queued', null, AppColors.warning),
                const SizedBox(width: 8),
                _stat('Başarısız', '$failed',
                    failed > 0 ? 'tekrar önerilir' : 'sorun yok',
                    failed > 0 ? AppColors.danger : AppColors.muted),
              ],
            ),
            const SizedBox(height: 14),

            const Text('Otomatik gönderim',
                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
            const SizedBox(height: 2),
            const Text(
              'Tetikleyiciye AKTİF şablon eklendiğinde sistem arka planda (~15 dk) otomatik gönderir.',
              style: TextStyle(fontSize: 11, color: AppColors.muted),
            ),
            const SizedBox(height: 8),
            for (final t in _autoTriggers) _triggerCard(t, data.templates),
          ],
        );
      },
    );
  }

  Widget _stat(String label, String value, String? sub, Color tone) => Expanded(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(value,
                  style: TextStyle(
                      fontWeight: FontWeight.w900, fontSize: 18, color: tone)),
              Text(label,
                  style: const TextStyle(fontSize: 11, color: AppColors.muted)),
              if (sub != null)
                Text(sub,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 9.5, color: AppColors.muted)),
            ],
          ),
        ),
      );

  /// Bir tetikleyicinin "açık" olması = o tetikleyiciye ait en az bir AKTİF şablon olması.
  Widget _triggerCard(
    (String, String, String, IconData) trigger,
    List<Map<String, dynamic>> templates,
  ) {
    final (key, label, desc, icon) = trigger;
    final active = templates
        .where((t) => '${t['trigger']}' == key && '${t['status']}' == 'Active')
        .toList();
    final isOn = active.isNotEmpty;
    final channels = active.map((t) => '${t['channel']}').toSet().join(', ');

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isOn ? AppColors.success.withValues(alpha: .06) : AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
            color: isOn ? AppColors.success.withValues(alpha: .35) : AppColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: (isOn ? AppColors.success : AppColors.primary).withValues(alpha: .12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon,
                size: 17, color: isOn ? AppColors.success : AppColors.primaryDark),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                Text(
                  isOn ? '${active.length} aktif şablon · $channels' : desc,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 10.5, color: AppColors.muted),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: (isOn ? AppColors.success : AppColors.muted).withValues(alpha: .12),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              isOn ? 'Açık' : 'Kapalı',
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w800,
                color: isOn ? AppColors.success : AppColors.muted,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SummaryData {
  const _SummaryData({required this.summary, required this.templates});
  final Map<String, dynamic> summary;
  final List<Map<String, dynamic>> templates;
}
