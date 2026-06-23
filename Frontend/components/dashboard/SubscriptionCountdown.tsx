'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, ArrowUpRight, CalendarClock, Crown, Hourglass } from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { normalizeTenant } from '@/lib/apiMappers'
import type { ApiTenant } from '@/lib/types'

/**
 * Kurum yöneticisi dashboard'unun en üstünde duran CANLI abonelik/deneme sayacı.
 *
 * - Deneme (Trial): saniyesi saniyesine canlı geri sayım (Gün · Saat · Dakika · Saniye).
 * - Aylık abonelik: "Ay" hücresi her zaman yazılı; süre azaldıkça öne çıkan birim aya→güne→saate kayar.
 * - Yıllık abonelik: 12 aydan başlayıp aya göre düşer; bir ayın altına inince güne, son günde saate geçer.
 *
 * Sade/kibar tasarım: dashboard'ın açık kart diliyle uyumlu, tek canlı dokunuş (yumuşak nabız + akan rakam).
 * Bileşen kendi verisini çeker (currentTenant) ve yalnızca kendisi her saniye yeniden render olur.
 */

type Mode = 'trial' | 'monthly' | 'yearly'
type Urgency = 'calm' | 'warning' | 'critical'

interface Parts {
  months: number
  days: number
  hours: number
  minutes: number
  seconds: number
  totalMs: number
  totalDays: number
}

const MS_DAY = 86_400_000

function pad2(value: number): string {
  return String(Math.max(0, value)).padStart(2, '0')
}

