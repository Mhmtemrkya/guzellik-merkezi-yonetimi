import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../auth/auth_controller.dart';
import '../network/api_client.dart';
import 'appointment_reminder_scheduler.dart';
import 'fcm_service.dart';
import 'notification_service.dart';

/// Feed'deki tek bildirim (backend AppNotificationDto eşleniği). Enum alanları JSON'da integer.
class AppNotificationItem {
  const AppNotificationItem({
    required this.id,
    required this.type,
    required this.severity,
    required this.title,
    required this.body,
    required this.data,
    required this.isRead,
    required this.createdAtUtc,
  });

  final String id;
  final int type;
  final int severity;
  final String title;
  final String body;
  final Map<String, dynamic>? data;
  final bool isRead;
  final DateTime createdAtUtc;

  AppNotificationItem copyWith({bool? isRead}) => AppNotificationItem(
        id: id,
        type: type,
        severity: severity,
        title: title,
        body: body,
        data: data,
        isRead: isRead ?? this.isRead,
        createdAtUtc: createdAtUtc,
      );

  factory AppNotificationItem.fromJson(Map<String, dynamic> j) {
    Map<String, dynamic>? data;
    final rawData = j['dataJson'];
    if (rawData is String && rawData.isNotEmpty) {
      try {
        final decoded = jsonDecode(rawData);
        if (decoded is Map) data = decoded.cast<String, dynamic>();
      } catch (_) {}
    } else if (rawData is Map) {
      data = rawData.cast<String, dynamic>();
    }
    return AppNotificationItem(
      id: '${j['id']}',
      type: _asInt(j['type']),
      severity: _asInt(j['severity']),
      title: '${j['title'] ?? 'Bildirim'}',
      body: '${j['body'] ?? ''}',
      data: data,
      isRead: j['isRead'] == true,
      createdAtUtc: DateTime.tryParse('${j['createdAtUtc']}')?.toUtc() ??
          DateTime.now().toUtc(),
    );
  }

  static int _asInt(dynamic v) =>
      v is int ? v : (v is num ? v.toInt() : int.tryParse('$v') ?? 0);
}

/// Uygulama-içi bildirim merkezi: ön planda periyodik feed yoklaması yapar, YENİ sunucu
/// olaylarını yerel bildirime çevirir, okunmamış rozetini ve inbox listesini besler.
///
/// Arka plan (uygulama kapalıyken) yoklaması ayrı isolate'ta [background_poller] tarafından yürütülür;
/// bu sınıf uygulama önplandayken devreye girer ve resume'da rozeti tazeler.
class NotificationCenter extends ChangeNotifier {
  NotificationCenter({required this.api, required this.auth});

  final ApiClient api;
  final AuthController auth;

  static const _pollInterval = Duration(seconds: 25);

  Timer? _timer;
  bool _started = false;
  bool _polling = false;

  /// Bu andan SONRA oluşan feed öğeleri yerel bildirime çevrilir (açılışta var olanlar tekrar bildirilmez).
  DateTime _notifyWatermarkUtc = DateTime.now().toUtc();

  List<AppNotificationItem> items = const [];
  int unreadCount = 0;

  /// Bildirime dokunulunca (ön planda ya da soğuk başlangıç) yönlendirme için app.dart bağlar.
  void Function(Map<String, dynamic> data)? onNavigate;

  Future<void> start() async {
    if (_started) return;
    _started = true;

    await NotificationService.instance.init();
    await NotificationService.instance.requestPermissions();
    NotificationService.instance.onTap = _handleTap;

    // Soğuk başlangıç: bildirimle açıldıysa yönlendir.
    final launch = NotificationService.instance.launchPayload;
    if (launch != null) {
      NotificationService.instance.launchPayload = null;
      _handleTap(launch);
    }

    // FCM (opsiyonel): Firebase kuruluysa token'ı backend'e kaydeder; değilse sessizce atlar.
    unawaited(FcmService.instance.register(api));

    _notifyWatermarkUtc = DateTime.now().toUtc();
    await refresh(); // ilk yükleme: rozet + liste (yerel bildirim üretmeden)
    _timer = Timer.periodic(_pollInterval, (_) => poll());

    // Yaklaşan randevu yerel hatırlatmalarını planla (offline çalışır).
    unawaited(AppointmentReminderScheduler(api).sync());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
    _started = false;
    items = const [];
    unreadCount = 0;
    unawaited(FcmService.instance.unregister(api)); // çıkışta bu cihaza push gelmesin
    notifyListeners();
  }

  /// Uygulama ön plana döndüğünde çağrılır: rozeti/inbox'ı hemen tazele + hatırlatmaları güncelle.
  Future<void> onResume() async {
    if (!_started) return;
    await poll();
    unawaited(AppointmentReminderScheduler(api).sync());
  }

  /// Yoklama: yeni öğeleri yerel bildirime çevirir.
  Future<void> poll() async {
    await _load(raiseLocal: true);
  }

  /// Tam yenileme (inbox açılışı/pull-to-refresh): yerel bildirim üretmez.
  Future<void> refresh() async {
    await _load(raiseLocal: false);
  }

  Future<void> _load({required bool raiseLocal}) async {
    if (_polling) return;
    if (auth.status != AuthStatus.signedIn) return;
    _polling = true;
    try {
      final data = await api.get('/api/notifications/feed', query: {'take': 30});
      if (data is! Map) return;
      final list = ((data['items'] as List?) ?? const [])
          .whereType<Map>()
          .map((e) => AppNotificationItem.fromJson(e.cast<String, dynamic>()))
          .toList();
      unreadCount = (data['unreadCount'] as num?)?.toInt() ?? 0;

      if (raiseLocal) {
        final fresh = list
            .where((n) => !n.isRead && n.createdAtUtc.isAfter(_notifyWatermarkUtc))
            .toList()
          ..sort((a, b) => a.createdAtUtc.compareTo(b.createdAtUtc));
        for (final n in fresh) {
          await NotificationService.instance.show(
            id: n.id.hashCode & 0x3FFFFFFF,
            channelId: channelForType(n.type),
            title: n.title,
            body: n.body,
            data: {...?n.data, 'id': n.id, 'type': n.type},
          );
        }
        if (list.isNotEmpty) {
          final newest = list
              .map((e) => e.createdAtUtc)
              .reduce((a, b) => a.isAfter(b) ? a : b);
          if (newest.isAfter(_notifyWatermarkUtc)) _notifyWatermarkUtc = newest;
        }
      }

      items = list;
      notifyListeners();
    } catch (_) {
      // Ağ/oturum hatası — sessiz geç; bir sonraki yoklamada tekrar denenir.
    } finally {
      _polling = false;
    }
  }

  Future<void> markRead(String id) async {
    items = items
        .map((n) => n.id == id ? n.copyWith(isRead: true) : n)
        .toList();
    unreadCount = items.where((n) => !n.isRead).length;
    notifyListeners();
    try {
      await api.post('/api/notifications/$id/read');
    } catch (_) {}
  }

  Future<void> markAllRead() async {
    items = items.map((n) => n.copyWith(isRead: true)).toList();
    unreadCount = 0;
    notifyListeners();
    try {
      await api.post('/api/notifications/read-all');
    } catch (_) {}
  }

  void _handleTap(Map<String, dynamic> data) {
    final id = data['id'];
    if (id is String && id.isNotEmpty) unawaited(markRead(id));
    onNavigate?.call(data);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}
