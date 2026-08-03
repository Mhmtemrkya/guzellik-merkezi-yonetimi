import 'package:beautyasist_mobile/shared/json_helpers.dart';
import 'package:flutter_test/flutter_test.dart';

/// UTC OKUMA TUZAĞI (4 Ağu 2026 — "randevu web'te var, mobilde yok" hatası).
///
/// Backend tarihleri UTC'dir ama MySQL'den okunan değerler `Kind=Unspecified` döndüğü için
/// JSON'a 'Z' EKİ OLMADAN yazılabiliyor ("2026-08-04T06:00:00"). Ham `DateTime.parse` böyle
/// bir değeri YEREL sanar; `toLocal()` hiçbir şey yapmaz ve saat UTC+3'te 3 saat geri kayar.
///
/// Somut sonuç: 09:00'daki randevu takvimde 06:00'ya çiziliyordu. Takvimin görünür penceresi
/// 09:00–20:00 olduğu için randevu EKRANDA HİÇ GÖRÜNMÜYORDU — web'de ise doğru görünüyordu.
void main() {
  // Testin anlamlı olması için cihazın UTC'de olmadığını varsayan bir sapma kullanılır;
  // doğrulama sapmanın kendisine değil, İKİ BİÇİMİN AYNI ANI vermesine bakar.
  group('parseUtcToLocal', () {
    test("'Z' ekli ve eksiz değerler AYNI anı verir", () {
      final withZ = parseUtcToLocal('2026-08-04T06:00:00Z');
      final withoutZ = parseUtcToLocal('2026-08-04T06:00:00');

      expect(withZ, isNotNull);
      expect(withoutZ, isNotNull);
      expect(withoutZ!.toUtc(), withZ!.toUtc(),
          reason: "'Z' eksikliği saati kaydırmamalı");
    });

    test('ham DateTime.parse ile arasındaki fark: kayma gerçekten önleniyor', () {
      const raw = '2026-08-04T06:00:00'; // 'Z' yok — hatalı senaryonun kaynağı
      final correct = parseUtcToLocal(raw)!.toUtc();
      final naive = DateTime.parse(raw).toUtc();

      // Cihaz UTC ise ikisi eşittir; değilse ham okuma kayar. Doğru olan her hâlde
      // "06:00 UTC"dir — testin sabit iddiası budur.
      expect(correct, DateTime.utc(2026, 8, 4, 6));
      if (DateTime.now().timeZoneOffset != Duration.zero) {
        expect(naive, isNot(correct),
            reason: 'ham okuma UTC olmayan cihazda kayar (hatanın kendisi)');
      }
    });

    test('boş / geçersiz değerler null döner', () {
      expect(parseUtcToLocal(null), isNull);
      expect(parseUtcToLocal(''), isNull);
      expect(parseUtcToLocal('abc'), isNull);
    });
  });

  group('parseUtc', () {
    test("'Z' ekli ve eksiz değerler aynı UTC anını verir", () {
      expect(parseUtc('2026-08-04T06:00:00'), DateTime.utc(2026, 8, 4, 6));
      expect(parseUtc('2026-08-04T06:00:00Z'), DateTime.utc(2026, 8, 4, 6));
    });

    test('sonuç her zaman UTC işaretlidir', () {
      expect(parseUtc('2026-08-04T06:00:00')!.isUtc, isTrue);
    });

    test('boş / geçersiz değerler null döner', () {
      expect(parseUtc(null), isNull);
      expect(parseUtc('gecersiz'), isNull);
    });
  });
}
