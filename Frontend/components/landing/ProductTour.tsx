'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * HERO'NUN MERKEZİ: panelin kendi ekranlarında gezdiren ürün turu.
 *
 * Sol sütunda modül listesi, sağda o modülün ekranı durur. Tur kendiliğinden ilerler; kullanıcı
 * bir modüle tıkladığında otomatik ilerleme DURUR (kontrolü kullanıcıya bırakır — bir daha
 * beklenmedik şekilde kaymaz). Ekranlar gerçek panelin yüzey dilinde çizilir: aynı kart yarıçapı,
 * aynı gül aksan, aynı tablo/rozet ritmi.
 */

const MODULES = [
  { id: 'dashboard', label: 'Genel Bakış' },
  { id: 'randevu', label: 'Randevular' },
  { id: 'musteri', label: 'Danışanlar' },
  { id: 'paket', label: 'Paket & Hizmet' },
  { id: 'portal', label: 'Online Portal' },
  { id: 'rapor', label: 'Raporlar' },
] as const

type ModuleId = (typeof MODULES)[number]['id']

export default function ProductTour() {
  const [active, setActive] = useState<ModuleId>('dashboard')
  const [autoplay, setAutoplay] = useState(true)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!autoplay) return
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    timer.current = setInterval(() => {
      setActive((cur) => {
        const i = MODULES.findIndex((m) => m.id === cur)
        return MODULES[(i + 1) % MODULES.length].id
      })
    }, 3200)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [autoplay])

  const pick = (id: ModuleId) => {
    setAutoplay(false)
    setActive(id)
  }

  return (
    <div className="rounded-[22px] border border-[#EEC9D7] bg-white/70 p-2.5 shadow-[0_30px_80px_-46px_rgba(150,78,104,0.55)] backdrop-blur-sm">
      <div className="rounded-[16px] border border-[#F2DFE7] bg-[#FFF7FA] px-3 py-2 text-center text-[11.5px] text-[#705A66]">
        {autoplay ? 'Modüller sırayla geçiyor — durdurmak için birine dokunun' : 'Modülü seçtiniz · listeden gezinebilirsiniz'}
      </div>

      <div className="mt-2.5 grid gap-2.5 sm:grid-cols-[142px_minmax(0,1fr)]">
        {/* Modül listesi */}
        <ol className="flex gap-1.5 overflow-x-auto sm:block sm:space-y-1 sm:overflow-visible">
          {MODULES.map((m, i) => {
            const on = m.id === active
            return (
              <li key={m.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => pick(m.id)}
                  aria-current={on ? 'true' : undefined}
                  className={`flex w-full items-center gap-2 rounded-[11px] px-2.5 py-2 text-left transition-colors ${
                    on ? 'bg-[#FFDCE8] text-[#8E3F5B]' : 'text-[#705A66] hover:bg-[#FFF0F5]'
                  }`}
                >
                  <span
                    className={`text-[10px] tabular-nums ${on ? 'text-[#EF6F94]' : 'text-[#B79AA6]'}`}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="whitespace-nowrap text-[12.5px] font-medium">{m.label}</span>
                </button>
              </li>
            )
          })}
        </ol>

        {/* Ekran — sabit yükseklik: modül değişince kart zıplamaz. */}
        <div className="min-h-[300px] rounded-[16px] border border-[#F2DFE7] bg-white p-3.5 sm:min-h-[330px]">
          {active === 'dashboard' && <DashboardScreen />}
          {active === 'randevu' && <AppointmentScreen />}
          {active === 'musteri' && <CustomerScreen />}
          {active === 'paket' && <PackageScreen />}
          {active === 'portal' && <PortalScreen />}
          {active === 'rapor' && <ReportScreen />}
        </div>
      </div>
    </div>
  )
}

/* --- ekranlar ------------------------------------------------------ */

