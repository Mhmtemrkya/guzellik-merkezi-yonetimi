'use client'

import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  Layers,
  Search,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react'
import { formatTL } from '@/lib/apiMappers'
import type { PackageCategoryBreakdown, PackageCustomerBreakdown, PackageSeller } from '@/lib/types'

/**
 * Paket Raporu detay bloğu: KPI kartlarının altında iki görünüm sunar.
 *  • Kategori kırılımı → hangi kategoride hangi hizmet kaç satış / kaç seans / ne kadar tutar.
 *  • Müşteri detayı   → müşterinin kaç taksidi var, ne kadar ödemiş, kaç seansı kalmış.
 * Veri backend'de dönem filtresine (günlük/aylık/yıllık) göre hesaplanır.
 */
export default function PackageReportBreakdown({
  categories,
  customers,
  loading = false,
}: {
  categories: PackageCategoryBreakdown[]
  customers: PackageCustomerBreakdown[]
  loading?: boolean
}) {
  const [view, setView] = useState<'category' | 'customer'>('category')

  const hasData = categories.length > 0 || customers.length > 0

  return (
    <div className={`rounded-[22px] border border-[#eadde3] bg-white/95 p-4 transition-opacity sm:p-5 ${loading ? 'opacity-60' : 'opacity-100'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-[11px] border border-[#f0d9e2] bg-[#fff1f6] text-[#c05277]">
            <Layers className="h-4 w-4" strokeWidth={1.7} />
          </span>
          <div>
            <div className="font-display text-[14px] font-semibold text-[#2f2230]">Satış Detayı</div>
            <div className="text-[11px] text-[#705a66]">Kategori · hizmet · müşteri kırılımı</div>
          </div>
        </div>
        <div className="inline-flex rounded-full border border-[#efe1e7] bg-[#fff8fa] p-0.5">
          {(
            [
              ['category', 'Kategori Kırılımı'],
              ['customer', 'Müşteri Detayı'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                view === key ? 'bg-[#c05277] text-white shadow-[0_10px_22px_-16px_rgba(192,82,119,0.9)]' : 'text-[#705a66] hover:text-[#a34a62]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!hasData ? (
        <div className="mt-4 rounded-[16px] border border-dashed border-[#efe1e7] bg-[#fffafc] px-4 py-8 text-center text-[12px] text-[#705a66]">
          Seçili dönemde paket satışı bulunmuyor.
        </div>
      ) : (
        <div className="mt-4">
          <AnimatePresence mode="wait" initial={false}>
            {view === 'category' ? (
              <motion.div key="category" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                <CategoryList categories={categories} />
              </motion.div>
            ) : (
              <motion.div key="customer" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                <CustomerList customers={customers} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- kategori ---

function CategoryList({ categories }: { categories: PackageCategoryBreakdown[] }) {
  const [open, setOpen] = useState<string | null>(categories[0]?.category ?? null)
  const maxAmount = Math.max(1, ...categories.map((c) => c.amount))
  const totalAmount = categories.reduce((s, c) => s + c.amount, 0)

  return (
    <div className="space-y-2">
      {categories.map((cat) => {
        const isOpen = open === cat.category
        const share = totalAmount > 0 ? Math.round((cat.amount / totalAmount) * 100) : 0
        return (
          <div key={cat.category} className="overflow-hidden rounded-[16px] border border-[#efe1e7] bg-[#fffafc]">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : cat.category)}
              className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-[#fff2f6]"
            >
              <ChevronDown className={`h-4 w-4 shrink-0 text-[#c05277] transition-transform ${isOpen ? 'rotate-0' : '-rotate-90'}`} strokeWidth={2} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-[#2f2230]">{cat.category}</span>
                <span className="mt-1 block text-[11px] text-[#705a66]">
                  {cat.services.length} hizmet · {cat.soldCount} satış · {cat.customerCount} müşteri · {cat.sessionsUsed}/{cat.sessionsTotal} seans
                </span>
                {cat.sellers.length > 0 && (
                  <span className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-[#a34a62]">
                    <UserCheck className="h-3 w-3" strokeWidth={2} />
                    {cat.sellers[0].staffName}
                    {cat.sellers.length > 1 ? ` +${cat.sellers.length - 1} personel` : ''}
                  </span>
                )}
                <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-[#f6e3ea]">
                  <span
                    className="block h-full rounded-full bg-[linear-gradient(90deg,#e78ba8,#c05277)]"
                    style={{ width: `${Math.max(4, Math.round((cat.amount / maxAmount) * 100))}%` }}
                  />
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-display text-[14px] font-bold text-[#2f2230]">{formatTL(Math.round(cat.amount))}</span>
                <span className="mt-0.5 block text-[10px] font-semibold text-[#a34a62]">%{share} pay</span>
              </span>
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
                  <div className="border-t border-[#f2e6eb] bg-white px-3.5 pb-3 pt-3">
                    <SellerStrip sellers={cat.sellers} />

                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[680px] border-collapse text-left">
                        <thead>
                          <tr className="text-[10px] font-semibold uppercase tracking-wide text-[#8a7480]">
                            <th className="py-2 pr-3">Hizmet</th>
                            <th className="py-2 pr-3">Satan personel</th>
                            <th className="py-2 pr-3 text-right">Satış</th>
                            <th className="py-2 pr-3 text-right">Müşteri</th>
                            <th className="py-2 pr-3 text-right">Seans</th>
                            <th className="py-2 pr-3 text-right">Kalan</th>
                            <th className="py-2 text-right">Tutar</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#f6ecf0]">
                          {cat.services.map((svc) => (
                            <tr key={`${cat.category}-${svc.serviceDefinitionId}-${svc.serviceName}`} className="text-[12px] text-[#4a3a44]">
                              <td className="py-2 pr-3">
                                <span className="block max-w-[220px] truncate font-medium text-[#2f2230]">{svc.serviceName}</span>
                              </td>
                              <td className="py-2 pr-3">
                                <span className="flex flex-wrap gap-1">
                                  {svc.sellers.length === 0 ? (
                                    <span className="text-[11px] text-[#705a66]">—</span>
                                  ) : (
                                    svc.sellers.slice(0, 3).map((s) => (
                                      <span
                                        key={`${svc.serviceDefinitionId}-${s.staffMemberId ?? 'none'}`}
                                        title={`${s.staffName} · ${s.soldCount} satış · ${formatTL(Math.round(s.amount))}`}
                                        className="inline-flex items-center gap-1 rounded-full border border-[#efe1e7] bg-[#fff8fa] px-2 py-0.5 text-[10px] font-semibold text-[#a34a62]"
                                      >
                                        <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-[#c05277] text-[8px] font-bold text-white">
                                          {initials(s.staffName)}
                                        </span>
                                        {s.staffName}
                                        <span className="text-[#705a66]">×{s.soldCount}</span>
                                      </span>
                                    ))
                                  )}
                                  {svc.sellers.length > 3 && (
                                    <span className="text-[10px] font-semibold text-[#705a66]">+{svc.sellers.length - 3}</span>
                                  )}
                                </span>
                              </td>
                              <td className="py-2 pr-3 text-right">{svc.soldCount}</td>
                              <td className="py-2 pr-3 text-right">{svc.customerCount}</td>
                              <td className="py-2 pr-3 text-right">
                                {svc.sessionsUsed}/{svc.sessionsTotal}
                              </td>
                              <td className="py-2 pr-3 text-right font-semibold text-[#2c7d63]">{svc.sessionsRemaining}</td>
                              <td className="py-2 text-right font-semibold text-[#2f2230]">{formatTL(Math.round(svc.amount))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}

/**
 * "Kim sattı" şeridi — kategorideki satışların personel bazlı payı.
 * Satış personeli atanmamış (eski / otomatik onaylanmış) kayıtlar "Belirtilmemiş" altında toplanır.
 */
function SellerStrip({ sellers }: { sellers: PackageSeller[] }) {
  if (sellers.length === 0) return null
  const total = sellers.reduce((s, x) => s + x.amount, 0)

  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#8a7480]">
        <UserCheck className="h-3.5 w-3.5 text-[#c05277]" strokeWidth={1.9} /> Kim sattı
      </div>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {sellers.map((s, i) => {
          const share = total > 0 ? Math.round((s.amount / total) * 100) : 0
          return (
            <div
              key={s.staffMemberId ?? `none-${i}`}
              className="min-w-[168px] shrink-0 rounded-[14px] border border-[#f2e6eb] bg-[#fffafc] px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[linear-gradient(140deg,#e78ba8,#c05277)] text-[10px] font-bold text-white">
                  {initials(s.staffName)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold text-[#2f2230]">{s.staffName}</span>
                  <span className="block text-[10px] text-[#705a66]">
                    {s.soldCount} satış · {s.customerCount} müşteri
                  </span>
                </span>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <span className="font-display text-[13px] font-bold text-[#2f2230]">{formatTL(Math.round(s.amount))}</span>
                <span className="text-[10px] font-semibold text-[#a34a62]">%{share}</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#f6e3ea]">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#e78ba8,#c05277)]"
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
      <div className="flex items-center gap-2 rounded-[12px] border border-[#efe1e7] bg-[#fffafc] px-3 py-2">
        <Search className="h-3.5 w-3.5 text-[#c05277]" strokeWidth={1.9} />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setLimit(PAGE_SIZE)
          }}
          placeholder="Müşteri ya da paket adı ara"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-[#352432] outline-none placeholder:text-[#b09ca5]"
        />
        <span className="shrink-0 text-[10px] font-semibold text-[#705a66]">{filtered.length} müşteri</span>
      </div>

      <div className="space-y-2">
        {visible.map((c) => {
          const isOpen = open === c.customerId
          const paidPct = c.totalAmount > 0 ? Math.min(100, Math.round((c.paidAmount / c.totalAmount) * 100)) : 0
          const sessionPct = c.sessionsTotal > 0 ? Math.min(100, Math.round((c.sessionsUsed / c.sessionsTotal) * 100)) : 0
          return (
            <div key={c.customerId} className="overflow-hidden rounded-[16px] border border-[#efe1e7] bg-[#fffafc]">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : c.customerId)}
                className="flex w-full flex-wrap items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-[#fff2f6]"
              >
                <ChevronDown className={`h-4 w-4 shrink-0 text-[#c05277] transition-transform ${isOpen ? 'rotate-0' : '-rotate-90'}`} strokeWidth={2} />
                <span className="min-w-[150px] flex-1">
                  <span className="block truncate text-[13px] font-semibold text-[#2f2230]">{c.customerName}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-[#705a66]">
                    {c.accountCount} satış · {c.packageNames[0] || 'Paket'}
                    {c.packageNames.length > 1 ? ` +${c.packageNames.length - 1}` : ''}
                  </span>
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
                    <div className="space-y-3 border-t border-[#f2e6eb] bg-white px-3.5 py-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <ProgressRow
                          icon={Wallet}
                          label="Tahsilat"
                          value={`${formatTL(Math.round(c.paidAmount))} / ${formatTL(Math.round(c.totalAmount))}`}
                          pct={paidPct}
                          barClass="bg-[linear-gradient(90deg,#7fc7ad,#2c7d63)]"
                        />
                        <ProgressRow
                          icon={Activity}
                          label="Seans kullanımı"
                          value={`${c.sessionsUsed} / ${c.sessionsTotal} · ${c.sessionsRemaining} kalan`}
                          pct={sessionPct}
                          barClass="bg-[linear-gradient(90deg,#b79ae0,#7b52ba)]"
                        />
                      </div>

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
                          <span key={p} className="rounded-full border border-[#efe1e7] bg-[#fff8fa] px-2.5 py-1 text-[10px] font-semibold text-[#705a66]">
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
          <div className="rounded-[16px] border border-dashed border-[#efe1e7] bg-[#fffafc] px-4 py-6 text-center text-[12px] text-[#705a66]">
            Aramaya uygun müşteri bulunamadı.
          </div>
        )}
      </div>

      {filtered.length > visible.length && (
        <button
          type="button"
          onClick={() => setLimit((v) => v + PAGE_SIZE)}
          className="mx-auto flex w-max items-center gap-1 rounded-full border border-[#efe1e7] bg-white px-4 py-1.5 text-[11px] font-semibold text-[#a34a62] transition-colors hover:border-[#e7bccb] hover:bg-[#fff2f6]"
        >
          {filtered.length - visible.length} müşteri daha göster
        </button>
      )}
    </div>
  )
}

// -------------------------------------------------------------- yardımcılar ---

const MINI_TONES: Record<string, string> = {
  rose: 'border-[#f3d3de] bg-[#fff2f6] text-[#a34a62]',
  mint: 'border-[#cfe8dd] bg-[#f2fbf7] text-[#2c7d63]',
  gold: 'border-[#f0e0bd] bg-[#fffaef] text-[#96702a]',
  violet: 'border-[#e0d3f2] bg-[#faf6ff] text-[#6b4aa0]',
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
    <div className="rounded-[14px] border border-[#f2e6eb] bg-[#fffafc] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#4a3a44]">
          <Icon className="h-3.5 w-3.5 text-[#c05277]" strokeWidth={1.9} /> {label}
        </span>
        <span className="text-[11px] font-bold text-[#2f2230]">%{pct}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#f2e6eb]">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
      <div className="mt-1.5 text-[11px] text-[#705a66]">{value}</div>
    </div>
  )
}

function Chip({ icon: Icon, text, danger = false }: { icon: typeof Wallet; text: string; danger?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
        danger ? 'border-[#f2c4c4] bg-[#fff4f4] text-[#b3453f]' : 'border-[#efe1e7] bg-[#fff8fa] text-[#705a66]'
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
