import 'package:flutter/foundation.dart';

/// MAĞAZA POLİTİKASI — App Store 3.1.1 / 3.1.3.
///
/// Abonelik paketi bir dijital hizmettir; iOS'ta uygulama içinden (fiyat, "yükselt", ödeme
/// sayfasına giden buton ya da ödemeli web kaydına bağlantı) In-App Purchase dışı bir satın
/// almaya YÖNLENDİRMEK red gerekçesidir. iOS'ta bu yüzeyler gizlenir; mevcut paket ve kullanım
/// (zaten satın alınmış hizmete erişim, 3.1.3(b)) gösterilmeye devam eder. Android'de değişiklik yok.
class StorePolicy {
  StorePolicy._();

  static bool get hidesPurchaseFlows =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;
}
