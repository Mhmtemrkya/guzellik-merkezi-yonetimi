/**
 * İKİ SEVİYELİ PERSONEL YETKİSİ — SAF KURAL.
 *
 * Backend `Permissions.IsActionAllowed` (Domain/Permissions.cs) kuralının istemci karşılığıdır.
 * Aynı iş kuralı iki yerde yazıldığı için SAPMAYA AÇIKTIR: biri değişip diğeri kalırsa personel
 * ya yapamayacağı işlemi görür ya da yapabileceği işlemi göremez. Kural bu yüzden React hook'undan
 * ayrıldı — hook yalnız kullanıcıyı okur, KARAR burada verilir ve testlenir (`permissions.test.ts`).
 *
 * NOT: Butonu gizlemek güvenlik sınırı DEĞİLDİR; asıl koruma backend endpoint filtresi + onay
 * kapısıdır. Buradaki amaç personelin yapamayacağı işlemi hiç görmemesi.
 */

/** Sayfa izni (ör. "Waitlist"). Personel dışındaki roller her zaman yetkilidir. */
export function hasPageAccess(isStaff: boolean, granted: readonly string[], pageKey: string): boolean {
  if (!isStaff) return true
  return granted.includes(pageKey.toLowerCase())
}

/**
 * İşlem izni (ör. "Customers.Delete").
 *
 * GERİYE UYUMLULUK KURALI (backend ile birebir aynı): işlem anahtarı doğrudan verilmemişse,
 * personelin SAYFA izni varsa ve o sayfaya ait HİÇBİR işlem anahtarı atanmamışsa (eski format
 * kayıt) izinli sayılır. En az bir işlem anahtarı atanmışsa yönetici bilinçli kısıtlamış demektir
 * → reddedilir. Bu ayrım kaybolursa eski kayıtlı kurumlarda personel tüm işlemleri yapamaz hâle
 * gelir ya da tam tersi, kısıtlanmış personel her şeyi yapabilir.
 */
export function hasActionAccess(isStaff: boolean, granted: readonly string[], actionKey: string): boolean {
  if (!isStaff) return true
  if (!actionKey) return true

  const key = actionKey.toLowerCase()
  if (granted.includes(key)) return true

  const dot = key.indexOf('.')
  if (dot <= 0) return false

  const pageKey = key.slice(0, dot)
  if (!granted.includes(pageKey)) return false
  return !granted.some((p) => p.startsWith(`${pageKey}.`))
}

/** İzin listesini karşılaştırmaya hazır hâle getirir (büyük/küçük harf duyarsız). */
export function normalizePermissions(permissions: readonly string[] | null | undefined): string[] {
  return (permissions ?? []).map((p) => p.toLowerCase())
}
