import 'package:beautyasist_mobile/features/assistant/assistant_api.dart';
import 'package:beautyasist_mobile/features/assistant/maydi_mascot.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

/// Maydi mobil: sunucunun "Sayfayı aç" bağlantısı (web rotası) telefondaki ekrana çevrilir; müşteri işletme
/// paneline, mağaza sürümünde kimse satın alma sayfasına yönlendirilmez (App Store 3.1.1).
void main() {
  tearDown(() => debugDefaultTargetPlatformOverride = null);

  test('business web routes map to mobile tabs', () {
    expect(mobileRouteFor('/panel/randevular', customer: false), '/appointments');
    expect(mobileRouteFor('/ekip/randevular?scope=today', customer: false), '/appointments');
    expect(mobileRouteFor('/ekip/seanslar', customer: false), '/appointments');
    expect(mobileRouteFor('/panel/musteriler', customer: false), '/customers');
    expect(mobileRouteFor('/imza', customer: false), '/customers');
    expect(mobileRouteFor('/panel', customer: false), '/home');
    expect(mobileRouteFor('/ekip', customer: false), '/home');
    // Telefonda ayrı sekmesi olmayan ekranlar "Daha fazla" menüsündedir.
    expect(mobileRouteFor('/panel/kasa-kapanis', customer: false), '/more');
    expect(mobileRouteFor('/panel/paketler', customer: false), '/more');
    expect(mobileRouteFor(null, customer: false), isNull);
    expect(mobileRouteFor('/randevu', customer: false), isNull);
  });

  test('customer only reaches the customer portal', () {
    expect(mobileRouteFor('/randevu', customer: true), '/customer/appointments');
    expect(mobileRouteFor('/panel/kasa', customer: true), isNull);
  });

  test('purchase page is never offered on iOS (store build)', () {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    expect(mobileRouteFor('/panel/paket', customer: false), isNull);
    // "Paketler" (hizmet paketleri) satın alma ekranı değildir.
    expect(mobileRouteFor('/panel/paketler', customer: false), '/more');

    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    expect(mobileRouteFor('/panel/paket', customer: false), '/more');
  });

  test('appreciation is only a standalone thanks', () {
    expect(isMaydiAppreciation('Teşekkürler Maydi!'), isTrue);
    expect(isMaydiAppreciation('teşekkürler, kasa nasıl kapatılır'), isFalse);
  });
}