function ScreenHead({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="text-[13.5px] font-semibold text-[#352432]">{title}</h3>
      <span className="text-[11px] text-[#705A66]">{hint}</span>
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[11px] border border-[#F2DFE7] bg-[#FFF7FA] px-2.5 py-2">
      <div className="text-[9.5px] uppercase tracking-[0.12em] text-[#705A66]">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-[#352432]" style={{ fontFamily: 'var(--font-mono)' }}>
        {value}
      </div>
    </div>
  )
}

function DashboardScreen() {
  const bars = [38, 52, 44, 68, 58, 76, 64]
  const days = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz']
  return (
    <div className="space-y-3">
      <ScreenHead title="Genel Bakış" hint="Bugün" />
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="Randevu" value="32" />
        <Kpi label="Ciro" value="₺42.500" />
        <Kpi label="Doluluk" value="%76" />
      </div>
      <div className="rounded-[12px] border border-[#F2DFE7] p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[10.5px] text-[#705A66]">Haftalık gelir</span>
          <span className="text-[10.5px] text-emerald-600">+%18</span>
        </div>
        <div className="mt-2.5 flex h-[104px] items-end gap-1.5">
          {bars.map((h, i) => (
            <div key={i} className="flex-1 rounded-t-[3px] bg-gradient-to-t from-[#FFDCE8] to-[#EF6F94]" style={{ height: `${h}%` }} />
          ))}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          {days.map((d) => (
            <span key={d} className="flex-1 text-center text-[9.5px] text-[#B79AA6]">{d}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

function AppointmentScreen() {
  const rows = [
    ['09:00', 'Elif Aydın', 'Lazer epilasyon', 'Tamamlandı'],
    ['10:30', 'Ayşe Demir', 'Cilt bakımı', 'İşlemde'],
    ['11:15', 'Merve Şahin', 'Bölgesel incelme', 'Bekliyor'],
    ['12:00', 'Zeynep Ateş', 'Kaş tasarımı', 'Bekliyor'],
  ]
  const tone: Record<string, string> = {
    'Tamamlandı': 'bg-emerald-50 text-emerald-700',
    'İşlemde': 'bg-[#FFDCE8] text-[#8E3F5B]',
    'Bekliyor': 'bg-amber-50 text-amber-700',
  }
  return (
    <div className="space-y-3">
      <ScreenHead title="Randevu takvimi" hint="Çakışmasız planlama" />
      <ul className="divide-y divide-[#F6E7EE]">
        {rows.map(([time, name, service, state]) => (
          <li key={time} className="flex items-center gap-2.5 py-2">
            <span className="w-[42px] shrink-0 text-[11.5px] tabular-nums text-[#705A66]" style={{ fontFamily: 'var(--font-mono)' }}>
              {time}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-[#352432]">{name}</span>
              <span className="block truncate text-[11px] text-[#705A66]">{service}</span>
            </span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${tone[state]}`}>{state}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CustomerScreen() {
  return (
    <div className="space-y-3">
      <ScreenHead title="Danışan kartı" hint="360° geçmiş" />
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-[#FFDCE8] text-[12px] font-semibold text-[#8E3F5B]">MŞ</span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-[#352432]">Merve Şahin</div>
          <div className="text-[11px] tabular-nums text-[#705A66]" style={{ fontFamily: 'var(--font-mono)' }}>0532 ••• •• 47</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {['Lazer paketi', 'Onam imzalı', 'KVKK onaylı'].map((t) => (
          <span key={t} className="rounded-full border border-[#EEC9D7] bg-[#FFF7FA] px-2 py-0.5 text-[10.5px] text-[#4A3A44]">{t}</span>
        ))}
      </div>
      <dl className="space-y-1.5 border-t border-[#F2DFE7] pt-2.5 text-[11.5px]">
        {[['Son işlem', '12 Tem · İncelme'], ['Kalan seans', '2'], ['Açık borç', '₺1.800']].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-[#705A66]">{k}</dt>
            <dd className="tabular-nums text-[#352432]" style={{ fontFamily: 'var(--font-mono)' }}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function PackageScreen() {
  return (
    <div className="space-y-3">
      <ScreenHead title="Paket & seans" hint="Otomatik düşüm" />
      <div className="rounded-[12px] border border-[#F2DFE7] p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[12.5px] font-medium text-[#352432]">Lazer epilasyon</span>
          <span className="text-[11px] text-[#705A66]">8 seanslık</span>
        </div>
        <div className="mt-2.5 flex gap-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <span
              key={i}
              className={`h-6 flex-1 rounded-[4px] border ${i < 6 ? 'border-[#EF6F94] bg-[#EF6F94]' : 'border-dashed border-[#EEC9D7] bg-white'}`}
            />
          ))}
        </div>
        <div className="mt-2.5 flex justify-between border-t border-[#F2DFE7] pt-2 text-[11.5px]">
          <span className="text-[#705A66]">Kalan</span>
          <span className="font-semibold text-[#EF6F94]" style={{ fontFamily: 'var(--font-mono)' }}>2 seans</span>
        </div>
      </div>
      <div className="rounded-[11px] bg-[#FFF0F5] px-3 py-2 text-[11px] leading-relaxed text-[#4A3A44]">
        Randevu tamamlanınca doğru paketten bir seans düşer; iptalde aynı pakete geri yazılır.
      </div>
    </div>
  )
}

function PortalScreen() {
  return (
    <div className="space-y-3">
      <ScreenHead title="Online randevu portalı" hint="7/24 danışan erişimi" />
      <div className="grid grid-cols-4 gap-1.5">
        {['10:00', '10:45', '11:30', '12:15', '13:00', '13:45', '14:30', '15:15'].map((t, i) => (
          <span
            key={t}
            className={`rounded-[9px] border px-1 py-1.5 text-center text-[10.5px] tabular-nums ${
              i === 2 ? 'border-[#EF6F94] bg-[#EF6F94] text-white' : 'border-[#EEC9D7] bg-white text-[#4A3A44]'
            }`}
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {t}
          </span>
        ))}
      </div>
      <div className="rounded-[11px] border border-[#F2DFE7] bg-[#FFF7FA] px-3 py-2.5">
        <div className="text-[11.5px] font-medium text-[#352432]">11:30 · Cilt bakımı</div>
        <div className="mt-0.5 text-[11px] text-[#705A66]">Onay bekleniyor · WhatsApp&apos;tan hatırlatma gider</div>
      </div>
    </div>
  )
}

function ReportScreen() {
  const rows: Array<[string, string, number]> = [
    ['Lazer epilasyon', '₺186.400', 82],
    ['Cilt bakımı', '₺124.900', 58],
    ['Bölgesel incelme', '₺78.200', 36],
    ['Kaş & kirpik', '₺38.500', 18],
  ]
  return (
    <div className="space-y-3">
      <ScreenHead title="Hizmet performansı" hint="Son 30 gün" />
      <ul className="space-y-2.5">
        {rows.map(([name, amount, pct]) => (
          <li key={name}>
            <div className="flex items-baseline justify-between text-[11.5px]">
              <span className="text-[#4A3A44]">{name}</span>
              <span className="tabular-nums text-[#352432]" style={{ fontFamily: 'var(--font-mono)' }}>{amount}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-[#FFECF2]">
              <div className="h-full rounded-full bg-[#EF6F94]" style={{ width: `${pct}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