// "...Utc" alanları EF round-trip sonrası saat dilimi taşımayabilir; taşımıyorsa UTC kabul et.
function parseUtcDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)
  const date = new Date(hasTz ? value : `${value}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

// from→to arasını takvim-doğru ay + gün + saat/dakika/saniye olarak ayrıştırır (canlı tikler).
function diffParts(from: Date, to: Date): Parts {
  const totalMs = to.getTime() - from.getTime()
  if (totalMs <= 0) {
    return { months: 0, days: 0, hours: 0, minutes: 0, seconds: 0, totalMs: 0, totalDays: 0 }
  }

  // Tam takvim aylarını sayarak ilerle (28/30/31 gün farklarını doğru yakalar).
  let months = 0
  const cursor = new Date(from)
  for (;;) {
    const next = new Date(cursor)
    next.setMonth(next.getMonth() + 1)
    if (next.getTime() <= to.getTime()) {
      cursor.setTime(next.getTime())
      months += 1
    } else {
      break
    }
  }

  let rem = to.getTime() - cursor.getTime()
  const days = Math.floor(rem / MS_DAY)
  rem -= days * MS_DAY
  const hours = Math.floor(rem / 3_600_000)
  rem -= hours * 3_600_000
  const minutes = Math.floor(rem / 60_000)
  rem -= minutes * 60_000
  const seconds = Math.floor(rem / 1_000)

  return { months, days, hours, minutes, seconds, totalMs, totalDays: totalMs / MS_DAY }
}

interface Theme {
  wash: string
  pill: string
  accent: string
  unit: string
  cell: string
  cellIdle: string
  num: string
  numIdle: string
  bar: string
  track: string
  dot: string
  cta: string
}

const THEMES: Record<Urgency, Theme> = {
  // Sakin — gül/bordo; abonelik güvende.
  calm: {
    wash: 'bg-[#ffe4ee]',
    pill: 'border-[#f0d9e2] bg-[#fff1f6] text-[#b14d6c]',
    accent: 'text-[#b14d6c]',
    unit: 'text-[#5d4a56]',
    cell: 'border-[#efe1e7] bg-[#fff8fa]',
    cellIdle: 'border-[#f3ebef] bg-[#fbf7f9]',
    num: 'text-[#2b1e29]',
    numIdle: 'text-[#cbb9c1]',
    bar: 'from-[#ecaec0] to-[#c05277]',
    track: 'bg-[#f5e7ec]',
    dot: 'bg-[#d98aa4]',
    cta: 'text-[#c05277] hover:text-[#a23f5c]',
  },
  // Uyarı — gold; son birkaç gün.
  warning: {
    wash: 'bg-[#ffeccd]',
    pill: 'border-[#efdfba] bg-[#fff8ea] text-[#a9772f]',
    accent: 'text-[#a9772f]',
    unit: 'text-[#6b5836]',
    cell: 'border-[#efe6d4] bg-[#fffaf0]',
    cellIdle: 'border-[#f3ecdd] bg-[#fdf9f1]',
    num: 'text-[#2b1e29]',
    numIdle: 'text-[#cdbfa6]',
    bar: 'from-[#e8cd92] to-[#c79a45]',
    track: 'bg-[#f3ead2]',
    dot: 'bg-[#d9b46d]',
    cta: 'text-[#a9772f] hover:text-[#8a6224]',
  },
  // Kritik — yumuşak kırmızı; son gün veya süre doldu.
  critical: {
    wash: 'bg-[#ffd9de]',
    pill: 'border-[#f3c9d3] bg-[#fff1f3] text-[#c0506a]',
    accent: 'text-[#c0506a]',
    unit: 'text-[#6b4750]',
    cell: 'border-[#efdde1] bg-[#fff6f7]',
    cellIdle: 'border-[#f3e6e9] bg-[#fdf6f7]',
    num: 'text-[#2b1e29]',
    numIdle: 'text-[#d3bcc1]',
    bar: 'from-[#eda0ab] to-[#c0506a]',
    track: 'bg-[#f6e3e7]',
    dot: 'bg-[#e08596]',
    cta: 'text-[#c0506a] hover:text-[#a23a52]',
  },
}

const MODE_META: Record<Mode, { label: string; icon: typeof Hourglass }> = {
  trial: { label: 'Deneme Süreniz', icon: Hourglass },
  monthly: { label: 'Aylık Abonelik', icon: CalendarClock },
  yearly: { label: 'Yıllık Abonelik', icon: Crown },
}

interface UnitCard {
  key: string
  label: string
  value: number
}

function TimeCell({ card, theme, idle }: { card: UnitCard; theme: Theme; idle: boolean }) {
  return (
    <div
      className={`flex min-w-[50px] flex-col items-center rounded-[14px] border px-2.5 py-2 transition-colors duration-500 sm:min-w-[58px] sm:px-3 ${
        idle ? theme.cellIdle : theme.cell
      }`}
    >
      <div className="relative h-[26px] w-full overflow-hidden sm:h-[30px]">
        <AnimatePresence initial={false}>
          <motion.span
            key={card.value}
            initial={{ opacity: 0, y: 7 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -7 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className={`absolute inset-0 grid place-items-center font-display text-[20px] font-semibold leading-none tabular-nums sm:text-[24px] ${
              idle ? theme.numIdle : theme.num
            }`}
          >
            {pad2(card.value)}
          </motion.span>
        </AnimatePresence>
      </div>
      <span className={`mt-1 text-[9px] font-semibold uppercase tracking-[0.13em] ${idle ? 'text-[#c4b3bb]' : 'text-[#9a8590]'}`}>
        {card.label}
      </span>
    </div>
  )
}

export default function SubscriptionCountdown({ tenantId }: { tenantId?: string }) {
  const { data } = useApiQuery<ApiTenant>(
    () => adminApi.currentTenant<ApiTenant>(tenantId),
    [tenantId],
    { initialData: null, clearOnError: false },
  )

  // Saniyede bir tikleyen "şimdi". SSR ↔ client uyumsuzluğu olmaması için mount sonrası başlar.
  const [now, setNow] = useState<number | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    setNow(Date.now())
    intervalRef.current = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const tenant = useMemo(() => (data ? normalizeTenant(data) : null), [data])

  // Hangi tarihe ve hangi modda geri sayıyoruz?
  const target = useMemo(() => {
    if (!tenant) return null
    const status = (tenant.status || '').toString().toLowerCase()
    const trialEnd = parseUtcDate(tenant.trialEndsAt)
    const subEnd = parseUtcDate(tenant.subscriptionEndsAt)

    if (status === 'trial' && trialEnd) {
      return { mode: 'trial' as Mode, end: trialEnd, periodMs: 14 * MS_DAY }
    }
    if (subEnd) {
      const yearly = (tenant.subscriptionPeriod || '').toLowerCase() === 'yearly'
      const start = new Date(subEnd)
      if (yearly) start.setFullYear(start.getFullYear() - 1)
      else start.setMonth(start.getMonth() - 1)
      return {
        mode: (yearly ? 'yearly' : 'monthly') as Mode,
        end: subEnd,
        periodMs: subEnd.getTime() - start.getTime(),
      }
    }
    if (trialEnd) {
      return { mode: 'trial' as Mode, end: trialEnd, periodMs: 14 * MS_DAY }
    }
    return null
  }, [tenant])

  const view = useMemo(() => {
    if (!target || now === null) return null
    const current = new Date(now)
    const parts = diffParts(current, target.end)
    const expired = parts.totalMs <= 0

    // Aciliyet: son gün/dolmuş → kritik, ≤3 gün → uyarı, aksi halde sakin.
    const urgency: Urgency = expired || parts.totalDays < 1 ? 'critical' : parts.totalDays <= 3 ? 'warning' : 'calm'

    // Kart birimleri: ücretli planda "Ay" daima yazılı; deneme aya ulaşmadıkça Gün'den başlar.
    const showMonths = target.mode !== 'trial' || parts.months >= 1
    const ordered: UnitCard[] = [
      ...(showMonths ? [{ key: 'ay', label: 'Ay', value: parts.months }] : []),
      { key: 'gun', label: 'Gün', value: parts.days },
      { key: 'saat', label: 'Saat', value: parts.hours },
      { key: 'dakika', label: 'Dakika', value: parts.minutes },
      { key: 'saniye', label: 'Saniye', value: parts.seconds },
    ]
    // İlk sıfır olmayan birime kadar olan hücreler "tükenmiş" sayılır (soluk) → vurgu küçük birime kayar.
    let firstActive = ordered.findIndex((unit) => unit.value > 0)
    if (firstActive === -1) firstActive = ordered.length - 1
    const dominant = ordered[firstActive]

    const elapsed = target.periodMs > 0 ? ((target.periodMs - parts.totalMs) / target.periodMs) * 100 : 100
    const percent = Math.max(0, Math.min(100, Math.round(elapsed)))

    return { parts, expired, urgency, cards: ordered, firstActive, dominant, percent }
  }, [target, now])

  // Veri yokken / sayılacak bir tarih yokken hiçbir şey gösterme.
  if (!target || !view) return null

  const theme = THEMES[view.urgency]
  const meta = MODE_META[target.mode]
  const Icon = meta.icon
  const endLabel = new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(target.end)

  const subline = view.expired
    ? 'Erişiminiz duraklatıldı. Kesintisiz devam için paketinizi yenileyin.'
    : target.mode === 'trial'
      ? `Deneme süreniz ${endLabel} tarihinde sona eriyor.`
      : target.mode === 'yearly'
        ? `Yıllık aboneliğiniz ${endLabel} tarihine kadar geçerli.`
        : `Aylık aboneliğiniz ${endLabel} tarihinde yenilenmeli.`

  const ctaLabel = view.urgency === 'calm' ? 'Paketleri gör' : 'Hemen yenile'

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-[24px] border border-[#efe1e7] bg-white/95 px-5 py-5 shadow-[0_18px_50px_-34px_rgba(120,71,88,0.45)] sm:px-6"
    >
      <span aria-hidden className={`pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full opacity-50 blur-3xl ${theme.wash}`} />

      <div className="relative">
        {/* üst şerit: mod rozeti + canlı göstergesi */}
        <div className="flex items-center justify-between gap-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${theme.pill}`}>
            <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
            {meta.label}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#9a8590]">
            <span className={`h-1.5 w-1.5 rounded-full ${theme.dot} ${view.expired ? '' : 'animate-pulse-dot'}`} />
            {view.expired ? 'Süre doldu' : 'Canlı'}
          </span>
        </div>

        <div className="mt-4 grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
          {/* kimlik + başlık */}
          <div className="min-w-0">
            {view.expired ? (
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[12px] border border-[#f3c9d3] bg-[#fff1f3] text-[#c0506a]">
                  <AlertTriangle className="h-[18px] w-[18px]" strokeWidth={1.8} />
                </span>
                <div>
                  <div className="font-display text-[24px] font-semibold leading-tight text-[#2b1e29] sm:text-[27px]">Süreniz doldu</div>
                  <p className="mt-1 max-w-md text-[12px] leading-relaxed text-[#8a7480]">{subline}</p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className={`font-display text-[34px] font-semibold leading-none tabular-nums sm:text-[40px] ${theme.accent}`}>
                    {view.dominant.value}
                  </span>
                  <span className={`font-display text-[16px] font-medium sm:text-[18px] ${theme.unit}`}>
                    {view.dominant.label.toLocaleLowerCase('tr-TR')}
                  </span>
                  <span className="text-[12px] text-[#9a8590]">kaldı</span>
                </div>
                <p className="mt-2 max-w-md text-[12px] leading-relaxed text-[#8a7480]">{subline}</p>
              </>
            )}

            <Link href="/admin/paket" className={`group mt-3.5 inline-flex items-center gap-1 text-[12px] font-semibold transition-colors ${theme.cta}`}>
              {ctaLabel}
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={2} />
            </Link>
          </div>

          {/* canlı geri sayım hücreleri */}
          {!view.expired && (
            <div className="flex flex-wrap items-stretch gap-2 lg:justify-end">
              {view.cards.map((card, index) => (
                <TimeCell key={card.key} card={card} theme={theme} idle={index < view.firstActive} />
              ))}
            </div>
          )}
        </div>

        {/* ilerleme çubuğu */}
        <div className="mt-5 flex items-center gap-3">
          <div className={`h-1.5 flex-1 overflow-hidden rounded-full ${theme.track}`}>
            <motion.div
              className={`h-full rounded-full bg-gradient-to-r ${theme.bar}`}
              initial={{ width: 0 }}
              animate={{ width: `${view.percent}%` }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-[#9a8590]">%{view.percent}</span>
        </div>
      </div>
    </motion.section>
  )
}
