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
}
