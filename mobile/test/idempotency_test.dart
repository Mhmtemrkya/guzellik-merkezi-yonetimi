import 'package:flutter_test/flutter_test.dart';
import 'package:beautyasist_mobile/core/network/idempotency.dart';

/// Web'deki `Frontend/lib/idempotency.test.ts`'in eşi — kural İKİ YERDE yazılı olduğu için
/// testi de iki yerde tutuyoruz. Sapma SESSİZDİR: mobil taraf anahtarı yanlış türetirse
/// tahsilat ya çiftlenir (koruma çalışmaz) ya da meşru ikinci tahsilat 409 ile yutulur.
void main() {
  const salt = 'testsalt1234';

  group('idempotencyKey', () {
    test('aynı niyeti aynı anahtara indirger (tazeleme sonrası tekrar gönderim)', () {
      final first = idempotencyKey(salt, ['acc-1', 'cash', 400, 'stamp', null]);
      final again = idempotencyKey(salt, ['acc-1', 'cash', 400, 'stamp', null]);
      expect(again, first);
    });

    test('tutar/yöntem/hesap değişince anahtar da değişir', () {
      final base = idempotencyKey(salt, ['acc-1', 'cash', 400, 'stamp', null]);
      expect(idempotencyKey(salt, ['acc-1', 'cash', 300, 'stamp', null]), isNot(base));
      expect(idempotencyKey(salt, ['acc-1', 'card', 400, 'stamp', null]), isNot(base));
      expect(idempotencyKey(salt, ['acc-2', 'cash', 400, 'stamp', null]), isNot(base));
      expect(idempotencyKey(salt, ['acc-1', 'cash', 400, 'stamp', 'dekont']), isNot(base));
    });

    test('sheet kapatılıp açılınca (yeni tuz) aynı tahsilat tekrar yapılabilir', () {
      final a = idempotencyKey(newIdempotencySalt(), ['acc-1', 'cash', 400, 'stamp', null]);
      final b = idempotencyKey(newIdempotencySalt(), ['acc-1', 'cash', 400, 'stamp', null]);
      expect(b, isNot(a));
    });

    test('alan sınırını korur: kayan ayraç iki farklı girdiyi aynı anahtara indirmez', () {
      // Ayraç boşluk olsaydı ikisi de "ödeme 1 x" dizesine iner ve biri sessizce oynatılırdı.
      expect(
        idempotencyKey(salt, ['ödeme 1', 'x']),
        isNot(idempotencyKey(salt, ['ödeme', '1 x'])),
      );
    });

    test('middleware sınırını aşmaz: uzun referansta bile 64 karakterin altında kalır', () {
      // Sunucu `key.Length is 0 or > 64` ise başlığı YOK SAYAR — uzun anahtar sessizce korumasız.
      final key = idempotencyKey(
        newIdempotencySalt(),
        ['acc-1', 'cash', 1234.56, 'stamp', 'x' * 5000],
      );
      expect(key.length, greaterThan(0));
      expect(key.length, lessThanOrEqualTo(64));
    });
  });

  test('newIdempotencySalt her çağrıda farklı tuz üretir', () {
    final seen = <String>{};
    for (var i = 0; i < 200; i++) {
      seen.add(newIdempotencySalt());
    }
    expect(seen.length, 200);
  });
}
