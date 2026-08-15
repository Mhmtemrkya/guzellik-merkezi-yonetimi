'use client'

import { useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  Boxes,
  CalendarClock,
  ChevronDown,
  Layers,
  Search,
  Sparkles,
  UserCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import CatalogPicker, { type PickerItem } from '@/components/dashboard/CatalogPicker'
import AnchoredPopover from '@/components/dashboard/AnchoredPopover'
import { formatTL } from '@/lib/apiMappers'
import type { PackageCustomerBreakdown, PackageSeller } from '@/lib/types'

/** Seçili paket/hizmet — boşsa rapor tüm satışları kapsar. */
export interface BreakdownItemSelection {
  kind: 'package' | 'service'
  id: string
  name: string
}

/**
 * Paket Raporu detay bloğu: KPI kartlarının altında MÜŞTERİ kırılımını gösterir —
 * müşterinin kaç taksidi var, ne kadar ödemiş, kaç seansı kalmış, kim satmış.
 *
 * PAKET / HİZMET SEÇİCİSİ: bir paket ya da hizmet seçilirse liste yalnız onu satın alan
 * müşterilere daralır ve rakamlar SUNUCUDA o satışa göre yeniden hesaplanır. Süzmeyi istemcide
 * yapmak yanıltıcı olurdu: müşteri satırındaki taksit/ödeme/seans toplamları o müşterinin TÜM
 * satışlarını kapsar, seçilen paketinkini değil.
 */
export default function PackageReportBreakdown({
  customers,
  loading = false,
  packageItems = [],
  serviceItems = [],
  selectedItem = null,
  onSelectItem,
}: {
  customers: PackageCustomerBreakdown[]
  loading?: boolean
  /** Seçicideki paketler (katalogdan). */
  packageItems?: PickerItem[]
  /** Seçicideki hizmetler (katalogdan). */
  serviceItems?: PickerItem[]
  selectedItem?: BreakdownItemSelection | null
  onSelectItem?: (next: BreakdownItemSelection | null) => void
}) {
  return (
    <div className={`rounded-[22px] border border-[#EAD8DF] bg-white p-4 transition-opacity sm:p-5 ${loading ? 'opacity-60' : 'opacity-100'}`}>
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-[11px] bg-[#A5556E] text-white shadow-[0_10px_20px_-14px_rgba(42,32,39,0.8)]">
          <Layers className="h-4 w-4" strokeWidth={1.7} />
        </span>
        <div>
          <div className="font-display text-[14px] font-semibold text-[#2A2027]">Satış Detayı</div>
          <div className="text-[11px] text-[#5A4B53]">
            Müşteri kırılımı
            {selectedItem ? <span className="font-semibold text-[#8C4460]"> · {selectedItem.name}</span> : ' · tüm satışlar'}
          </div>
        </div>
      </div>

      {/* SEÇİCİ ÖNE ÇIKAR: başlık satırındaki küçük düğme gözden kaçıyordu. Kendi şeridinde,
          bloğun ana eylemi gibi durur — seçili değilken çağrı, seçiliyken durum bildirir. */}
      {onSelectItem && (
        <ItemFilter
          packageItems={packageItems}
          serviceItems={serviceItems}
          value={selectedItem}
          onChange={onSelectItem}
        />
      )}

      {customers.length === 0 ? (
        <div className="mt-4 rounded-[16px] border border-dashed border-[#DFD9DC] bg-[#F7F6F6] px-4 py-8 text-center text-[12px] text-[#5A4B53]">
          {selectedItem ? `Seçili dönemde "${selectedItem.name}" satışı bulunmuyor.` : 'Seçili dönemde satış bulunmuyor.'}
        </div>
      ) : (
        <div className="mt-4">
          <CustomerList customers={customers} />
        </div>
      )}
    </div>
  )
}

// -------------------------------------------------------- paket/hizmet seçici ---

/**
 * Açılır seçici: paket ↔ hizmet sekmesi + aramalı katalog listesi.
 * Liste her zaman açık dursaydı blok başlığı bir ekran boyunca uzardı; düğme yalnız seçimi yazar.
 */
function ItemFilter({
  packageItems,
  serviceItems,
  value,
  onChange,
}: {
  packageItems: PickerItem[]
  serviceItems: PickerItem[]
  value: BreakdownItemSelection | null
  onChange: (next: BreakdownItemSelection | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'package' | 'service'>(value?.kind ?? 'package')
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // Dışarı tıklama + ESC artık AnchoredPopover'ın işi (panel <body>'ye portal'lanıyor).

  const items = kind === 'package' ? packageItems : serviceItems

  return (
    <div ref={wrapRef} className="relative mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`group flex w-full items-center gap-3 rounded-[16px] border-2 px-3.5 py-3 text-left transition-all ${
          value
            ? 'border-[#BE7690] bg-[linear-gradient(100deg,#FBEAF0,#F6DFE6)] shadow-[0_16px_34px_-26px_rgba(87,39,61,0.9)]'
            : 'border-dashed border-[#D9AEBE] bg-[#FFF9FB] hover:border-[#BE7690] hover:bg-[#FBEAF0]'
        }`}
      >
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[13px] text-white shadow-[0_12px_24px_-16px_rgba(42,32,39,0.9)] ${value ? 'bg-[#8C4460]' : 'bg-[#A5556E]'}`}>
          {value?.kind === 'service'
            ? <Sparkles className="h-5 w-5" strokeWidth={1.8} />
            : <Boxes className="h-5 w-5" strokeWidth={1.8} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-[#A5556E]">
            {value ? (value.kind === 'service' ? 'Seçili hizmet' : 'Seçili paket') : 'Paket / hizmet seç'}
          </span>
          <span className="mt-0.5 block truncate font-display text-[14.5px] font-semibold text-[#2A2027]">
            {value ? value.name : 'Tüm satışlar gösteriliyor'}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-[#5A4B53]">
            {value
              ? 'Aşağıdaki liste yalnız bu ürünü alan müşterileri gösteriyor'
              : 'Tek bir paket ya da hizmet seçerek listeyi daraltın'}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {value && (
            <span
              role="button"
              tabIndex={0}
              title="Seçimi kaldır"
              aria-label="Seçimi kaldır"
              onClick={(e) => { e.stopPropagation(); onChange(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onChange(null) } }}
              className="grid h-8 w-8 cursor-pointer place-items-center rounded-full border border-[#E3C6D1] bg-white text-[#8E7882] transition-colors hover:border-[#BE7690] hover:text-[#8C4460]"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </span>
          )}
          <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors ${
            value ? 'bg-white text-[#8C4460]' : 'bg-[#A5556E] text-white group-hover:bg-[#8C4460]'
          }`}>
            {value ? 'Değiştir' : 'Seç'}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={2.2} />
          </span>
        </span>
      </button>

      {/* Panel karta GÖMÜLÜ DEĞİL: pano kart kabuğu `overflow-hidden` taşıdığı için buradaki
          `absolute` bir menü kartın alt kenarında kırpılıyordu (z-index bunu aşamaz). */}
      <AnchoredPopover open={open} anchorRef={wrapRef} onClose={() => setOpen(false)} width={420} align="right" gap={8}>
        <div className="p-3">
            <div className="inline-flex rounded-full border border-[#E4DEE0] bg-[#F7F6F6] p-0.5">
              {(
                [
                  ['package', 'Paketler'],
                  ['service', 'Hizmetler'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setKind(key)}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                    kind === key ? 'bg-[#A5556E] text-white' : 'text-[#5A4B53] hover:text-[#8C4460]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <CatalogPicker
              items={items}
              value={value?.kind === kind ? value.id : ''}
              clearable
              emptyText={kind === 'package' ? 'Paket bulunamadı.' : 'Hizmet bulunamadı.'}
              onChange={(id) => {
                if (!id) { onChange(null); return }
                const picked = items.find((i) => i.id === id)
                onChange({ kind, id, name: picked?.name || (kind === 'package' ? 'Paket' : 'Hizmet') })
                setOpen(false)
              }}
            />
        </div>
      </AnchoredPopover>
    </div>
  )
}

/**
 * "Kim sattı" şeridi — müşteriye yapılan satışların personel bazlı payı.
 * Satış personeli atanmamış (eski / otomatik onaylanmış) kayıtlar "Belirtilmemiş" altında toplanır.
 */
function SellerStrip({ sellers }: { sellers: PackageSeller[] }) {
  if (sellers.length === 0) return null
  const total = sellers.reduce((s, x) => s + x.amount, 0)

  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#74616A]">
        <UserCheck className="h-3.5 w-3.5 text-[#A5556E]" strokeWidth={1.9} /> Kim sattı
      </div>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {sellers.map((s, i) => {
          const share = total > 0 ? Math.round((s.amount / total) * 100) : 0
          return (
            <div
              key={s.staffMemberId ?? `none-${i}`}
              className="min-w-[168px] shrink-0 rounded-[14px] border border-[#E4DEE0] bg-white px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[linear-gradient(140deg,#C57B92,#8C4460)] text-[10px] font-bold text-white">
                  {initials(s.staffName)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold text-[#2A2027]">{s.staffName}</span>
                  <span className="block text-[10px] text-[#5A4B53]">
                    {s.soldCount} satış · {s.customerCount} müşteri
                  </span>
                </span>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <span className="font-display text-[13px] font-bold text-[#2A2027]">{formatTL(Math.round(s.amount))}</span>
                <span className="text-[10px] font-semibold text-[#8C4460]">%{share}</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#EFEAEC]">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#D69CAF,#A5556E)]"
                  style={{ width: `${Math.max(4, share)}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** "Ayşe YILMAZ" → "AY" (avatar rozeti). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase('tr')
  return (parts[0][0] + parts[parts.length - 1][0]).toLocaleUpperCase('tr')
}

// ----------------------------------------------------------------- müşteri ---

const PAGE_SIZE = 8

function CustomerList({ customers }: { customers: PackageCustomerBreakdown[] }) {
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [open, setOpen] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const s = q.trim().toLocaleLowerCase('tr')
    if (!s) return customers
    return customers.filter(
      (c) => c.customerName.toLocaleLowerCase('tr').includes(s) || c.packageNames.some((p) => p.toLocaleLowerCase('tr').includes(s)),
    )
  }, [customers, q])
  const visible = filtered.slice(0, limit)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-[12px] border border-[#E4DEE0] bg-[#F7F6F6] px-3 py-2">
        <Search className="h-3.5 w-3.5 text-[#A5556E]" strokeWidth={1.9} />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setLimit(PAGE_SIZE)
          }}
          placeholder="Müşteri ya da paket adı ara"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-[#2A2027] outline-none placeholder:text-[#8E7882]"
        />
        <span className="shrink-0 text-[10px] font-semibold text-[#5A4B53]">{filtered.length} müşteri</span>
      </div>

      <div className="space-y-2">
        {visible.map((c) => {
          const isOpen = open === c.customerId
          const paidPct = c.totalAmount > 0 ? Math.min(100, Math.round((c.paidAmount / c.totalAmount) * 100)) : 0
          const sessionPct = c.sessionsTotal > 0 ? Math.min(100, Math.round((c.sessionsUsed / c.sessionsTotal) * 100)) : 0
          return (
            <div key={c.customerId} className="overflow-hidden rounded-[16px] border border-[#E4DEE0] bg-[#F7F6F6]">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : c.customerId)}
                className="flex w-full flex-wrap items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-[#F6DFE6]"
              >
                <ChevronDown className={`h-4 w-4 shrink-0 text-[#A5556E] transition-transform ${isOpen ? 'rotate-0' : '-rotate-90'}`} strokeWidth={2} />
                <span className="min-w-[150px] flex-1">
                  <span className="block truncate text-[13px] font-semibold text-[#2A2027]">{c.customerName}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-[#5A4B53]">
                    {c.accountCount} satış · {c.packageNames[0] || 'Paket'}
                    {c.packageNames.length > 1 ? ` +${c.packageNames.length - 1}` : ''}
                  </span>
                  {c.sellers.length > 0 && (
                    <span className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-[#8C4460]">
                      <UserCheck className="h-3 w-3 shrink-0" strokeWidth={2} />
                      <span className="truncate">
                        Satan: {c.sellers[0].staffName}
                        {c.sellers.length > 1 ? ` +${c.sellers.length - 1}` : ''}
                      </span>
                    </span>
                  )}
                </span>
                <MiniStat label="Taksit" value={`${c.paidInstallmentCount}/${c.installmentCount}`} tone="rose" />
                <MiniStat label="Ödenen" value={formatTL(Math.round(c.paidAmount))} tone="mint" />
                <MiniStat label="Kalan" value={formatTL(Math.round(c.remainingAmount))} tone="gold" />
                <MiniStat label="Seans" value={`${c.sessionsRemaining}/${c.sessionsTotal}`} tone="violet" />
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-3 border-t border-[#EFEAEC] bg-white px-3.5 py-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <ProgressRow
                          icon={Wallet}
                          label="Tahsilat"
                          value={`${formatTL(Math.round(c.paidAmount))} / ${formatTL(Math.round(c.totalAmount))}`}
                          pct={paidPct}
                          barClass="bg-[linear-gradient(90deg,#34B37E,#15694A)]"
                        />
                        <ProgressRow
                          icon={Activity}
                          label="Seans kullanımı"
                          value={`${c.sessionsUsed} / ${c.sessionsTotal} · ${c.sessionsRemaining} kalan`}
                          pct={sessionPct}
                          barClass="bg-[linear-gradient(90deg,#D69CAF,#A5556E)]"
                        />
                      </div>

                      {/* Kim sattı — müşteri kapsamındaki satışların personel payı. */}
                      <SellerStrip sellers={c.sellers} />

                      <div className="flex flex-wrap gap-2">
                        <Chip icon={Users} text={`${c.installmentCount} taksit · ${c.paidInstallmentCount} ödendi`} />
                        {c.nextDueDate && (
                          <Chip
                            icon={CalendarClock}
                            text={`Sıradaki vade ${formatDate(c.nextDueDate)} · ${formatTL(Math.round(c.nextDueAmount))}`}
                          />
                        )}
                        {c.overdueAmount > 0 && (
                          <Chip
                            icon={AlertTriangle}
                            danger
                            text={`${c.overdueInstallmentCount} gecikmiş taksit · ${formatTL(Math.round(c.overdueAmount))}`}
                          />
                        )}
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {c.packageNames.map((p) => (
                          <span key={p} className="rounded-full border border-[#E4DEE0] bg-white px-2.5 py-1 text-[10px] font-semibold text-[#5A4B53]">
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}

        {visible.length === 0 && (
          <div className="rounded-[16px] border border-dashed border-[#DFD9DC] bg-[#F7F6F6] px-4 py-6 text-center text-[12px] text-[#5A4B53]">
            Aramaya uygun müşteri bulunamadı.
          </div>
        )}
      </div>

      {filtered.length > visible.length && (
        <button
          type="button"
          onClick={() => setLimit((v) => v + PAGE_SIZE)}
          className="mx-auto flex w-max items-center gap-1 rounded-full border border-[#E4DEE0] bg-white px-4 py-1.5 text-[11px] font-semibold text-[#8C4460] transition-colors hover:border-[#BE7690] hover:bg-[#F6DFE6]"
        >
          {filtered.length - visible.length} müşteri daha göster
        </button>
      )}
    </div>
  )
}

// -------------------------------------------------------------- yardımcılar ---

const MINI_TONES: Record<string, string> = {
  rose: 'border-[#DFAFBF] bg-[#F6DFE6] text-[#7A3450]',
  mint: 'border-[#7FD3AC] bg-[#DFF3EA] text-[#15694A]',
  gold: 'border-[#F6B7CA] bg-[#FDE4EB] text-[#BE3960]',
  violet: 'border-[#CBC1C6] bg-[#EFECEE] text-[#4E4048]',
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: keyof typeof MINI_TONES }) {
  return (
    <span className={`min-w-[86px] rounded-[12px] border px-2.5 py-1.5 text-center ${MINI_TONES[tone]}`}>
      <span className="block text-[10px] font-semibold uppercase tracking-wide">{label}</span>
      <span className="mt-0.5 block text-[12px] font-bold">{value}</span>
    </span>
  )
}

function ProgressRow({
  icon: Icon,
  label,
  value,
  pct,
  barClass,
}: {
  icon: typeof Wallet
  label: string
  value: string
  pct: number
  barClass: string
}) {
  return (
    <div className="rounded-[14px] border border-[#E4DEE0] bg-[#F7F6F6] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#3E343A]">
          <Icon className="h-3.5 w-3.5 text-[#A5556E]" strokeWidth={1.9} /> {label}
        </span>
        <span className="text-[11px] font-bold text-[#2A2027]">%{pct}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#EFEAEC]">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
      <div className="mt-1.5 text-[11px] text-[#5A4B53]">{value}</div>
    </div>
  )
}

function Chip({ icon: Icon, text, danger = false }: { icon: typeof Wallet; text: string; danger?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
        danger ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-[#E4DEE0] bg-white text-[#5A4B53]'
      }`}
    >
      <Icon className="h-3 w-3" strokeWidth={1.9} /> {text}
    </span>
  )
}

/** "2026-08-15" → "15 Ağu 2026". */
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })
}
