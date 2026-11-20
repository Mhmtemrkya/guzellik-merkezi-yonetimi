import 'package:flutter/foundation.dart';

/// App Store ve Google Play için dijital abonelik satın alma yüzeyleri.
///
/// Abonelik paketi bir dijital hizmettir; iOS'ta uygulama içinden (fiyat, "yükselt", ödeme
/// sayfasına giden buton ya da ödemeli web kaydına bağlantı) In-App Purchase dışı bir satın
/// almaya YÖNLENDİRMEK red gerekçesidir. iOS'ta bu yüzeyler gizlenir; mevcut paket ve kullanım
/// (zaten satın alınmış hizmete erişim) gösterilmeye devam eder. Play derlemesi
/// `--dart-define=PLAY_STORE_BUILD=true` ile aynı sınırlamayı kullanır;
/// doğrudan dağıtılan Android sürümleri mevcut davranışını korur.
class StorePolicy {
  StorePolicy._();

  static const _playStoreBuild = bool.fromEnvironment('PLAY_STORE_BUILD');

  static bool get hidesPurchaseFlows =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.iOS ||
          (_playStoreBuild && defaultTargetPlatform == TargetPlatform.android));
}
