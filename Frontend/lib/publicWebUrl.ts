/**
 * YAYIN ADRESİ — kalıcı belgelere gömülen bağlantıların kökü.
 *
 * <p>`window.location.origin` KULLANILMAZ. Bu adres basılı/indirilmiş belgelerin içine yazılır
 * (hediye kartındaki QR, giriş bilgileri PDF'indeki giriş linki) ve belge aylarca yaşar. Paneli
 * o an hangi adresten açtığımız (localhost, önizleme alanı, iç ağ IP'si) belgeye gömülürse
 * bağlantı doğduğu anda ölür — üstelik kimse fark etmez, çünkü üreten makinede çalışır.</p>
 *
 * <p>Farklı domainde çalışan kurulum için `NEXT_PUBLIC_PUBLIC_WEB_URL` ile ezilebilir.</p>
 */
export function publicWebBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_PUBLIC_WEB_URL || 'https://beautyasist.com').replace(/\/+$/, '')
}

/** Panele giriş sayfasının tam adresi — giriş bilgileri belgesine basılır. */
export function loginUrl(): string {
  return `${publicWebBaseUrl()}/login`
}
