import 'dart:math';

/// Para yazan çağrılar için `Idempotency-Key` üretimi — web'deki `lib/idempotency.ts`'in eşi.
///
/// Sunucudaki `IdempotencyMiddleware` başlığı TAŞIYAN /api/admin yazmalarını tek sefere indirger,
/// başlıksız istekleri hiç görmez. Koruma tamamen çağrı yerinin anahtarı göndermesine bağlıdır.
///
/// Kural: **aynı niyet → aynı anahtar, farklı niyet → farklı anahtar.** İki yaygın yanlış:
/// - *Gönderim başına yeni anahtar* — her dokunuş farklı anahtar üretir, koruma hiç çalışmaz.
/// - *Sayfa açılışında tek anahtar* — kullanıcı tutarı düzeltip tekrar gönderirse gövde değişir;
///   sunucu parmak izini tutturamaz ve `IdempotencyKeyReuse` (409) ile MEŞRU ikinci tahsilatı
///   bloklar.
///
/// Bu yüzden anahtar içerikten türetilir: oturum tuzu ([newIdempotencySalt], sayfa/sheet
/// açılışında bir kez) + isteği ayırt eden alanların özeti.

/// Middleware sınırı: `key.Length is 0 or > 64` → daha uzun anahtar sessizce KORUMASIZ kalır.
const int _maxKeyLength = 64;

/// Alan ayracı. GÖRÜNÜR bir ayraç (boşluk, tire) seçilemez: referans serbest metindir ve
/// ["ödeme 1", "x"] ile ["ödeme", "1 x"] aynı dizeye inip AYNI anahtarı üretirdi.
const String _fieldSeparator = '\u0000';

/// Oturum tuzu — sheet açılışında bir kez üretilir, gönderimler arasında SABİT kalır.
/// Tek işi aynı içerikli iki ayrı oturumu ayırmak: kullanıcı sheet'i kapatıp açtığında gerçekten
/// aynı tahsilatı bir daha yapabilmeli.
String newIdempotencySalt() {
  final time = DateTime.now().microsecondsSinceEpoch.toRadixString(36);
  final noise = Random().nextInt(0x7FFFFFFF).toRadixString(36);
  return '${time.substring(max(0, time.length - 6))}$noise';
}

/// FNV-1a (64 bit). Kriptografik değildir ve olması gerekmez: anahtar bir sır değil, yalnız
/// "aynı istek mi" sorusunun istemci tarafındaki cevabıdır. Çakışma sessiz veri kaybı yapmaz —
/// sunucu ayrıca isteğin parmak izini karşılaştırır ve uyuşmazsa oynatmak yerine 409 döner.
int _fnv1a64(String text) {
  var hash = 0xcbf29ce484222325;
  for (final unit in text.codeUnits) {
    hash ^= unit;
    // Dart int'i 64 bit ve taşmada sarar; işaret bitini maskeleyip pozitif tutuyoruz
    // (toRadixString negatif sayıda '-' üretir ve anahtarı çirkinleştirirdi).
    hash = (hash * 0x100000001b3) & 0x7FFFFFFFFFFFFFFF;
  }
  return hash;
}

/// İçerikten türetilen kararlı anahtar. [parts] isteği ayırt eden HER alanı içermeli — gövdeye
/// giren ama burada olmayan bir alan değiştiğinde anahtar sabit kalır ve 409 alırsın.
String idempotencyKey(String salt, List<Object?> parts) {
  // Ayraç NUL: referans serbest metindir ve boşluk gibi görünür bir ayraç seçilseydi
  // ["ödeme 1", "x"] ile ["ödeme", "1 x"] aynı dizeye inip AYNI anahtarı üretirdi.
  final joined = parts.map((p) => p ?? '').join(_fieldSeparator);
  final key = 'p-$salt-${_fnv1a64(joined).toRadixString(36)}';
  return key.length > _maxKeyLength ? key.substring(0, _maxKeyLength) : key;
}
