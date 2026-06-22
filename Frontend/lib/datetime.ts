// Merkezi UTC tarih çözümleyici.
//
// SORUN: Backend (MySQL'den okunan DateTime'lar Kind=Unspecified olduğundan) UTC zaman damgalarını
// çoğu zaman "Z" son eki OLMADAN gönderiyor (örn. "2026-06-22T09:00:00"). Tarayıcıda `new Date("...09:00:00")`
// bu değeri YEREL saat sayar → cihazın saat dilimine göre kayma olur. Telefon/tablet farklı timezone'daysa
// aynı randevu farklı saatte görünür (TR cihazda bile UTC+3 kadar kayar).
//
// ÇÖZÜM: Eksikse "Z" ekleyip doğru MUTLAK anı (UTC) elde ederiz; ardından `toLocale*` ile cihazın yerel
// saatinde doğru gösterilir. Tüm backend `*Utc` damgaları bu helper'dan geçmeli; çıplak `new Date(iso)` KULLANMA.

const TZ_SUFFIX = /([zZ])$|[+-]\d\d:?\d\d$/

/** Backend UTC damgasını (gerekirse 'Z' ekleyerek) güvenle Date'e çevirir. Geçersizse null. */
export function parseUtc(value: string | Date | null | undefined): Date | null {
  if (value == null || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const normalized = TZ_SUFFIX.test(value) ? value : `${value}Z`
  const d = new Date(normalized)
  return Number.isNaN(d.getTime()) ? null : d
}

/** parseUtc + getTime(); geçersizse null. */
export function parseUtcMs(value: string | Date | null | undefined): number | null {
  const d = parseUtc(value)
  return d ? d.getTime() : null
}

/** UTC anının CİHAZIN YEREL gününü YYYY-MM-DD olarak döndürür (takvim gruplaması için). */
export function localDateKey(value: string | Date | null | undefined): string {
  const d = parseUtc(value) ?? new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
