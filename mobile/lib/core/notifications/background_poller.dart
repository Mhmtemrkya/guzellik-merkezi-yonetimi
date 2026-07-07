import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'notification_service.dart';

/// Uygulama ARKA PLANDA / KAPALIYKEN çalışan LAN yoklayıcısı (ön plan servisi, ayrı isolate).
/// Kendi sunucunuzu (aynı ağ/LAN — internet gerektirmez) periyodik yoklar; yeni sunucu olaylarını
/// yerel bildirime çevirir. Böylece FCM/Firebase olmadan da "uygulama kapalıyken bildirim" sağlanır.
///
/// Çakışmayı önlemek için: uygulama ÖN PLANDAYKEN [stopBackgroundPolling] (in-app timer devrede),
/// ARKA PLANA geçince [startBackgroundPolling]. Ön plan servisi süreç öldürülse de bir süre yaşar.
class BackgroundPoller {
  BackgroundPoller._();

  static const _serviceChannelId = 'beautyasist_service';
  static const _serviceNotificationId = 8891;
  static const _pollInterval = Duration(seconds: 30);

  static Future<void> configure() async {
    // Ön plan servisinin kalıcı bildirimi için düşük önemli kanal (rahatsız etmesin).
    final fln = FlutterLocalNotificationsPlugin();
    final android = fln.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    await android?.createNotificationChannel(const AndroidNotificationChannel(
      _serviceChannelId,
      'Arka plan bildirim servisi',
      description: 'Uygulama kapalıyken bildirimleri getirir',
      importance: Importance.low,
    ));

    final service = FlutterBackgroundService();
    await service.configure(
      androidConfiguration: AndroidConfiguration(
        onStart: _onStart,
        autoStart: false,
        isForegroundMode: true,
        notificationChannelId: _serviceChannelId,
        initialNotificationTitle: 'BeautyAsist',
        initialNotificationContent: 'Bildirimler dinleniyor',
        foregroundServiceNotificationId: _serviceNotificationId,
        foregroundServiceTypes: const [AndroidForegroundType.dataSync],
      ),
      iosConfiguration: IosConfiguration(
        autoStart: false,
        onForeground: _onStart,
        onBackground: _onIosBackground,
      ),
    );
  }

  static Future<void> start() async {
    try {
      final service = FlutterBackgroundService();
      if (!await service.isRunning()) await service.startService();
    } catch (_) {}
  }

  static Future<void> stop() async {
    try {
      FlutterBackgroundService().invoke('stopService');
    } catch (_) {}
  }
}

@pragma('vm:entry-point')
Future<bool> _onIosBackground(ServiceInstance service) async {
  DartPluginRegistrant.ensureInitialized();
  await _pollOnce();
  return true;
}

@pragma('vm:entry-point')
void _onStart(ServiceInstance service) async {
  DartPluginRegistrant.ensureInitialized();

  service.on('stopService').listen((_) => service.stopSelf());

  await NotificationService.instance.init();

  // İlk yoklama anını taban al; öncekiler tekrar bildirilmesin.
  var watermark = DateTime.now().toUtc();

  Future<void> tick() async {
    final newest = await _pollOnce(sinceUtc: watermark);
    if (newest != null && newest.isAfter(watermark)) watermark = newest;
  }

  await tick();
  Timer.periodic(BackgroundPoller._pollInterval, (_) => tick());
}

/// Tek yoklama: oturum token'ıyla LAN feed'i çeker, since'den sonra oluşan öğeleri bildirir.
/// En yeni öğe zamanını döndürür (watermark güncellemesi için).
@pragma('vm:entry-point')
Future<DateTime?> _pollOnce({DateTime? sinceUtc}) async {
  try {
    const storage = FlutterSecureStorage();
    final raw = await storage.read(key: 'beautyasist.session');
    if (raw == null || raw.isEmpty) return null;

    final session = jsonDecode(raw) as Map<String, dynamic>;
    final token = session['accessToken'] as String?;
    if (token == null || token.isEmpty) return null;
    final user = (session['user'] as Map?)?.cast<String, dynamic>() ?? const {};
    final tenantId = user['tenantId']?.toString();
    final branchId = user['branchId']?.toString();

    final dio = Dio(BaseOptions(
      baseUrl: _baseUrl,
      connectTimeout: const Duration(seconds: 12),
      receiveTimeout: const Duration(seconds: 15),
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer $token',
        'X-Tenant-Id': ?tenantId,
        'X-Branch-Id': ?branchId,
      },
    ));

    final resp = await dio.get('/api/notifications/feed', queryParameters: {
      if (sinceUtc != null) 'since': sinceUtc.toIso8601String(),
      'take': 20,
    });

    final payload = resp.data;
    final data = payload is Map && payload['data'] is Map
        ? (payload['data'] as Map)
        : (payload is Map ? payload : const {});
    final items = (data['items'] as List?) ?? const [];
    if (items.isEmpty) return null;

    DateTime? newest;
    for (final raw in items) {
      if (raw is! Map) continue;
      final j = raw.cast<String, dynamic>();
      if (j['isRead'] == true) continue;
      final created = DateTime.tryParse('${j['createdAtUtc']}')?.toUtc();
      if (created == null) continue;
      if (sinceUtc != null && !created.isAfter(sinceUtc)) continue;
      if (newest == null || created.isAfter(newest)) newest = created;

      final id = '${j['id']}';
      final type = _asInt(j['type']);
      Map<String, dynamic>? extra;
      final dj = j['dataJson'];
      if (dj is String && dj.isNotEmpty) {
        try {
          final d = jsonDecode(dj);
          if (d is Map) extra = d.cast<String, dynamic>();
        } catch (_) {}
      }
      await NotificationService.instance.show(
        id: id.hashCode & 0x3FFFFFFF,
        channelId: channelForType(type),
        title: '${j['title'] ?? 'Bildirim'}',
        body: '${j['body'] ?? ''}',
        data: {...?extra, 'id': id, 'type': type},
      );
    }
    return newest;
  } catch (_) {
    return null;
  }
}

int _asInt(dynamic v) =>
    v is int ? v : (v is num ? v.toInt() : int.tryParse('$v') ?? 0);

/// ApiClient ile aynı taban URL mantığı (derleme zamanı override + platform varsayılanı).
String get _baseUrl {
  const configured = String.fromEnvironment('API_BASE_URL');
  if (configured.isNotEmpty) return configured;
  // Release (mağaza) derlemeleri üretim API'sine gider; debug/profile yerelde kalır.
  if (kReleaseMode) return 'https://api.courseintellect.xyz';
  return Platform.isAndroid ? 'http://10.0.2.2:5019' : 'http://127.0.0.1:5019';
}
