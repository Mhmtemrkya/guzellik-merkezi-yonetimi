import '../network/api_client.dart';
import 'notification_service.dart';

/// Yaklaşan randevular için cihazda YEREL zamanlanmış hatırlatma kurar.
/// Bir kez planlandıktan sonra internet OLMASA da, uygulama tamamen kapalı olsa da
/// (AlarmManager) tam saatinde tetiklenir → "internetsiz bildirim" gereksiniminin özü.
///
/// Her senkronda önce eski hatırlatmalar temizlenip güncel randevu kümesi yeniden planlanır
/// (iptal edilen/tarihi değişen randevular böylece düzelir).
class AppointmentReminderScheduler {
  AppointmentReminderScheduler(this.api);
  final ApiClient api;

  /// Hatırlatma bildirim id'leri bu tabanın üstünde yaşar; feed 'show' id'leriyle (< bu değer) çakışmaz.
  static const int _reminderIdBase = 0x40000000;

  /// Randevudan ne kadar önce hatırlatılsın (birden fazla → her biri ayrı bildirim).
  static const _leadMinutes = <int>[24 * 60, 60];

  Future<void> sync() async {
    try {
      final now = DateTime.now().toUtc();
      final to = now.add(const Duration(days: 7));
      final data = await api.get('/api/admin/appointments/', query: {
        'fromUtc': now.toIso8601String(),
        'toUtc': to.toIso8601String(),
        'page': 1,
        'pageSize': 200,
      });

      final items = _extractItems(data);

      // Önce mevcut tüm hatırlatmaları temizle (id tabanına göre), sonra güncel kümeyi planla.
      await _clearReminders();

      for (final raw in items) {
        if (raw is! Map) continue;
        final a = raw.cast<String, dynamic>();
        final status = _asInt(a['status']);
        // Yalnızca aktif (Scheduled=1 / Confirmed=2) randevular hatırlatılır.
        if (status != 1 && status != 2) continue;
        final start = DateTime.tryParse('${a['startUtc']}')?.toUtc();
        if (start == null || !start.isAfter(now)) continue;

        final id = '${a['id']}';
        final name = _str(a['customerName']) ?? 'Randevu';
        final service = _str(a['serviceName']);
        final localHm = _hm(start.add(const Duration(hours: 3))); // UTC+3 gösterim
        final subtitle = service == null || service.isEmpty ? localHm : '$service · $localHm';

        for (var i = 0; i < _leadMinutes.length; i++) {
          final when = start.subtract(Duration(minutes: _leadMinutes[i]));
          if (!when.isAfter(now)) continue; // hatırlatma anı geçmişse atla
          await NotificationService.instance.schedule(
            id: _reminderId(id, i),
            title: _leadMinutes[i] >= 720 ? 'Yarınki randevu' : 'Yaklaşan randevu',
            body: '$name · $subtitle',
            whenUtc: when,
            data: {'route': '/appointments', 'id': id, 'type': 4},
          );
        }
      }
      notifyLog('randevu hatırlatmaları planlandı (${items.length} randevu tarandı)');
    } catch (e) {
      notifyLog('randevu hatırlatma senkronu başarısız: $e');
    }
  }

  Future<void> _clearReminders() async {
    try {
      final pending = await NotificationService.instance.pending();
      for (final p in pending) {
        if (p.id >= _reminderIdBase) {
          await NotificationService.instance.cancel(p.id);
        }
      }
    } catch (_) {}
  }

  int _reminderId(String appointmentId, int leadIndex) {
    final base = appointmentId.hashCode & 0x0FFFFFFF;
    return _reminderIdBase | (leadIndex << 28) | base;
  }

  List _extractItems(dynamic data) {
    if (data is List) return data;
    if (data is Map) {
      final items = data['items'];
      if (items is List) return items;
    }
    return const [];
  }

  int _asInt(dynamic v) {
    if (v is int) return v;
    if (v is num) return v.toInt();
    return int.tryParse('$v') ?? -1;
  }

  String? _str(dynamic v) => v == null ? null : '$v';

  String _hm(DateTime dt) =>
      '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
}
