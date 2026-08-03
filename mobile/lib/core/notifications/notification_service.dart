import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

/// Yerel + zamanlanmış bildirim çekirdeği (flutter_local_notifications sarmalayıcısı).
///
/// - Anlık bildirim (feed/push olayları) → [show].
/// - Zamanlanmış bildirim (yaklaşan randevu hatırlatması) → [schedule]; internet OLMADAN,
///   uygulama tamamen kapalıyken bile AlarmManager ile tam saatinde tetiklenir.
///
/// Singleton; hem ön plan (UI isolate) hem arka plan (flutter_background_service isolate) tarafından
/// [init] çağrılarak kullanılabilir. Kanallar önem düzeyine göre ayrıştırılmıştır.
class NotificationService {
  NotificationService._();
  static final NotificationService instance = NotificationService._();

  final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();
  bool _inited = false;

  /// Bildirime dokununca tetiklenir (payload'daki data ile). app.dart yönlendirmeyi bağlar.
  void Function(Map<String, dynamic> data)? onTap;

  /// Uygulama kapalıyken bildirime dokunularak açıldıysa buradan okunur (soğuk başlangıç deep-link).
  Map<String, dynamic>? launchPayload;

  Future<void> init() async {
    if (_inited) return;

    tzdata.initializeTimeZones();
    // Salon Türkiye'de; yerel zaman dilimini sabitliyoruz (flutter_timezone bağımlılığına gerek yok).
    try {
      tz.setLocalLocation(tz.getLocation('Europe/Istanbul'));
    } catch (_) {}

    const android = AndroidInitializationSettings('@mipmap/ic_launcher');
    const ios = DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
    );

    await _plugin.initialize(
      const InitializationSettings(android: android, iOS: ios),
      onDidReceiveNotificationResponse: _onResponse,
      onDidReceiveBackgroundNotificationResponse: notificationTapBackground,
    );

    await _createChannels();

    // Soğuk başlangıç: bildirimle açıldıysa payload'ı sakla (app.dart açılışta işler).
    final launch = await _plugin.getNotificationAppLaunchDetails();
    if (launch?.didNotificationLaunchApp == true) {
      final p = launch!.notificationResponse?.payload;
      if (p != null && p.isNotEmpty) {
        try {
          launchPayload = jsonDecode(p) as Map<String, dynamic>;
        } catch (_) {}
      }
    }

    _inited = true;
  }

  void _onResponse(NotificationResponse response) {
    final payload = response.payload;
    if (payload == null || payload.isEmpty) return;
    try {
      onTap?.call(jsonDecode(payload) as Map<String, dynamic>);
    } catch (_) {}
  }

  Future<void> _createChannels() async {
    final android = _plugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    if (android == null) return;
    for (final c in NotificationChannels.all) {
      await android.createNotificationChannel(AndroidNotificationChannel(
        c.id,
        c.name,
        description: c.description,
        importance: Importance.high,
      ));
    }
  }

  /// Bildirimler ŞU AN açık mı? (sistem ayarındaki gerçek durum)
  ///
  /// Kullanıcı izni sonradan sistem ayarlarından kapatabilir; uygulama içi bir bayrak
  /// bunu göremez. Ayarlar ekranı bu değerle gerçek durumu gösterir.
  /// iOS'ta eklenti karşılığını sunmadığından `null` döner = "bilinmiyor".
  Future<bool?> areEnabled() async {
    try {
      final android = _plugin
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      if (android != null) return await android.areNotificationsEnabled();
    } catch (_) {}
    return null;
  }

  /// Android 13+ / iOS bildirim izni ister. Reddedilse bile uygulama çalışmaya devam eder.
  ///
  /// TAM ALARM İZNİ BURADA İSTENMEZ — bilinçli. `requestExactAlarmsPermission` bir
  /// diyalog değil, TAM EKRAN SİSTEM AYAR SAYFASI açar. Bildirim izni diyaloğunun hemen
  /// ardından çağrıldığında diyaloğu örtüyor/eziyordu; kullanıcı hiçbir şey sorulmamış gibi
  /// görüyordu. Artık ayrı: [requestExactAlarms] yalnızca gerçekten zamanlanmış hatırlatma
  /// kurulacağı anda (ya da bildirim ayarları ekranından) çağrılır.
  Future<bool> requestPermissions() async {
    final android = _plugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    var granted = true;
    if (android != null) {
      // Zaten açıksa sistem diyalog GÖSTERMEZ ve true döner — bu normaldir.
      granted = await android.requestNotificationsPermission() ?? true;
    }
    final ios = _plugin
        .resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>();
    final iosGranted =
        await ios?.requestPermissions(alert: true, badge: true, sound: true);
    return granted && (iosGranted ?? true);
  }

  /// TAM ALARM (SCHEDULE_EXACT_ALARM) izni — sistem ayar sayfası açar.
  ///
  /// Yalnızca zamanlanmış randevu hatırlatması kurulurken anlamlıdır ve manifest'teki
  /// `USE_EXACT_ALARM` sayesinde çoğu cihazda zaten verilmiş olur. Açılışta
  /// çağrılmaz: kullanıcıyı ilk saniyede ayar ekranına atmak kabul edilemez.
  Future<void> requestExactAlarms() async {
    try {
      final android = _plugin
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      await android?.requestExactAlarmsPermission();
    } catch (_) {
      // İzin alınamazsa zamanlanmış hatırlatma yaklaşık saatte tetiklenir; akış bozulmaz.
    }
  }

  Future<void> show({
    required int id,
    required String channelId,
    required String title,
    required String body,
    Map<String, dynamic>? data,
  }) async {
    await _plugin.show(
      id,
      title,
      body,
      _details(channelId),
      payload: data == null ? null : jsonEncode(data),
    );
  }

  /// [whenUtc] anına yerel bildirim zamanlar. Geçmişse hiçbir şey yapmaz.
  /// exactAllowWhileIdle → Doze modunda ve internetsiz de tam saatinde tetiklenir.
  Future<void> schedule({
    required int id,
    required String title,
    required String body,
    required DateTime whenUtc,
    String channelId = NotificationChannels.remindersId,
    Map<String, dynamic>? data,
  }) async {
    final when = tz.TZDateTime.from(whenUtc.toUtc(), tz.local);
    if (!when.isAfter(tz.TZDateTime.now(tz.local))) return;
    await _plugin.zonedSchedule(
      id,
      title,
      body,
      when,
      _details(channelId),
      androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
      uiLocalNotificationDateInterpretation:
          UILocalNotificationDateInterpretation.absoluteTime,
      payload: data == null ? null : jsonEncode(data),
    );
  }

  Future<void> cancel(int id) => _plugin.cancel(id);
  Future<void> cancelAll() => _plugin.cancelAll();
  Future<List<PendingNotificationRequest>> pending() =>
      _plugin.pendingNotificationRequests();

  NotificationDetails _details(String channelId) {
    final def = NotificationChannels.byId(channelId);
    return NotificationDetails(
      android: AndroidNotificationDetails(
        def.id,
        def.name,
        channelDescription: def.description,
        importance: Importance.high,
        priority: Priority.high,
        icon: '@mipmap/ic_launcher',
      ),
      iOS: const DarwinNotificationDetails(),
    );
  }
}

