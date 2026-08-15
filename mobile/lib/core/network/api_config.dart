import 'dart:io';

import 'package:flutter/foundation.dart';

/// Taban API adresinin TEK KAYNAĞI.
///
/// Hem [ApiClient] hem de arka plan bildirim yoklayıcısı aynı sunucuya gitmelidir.
/// İkisi kendi kopyasını taşırken biri güncellenip diğeri unutulduğunda uygulama bir
/// sunucuya, bildirimler başka bir sunucuya konuşur — sessiz ve teşhisi zor bir hata.
class ApiConfig {
  const ApiConfig._();

  /// CANLI (release) varsayılanı — backend'in public adresi.
  ///
  /// Bu adres doğrulandı: `GET /health` → 200 ve `GET /api/admin/customers` → 401
  /// (yani .NET backend host'un KÖKÜNDE yayında, `/api` ön eki yok).
  static const String productionBaseUrl = 'https://maydanozasist.beautyasist.com';

  /// Derleme zamanı override (`--dart-define=API_BASE_URL=...`) > release varsayılanı >
  /// yerel geliştirme (Android emülatörü host makinesini 10.0.2.2 ile görür).
  static String get baseUrl {
    const configured = String.fromEnvironment('API_BASE_URL');
    if (configured.isNotEmpty) return configured;
    if (kReleaseMode) return productionBaseUrl;
    return Platform.isAndroid
        ? 'http://10.0.2.2:5019'
        : 'http://127.0.0.1:5019';
  }

  /// HERKESE AÇIK WEB adresi — hediye kartındaki QR'ın hedefi buradan kurulur.
  ///
  /// API adresiyle AYNI DEĞİLDİR: QR bir Next.js sayfasını (`/hediye-kart/{slug}/{kod}`) açar,
  /// API'yi değil. Tek domain kurulumunda ikisi çakışır, ayrı domainde `--dart-define`
  /// (PUBLIC_WEB_BASE_URL) ile ayrıştırılır. Tanımsızsa QR basılmaz — çalışmayan bir adres
  /// gömmek, hiç QR koymamaktan kötüdür.
  /// Panelin/vitrinin yayın adresi — QR bu adrese götürür.
  static const String productionWebUrl = 'https://beautyasist.com';

  static String get publicWebBaseUrl {
    const configured = String.fromEnvironment('PUBLIC_WEB_BASE_URL');
    if (configured.isNotEmpty) return configured;
    return productionWebUrl;
  }
}
