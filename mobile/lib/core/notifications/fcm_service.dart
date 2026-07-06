import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import '../network/api_client.dart';
import '../network/device_identity.dart';
import 'notification_service.dart';

/// OPSİYONEL uzaktan push (FCM). "Katmanlı" mimarinin 3. katmanı: uygulama tamamen öldürülse
/// ve cihaz mobil internetteyken bile sunucu-tetiklemeli push. Yerel+LAN katmanlarının üstüne biner.
///
/// GUARD: Firebase yapılandırması (google-services.json + backend service-account) YOKSA
/// [tryInit] false döner ve tüm FCM adımları atlanır — uygulama yerel bildirim + LAN yoklamayla
/// sorunsuz çalışmaya devam eder. Firebase kurulunca hiçbir kod değişikliği olmadan aktifleşir.
class FcmService {
  FcmService._();
  static final FcmService instance = FcmService._();

  bool _available = false;
  bool get available => _available;

  /// Firebase'i güvenle başlatır. Yapılandırma yoksa initializeApp patlar → yakalanır, FCM kapalı kalır.
  Future<bool> tryInit() async {
    if (_available) return true;
    try {
      await Firebase.initializeApp();
      _available = true;
      return true;
    } catch (e) {
      _available = false;
      notifyLog('FCM devre dışı (Firebase yapılandırılmamış): $e');
      return false;
    }
  }

  /// İzin al + token'ı backend'e kaydet + gelen mesaj dinleyicilerini kur.
  Future<void> register(ApiClient api) async {
    if (!_available) return;
    try {
      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission();

      final token = await messaging.getToken();
      if (token != null && token.isNotEmpty) await _sendToken(api, token);
      messaging.onTokenRefresh.listen((t) => _sendToken(api, t));

      // Uygulama ÖN PLANDAYKEN gelen push'u yerel bildirime çevir (aksi halde görünmez).
      FirebaseMessaging.onMessage.listen(_showFromMessage);
    } catch (e) {
      notifyLog('FCM register hatası: $e');
    }
  }

  Future<void> unregister(ApiClient api) async {
    if (!_available) return;
    try {
      await api.delete('/api/notifications/device-token/${await DeviceIdentity.id()}');
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {}
  }

  Future<void> _sendToken(ApiClient api, String token) async {
    try {
      await api.post('/api/notifications/device-token', {
        'deviceId': await DeviceIdentity.id(),
        'token': token,
        'platform': 'android',
      });
      notifyLog('FCM token backend\'e kaydedildi');
    } catch (_) {}
  }

  void _showFromMessage(RemoteMessage message) {
    final n = message.notification;
    final data = message.data;
    final type = int.tryParse('${data['type']}') ?? 0;
    NotificationService.instance.show(
      id: DateTime.now().millisecondsSinceEpoch & 0x3FFFFFFF,
      channelId: channelForType(type),
      title: n?.title ?? '${data['title'] ?? 'Bildirim'}',
      body: n?.body ?? '${data['body'] ?? ''}',
      data: data,
    );
  }
}

/// Arka plan / uygulama kapalıyken gelen DATA-only FCM mesajı (top-level, ayrı isolate).
/// notification+data taşıyan mesajları Android otomatik gösterir; bu handler data-only için.
@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage message) async {
  try {
    await Firebase.initializeApp();
    await NotificationService.instance.init();
    final n = message.notification;
    if (n != null) return; // OS zaten gösterir
    final data = message.data;
    await NotificationService.instance.show(
      id: DateTime.now().millisecondsSinceEpoch & 0x3FFFFFFF,
      channelId: channelForType(int.tryParse('${data['type']}') ?? 0),
      title: '${data['title'] ?? 'Bildirim'}',
      body: '${data['body'] ?? ''}',
      data: data,
    );
  } catch (_) {}
}