/// Arka plan (uygulama kapalıyken) bildirime dokunma — ayrı isolate'ta tetiklenir.
/// UI'a doğrudan erişemez; uygulama açıldığında launchPayload/onTap akışı devralır.
@pragma('vm:entry-point')
void notificationTapBackground(NotificationResponse response) {}

/// Önem/tür bazlı bildirim kanalları. Kullanıcı Android ayarlarından tek tek yönetebilir.
class NotificationChannels {
  const NotificationChannels(this.id, this.name, this.description);
  final String id;
  final String name;
  final String description;

  static const defaultId = 'beautyasist_default';
  static const appointmentsId = 'beautyasist_appointments';
  static const approvalsId = 'beautyasist_approvals';
  static const securityId = 'beautyasist_security';
  static const cashId = 'beautyasist_cash';
  static const reportsId = 'beautyasist_reports';
  static const remindersId = 'beautyasist_reminders';

  static const all = <NotificationChannels>[
    NotificationChannels(defaultId, 'Genel', 'Genel bildirimler'),
    NotificationChannels(appointmentsId, 'Randevular', 'Randevu oluşturma / iptal / güncelleme'),
    NotificationChannels(approvalsId, 'Onaylar', 'Onay bekleyen personel işlemleri'),
    NotificationChannels(securityId, 'Güvenlik', 'Yetkisiz cihaz girişi ve güvenlik uyarıları'),
    NotificationChannels(cashId, 'Kasa & Ödeme', 'Kasa kapanışı ve ödeme hatırlatmaları'),
    NotificationChannels(reportsId, 'Raporlar', 'Aylık gelir/gider özetleri'),
    NotificationChannels(remindersId, 'Hatırlatmalar', 'Yaklaşan randevu hatırlatmaları'),
  ];

  static NotificationChannels byId(String id) =>
      all.firstWhere((c) => c.id == id, orElse: () => all.first);
}

/// AppNotificationType (backend integer) → uygun kanal. app_notification tür kodlarıyla aynı.
String channelForType(int type) {
  switch (type) {
    case 10: // ApprovalPending
      return NotificationChannels.approvalsId;
    case 30: // UnauthorizedDevice
      return NotificationChannels.securityId;
    case 40: // CashClosing
    case 41: // PaymentDue
      return NotificationChannels.cashId;
    case 50: // MonthlyReport
      return NotificationChannels.reportsId;
    case 4: // AppointmentReminder
      return NotificationChannels.remindersId;
    case 1: // AppointmentCreated
    case 2: // AppointmentCancelled
    case 3: // AppointmentUpdated
    case 20: // WaitlistOffer
    case 21: // OnlineBookingRequest
    case 22: // WhatsAppReply
      return NotificationChannels.appointmentsId;
    default:
      return NotificationChannels.defaultId;
  }
}

/// debugPrint'i yalnızca debug modda çıkar (release'de sessiz).
void notifyLog(String msg) {
  if (kDebugMode) debugPrint('[notif] $msg');
}
