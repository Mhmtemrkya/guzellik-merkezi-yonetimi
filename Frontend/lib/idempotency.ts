/**
 * Para yazan çağrılar için `Idempotency-Key` üretimi.
 *
 * Sunucu tarafı hazır: `IdempotencyMiddleware` başlığı TAŞIYAN /api/admin yazmalarını tek sefere
 * indirger, başlıksız istekleri hiç görmez. Yani koruma tamamen çağrı yerinin anahtarı göndermesine
 * bağlıdır — parametre opsiyonel olduğu için atlandığında derleyici uyarmaz.
 *
 * ## Anahtar nasıl seçilir
 *
 * Kural: **aynı niyet → aynı anahtar, farklı niyet → farklı anahtar.** İki yaygın yanlış:
 * - *Gönderim başına yeni anahtar* — her tıklama farklı anahtar üretir, koruma hiç çalışmaz.
 * - *Modal açılışında tek anahtar* — kullanıcı 400 ₺ girip gönderir, 300 ₺'ye düzeltip tekrar
 *   gönderirse gövde değişir; middleware parmak izini tutturamaz ve `IdempotencyKeyReuse` (409)
 *   döndürerek **meşru ikinci tahsilatı bloklar**.
 *
 * Bu yüzden anahtar İÇERİKTEN türetilir: bir oturum tuzu (`newIdempotencySalt`, modal/ekran her
 * açıldığında yenilenir) + isteği ayırt eden alanların özeti. Sonuç:
 * - çift tıklama, arada düzenleme yok → aynı anahtar + aynı gövde → ilk yanıt oynatılır, tek kayıt
 * - gönderim başarılı ama ekran tazeleme patladı, kullanıcı tekrar bastı → yine oynatılır
 * - tutar/yöntem düzeltilip gönderildi → anahtar değişir → ikinci tahsilat yazılır
 * - arada hiç düzenleme olmadan gerçekten iki özdeş tahsilat → ikincisi oynatılır (yazılmaz).
 *   Yapısal olarak çift tıklamadan ayırt edilemez; kullanıcı modalı kapatıp açarak yeni tuz alır.
 */

/** Middleware sınırı: `key.Length is 0 or > 64` → 64'ten uzun anahtar sessizce KORUMASIZ kalır. */
const MAX_KEY_LENGTH = 64

/**
 * Alan ayracı. GÖRÜNÜR bir ayraç (boşluk, tire) seçilemez: referans serbest metindir ve
 * `["ödeme 1", "x"]` ile `["ödeme", "1 x"]` aynı dizeye inip AYNI anahtarı üretirdi — iki farklı
 * tahsilattan biri sessizce yutulurdu. NUL bir `<input>` değerinde bulunamaz.
 */
const FIELD_SEPARATOR = '\u0000'

/**
 * Tek tıklamayla para yazan düğmelerin (ör. "Bu taksiti tahsil et") işleyiciye taşıdığı niyet.
 * İşleyici HER İKİ alanı da kullanmalı: `idempotencyKey` isteğe başlık olarak, `occurredAtUtc`
 * gövdeye. Damgayı işleyici kendi `new Date()`'iyle üretirse ikinci tıklamanın gövdesi farklı
 * olur; anahtar tutsa bile sunucu parmak izini tutturamaz, ilk yanıtı oynatmak yerine 409 döner.
 */
export interface IdempotentWriteOptions {
  idempotencyKey: string
  occurredAtUtc: string
}

/**
 * Oturum tuzu — modal/ekran açılışında bir kez üretilir, gönderimler arasında SABİT kalır.
 * Tuzun tek işi aynı içerikli iki ayrı oturumu birbirinden ayırmak: kullanıcı modalı kapatıp
 * açtığında gerçekten aynı tahsilatı bir daha yapabilmeli.
 */
export function newIdempotencySalt(): string {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '').slice(0, 12)
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8)
}

/**
 * cyrb53 — 53 bitlik, hızlı, bağımlılıksız özet. Kriptografik değildir ve olması gerekmez:
 * anahtar bir sır değil, yalnız "aynı istek mi" sorusunun istemci tarafındaki cevabıdır.
 * Çakışma olsa bile sessiz veri kaybına yol açmaz — middleware ayrıca isteğin parmak izini
 * (metot+yol+sorgu+gövde) karşılaştırır ve uyuşmazsa oynatmak yerine 409 döndürür.
 */
function cyrb53(text: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/**
 * İçerikten türetilen kararlı anahtar. `parts` isteği ayırt eden HER alanı içermeli — gövdeye
 * giren ama burada olmayan bir alan değiştiğinde anahtar sabit kalır ve 409 `IdempotencyKeyReuse`
 * alırsın (sessiz çift kayıt değil, görünür hata; yine de sinir bozucu).
 *
 * @param salt `newIdempotencySalt()` ile üretilmiş oturum tuzu.
 */
export function idempotencyKey(
  salt: string,
  ...parts: Array<string | number | null | undefined>
): string {
  const digest = cyrb53(parts.map((p) => (p ?? '')).join(FIELD_SEPARATOR)).toString(36)
  const key = `p-${salt}-${digest}`
  return key.length > MAX_KEY_LENGTH ? key.slice(0, MAX_KEY_LENGTH) : key
}
