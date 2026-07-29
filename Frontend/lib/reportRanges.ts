/**
 * Raporlar sayfasının dönem matematiği.
 *
 * • Hazır dönemler (gün / hafta / ay / yıl) ileri-geri gezilebilir; "özel" seçilince serbest
 *   tarih aralığı (ör. 1 Temmuz – 2 Eylül) kullanılır.
 * • Karşılaştırma dönemi: önceki dönem, geçen yıl aynı aralık, 2 yıl önce ya da tamamen özel.
 *   Böylece "bu yılı 2 yıl öncesiyle kıyasla" tek seçimle yapılır.
 *
 * Tüm aralıklar yarı-açıktır: [from, to). Tarihler YEREL oluşturulur, API'ye ISO/UTC gider —
 * kullanıcının gördüğü gün sınırı ile sunucunun süzdüğü sınır aynı olsun diye.
 */

export type PeriodPreset = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'

export type CompareMode = 'none' | 'previous' | 'lastYear' | 'twoYearsAgo' | 'custom'

export interface DateRange {
  from: Date
  to: Date
}

export interface ResolvedRange extends DateRange {
  label: string
  /** Kısa etiket — rozet ve grafik başlıklarında. */
  shortLabel: string
}

export const periodLabels: Record<PeriodPreset, string> = {
  daily: 'Günlük',
  weekly: 'Haftalık',
  monthly: 'Aylık',
  yearly: 'Yıllık',
  custom: 'Özel Aralık',
}

export const compareLabels: Record<CompareMode, string> = {
  none: 'Karşılaştırma yok',
  previous: 'Önceki dönem',
  lastYear: 'Geçen yıl',
  twoYearsAgo: '2 yıl önce',
  custom: 'Özel dönem',
}

const dayFmt = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' })
const dayShortFmt = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short' })
const weekdayFmt = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
const monthFmt = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' })

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + days)
  return next
}

/** Aralığın son GÖRÜNEN günü (to hariç olduğu için bir gün geri). */
export function inclusiveEnd(range: DateRange): Date {
  return addDays(range.to, -1)
}

/**
 * Hazır dönemi çözer. `offset` 0 = içinde bulunulan dönem, -1 = bir önceki, +1 = sonraki.
 * `custom` için çağıran zaten from/to verir; burada yalnız etiket üretilir.
 */
export function resolvePeriod(preset: PeriodPreset, offset: number, custom?: DateRange): ResolvedRange {
  const now = new Date()

  if (preset === 'custom') {
    const from = custom ? startOfDay(custom.from) : startOfDay(now)
    const to = custom ? startOfDay(custom.to) : addDays(startOfDay(now), 1)
    return { from, to, label: describeRange({ from, to }), shortLabel: describeRangeShort({ from, to }) }
  }

  if (preset === 'daily') {
    const from = addDays(startOfDay(now), offset)
    const to = addDays(from, 1)
    return { from, to, label: weekdayFmt.format(from), shortLabel: dayShortFmt.format(from) }
  }

  if (preset === 'weekly') {
    const today = startOfDay(now)
    const mondayOffset = (today.getDay() + 6) % 7
    const from = addDays(today, -mondayOffset + offset * 7)
    const to = addDays(from, 7)
    return { from, to, label: describeRange({ from, to }), shortLabel: describeRangeShort({ from, to }) }
  }

  if (preset === 'monthly') {
    const from = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 1)
    return { from, to, label: monthFmt.format(from), shortLabel: monthFmt.format(from) }
  }

  // yearly
  const from = new Date(now.getFullYear() + offset, 0, 1)
  const to = new Date(from.getFullYear() + 1, 0, 1)
  return { from, to, label: `${from.getFullYear()}`, shortLabel: `${from.getFullYear()}` }
}

/** Karşılaştırma penceresini üretir; 'none' ise null. */
export function resolveCompare(
  mode: CompareMode,
  current: DateRange,
  preset: PeriodPreset,
  offset: number,
  custom?: DateRange,
): ResolvedRange | null {
  if (mode === 'none') return null

  if (mode === 'custom') {
    if (!custom) return null
    const from = startOfDay(custom.from)
    const to = startOfDay(custom.to)
    return { from, to, label: describeRange({ from, to }), shortLabel: describeRangeShort({ from, to }) }
  }

  if (mode === 'previous') {
    // Hazır dönemde bir önceki takvim dönemi; özel aralıkta eşit uzunlukta hemen önceki blok.
    if (preset !== 'custom') {
      const prev = resolvePeriod(preset, offset - 1)
      return prev
    }
    const spanDays = Math.max(1, Math.round((current.to.getTime() - current.from.getTime()) / 86400000))
    const to = new Date(current.from)
    const from = addDays(to, -spanDays)
    return { from, to, label: describeRange({ from, to }), shortLabel: describeRangeShort({ from, to }) }
  }

  const yearsBack = mode === 'lastYear' ? 1 : 2
  const from = shiftYears(current.from, -yearsBack)
  const to = shiftYears(current.to, -yearsBack)
  return { from, to, label: describeRange({ from, to }), shortLabel: describeRangeShort({ from, to }) }
}

function shiftYears(d: Date, years: number): Date {
  return new Date(d.getFullYear() + years, d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds())
}

/** "01 Temmuz 2026 — 02 Eylül 2026" (tek günse yalnız o gün). */
export function describeRange(range: DateRange): string {
  const end = inclusiveEnd(range)
  if (startOfDay(range.from).getTime() === startOfDay(end).getTime()) return dayFmt.format(range.from)
  return `${dayFmt.format(range.from)} — ${dayFmt.format(end)}`
}

/** "01 Tem — 02 Eyl" */
export function describeRangeShort(range: DateRange): string {
  const end = inclusiveEnd(range)
  if (startOfDay(range.from).getTime() === startOfDay(end).getTime()) return dayShortFmt.format(range.from)
  return `${dayShortFmt.format(range.from)} — ${dayShortFmt.format(end)}`
}

/** Dönemin kaç gün sürdüğü (grafik kova genişliği önerisi için). */
export function rangeDays(range: DateRange): number {
  return Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / 86400000))
}

/** Dönem uzunluğuna göre önerilen kova genişliği (sunucudakiyle aynı kural). */
export function suggestGranularity(range: DateRange): 'day' | 'week' | 'month' {
  const days = rangeDays(range)
  if (days <= 45) return 'day'
  if (days <= 190) return 'week'
  return 'month'
}

/** `<input type="date">` değeri (yerel gün, saat kaymasız). */
export function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** `<input type="date">` değerinden yerel Date (UTC'ye kaymadan). */
export function fromDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/** Yüzde değişim; önceki 0 ise null (oran tanımsız). */
export function deltaPercent(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}
