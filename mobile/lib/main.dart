import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'app/app.dart';
import 'core/notifications/fcm_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);
  await initializeDateFormatting('tr_TR');

  // FCM opsiyonel: Firebase yapılandırılmışsa (google-services.json) arka plan mesaj handler'ını kaydet.
  // Yapılandırma yoksa tryInit false döner ve FCM tamamen atlanır (yerel+LAN katmanları çalışmaya devam eder).
  if (await FcmService.instance.tryInit()) {
    FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);
  }

  runApp(const BeautyAssistApp());
}
