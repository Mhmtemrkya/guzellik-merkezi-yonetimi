'use client'

import { useMemo, useState } from 'react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { adminApi } from '@/lib/apiClient'
import { apiItems, formatTL, normalizeAdisyon } from '@/lib/apiMappers'
import type { Appointment, ApiAdisyon, CustomerAccount, AdisyonItemTypeKey } from '@/lib/types'
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, CreditCard, Scissors, User } from 'lucide-react'

type Gran = 'day' | 'week' | 'month'
type RowKind = AdisyonItemTypeKey | 'Session'

const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

/** İşlem tipi → etiket + renk tonu. "hangi işlem yapıldı" sütununun rozeti. */
const OP_META: Record<RowKind, { label: string; tone: string }> = {
  Service: { label: 'Hizmet', tone: 'border-sky-300/40 bg-sky-50 text-sky-700' },
  Product: { label: 'Ürün', tone: 'border-violet-300/40 bg-violet-50 text-violet-700' },
  PackageUse: { label: 'Paketten', tone: 'border-amber-300/40 bg-amber-50 text-amber-700' },
  Extra: { label: 'Ek kalem', tone: 'border-slate-300/40 bg-slate-50 text-slate-700' },
  Payment: { label: 'Tahsilat', tone: 'border-emerald-300/40 bg-emerald-50 text-emerald-700' },
  Discount: { label: 'İndirim', tone: 'border-rose-300/40 bg-rose-50 text-rose-700' },
  PackageSale: { label: 'Paket satışı', tone: 'border-fuchsia-300/40 bg-fuchsia-50 text-fuchsia-700' },
  Session: { label: 'Seans', tone: 'border-teal-300/40 bg-teal-50 text-teal-700' },
}

interface JournalRow {
  ts: number
  kind: RowKind
  desc: string
  staff: string | null
  amount: number
  covered: boolean
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function mondayOf(d: Date): Date {
  const x = startOfDay(d)
  const dow = (x.getDay() + 6) % 7 // Pazartesi = 0
  x.setDate(x.getDate() - dow)
  return x
}

/**
 * Müşteri bazlı işlem defteri — adisyon kalemleri (satış/tahsilat/paket/indirim) + tamamlanmış
 * randevular (seans gelişi) tek kronolojik akışta. Gün/hafta/ay süzgeci, "işlem · personel · tutar".
 * Kurum yöneticisi dönem sonunda buraya bakar.
 */
export default function CustomerOperationsJournal({
  customerId,
  tenantId,
  appointments = [],
  accounts = [],
  refreshKey = 0,
}: {
  customerId: string
  tenantId?: string
  appointments?: Appointment[]
  accounts?: CustomerAccount[]
  refreshKey?: number
}) {
  const canAdisyon = useFeature('billing.adisyon')
  const [gran, setGran] = useState<Gran>('day')
  const [offset, setOffset] = useState(0)

  const { data, loading } = useApiQuery<{ adisyonlar: ApiAdisyon[] }>(
    async () => {
      if (!customerId || !canAdisyon) return { adisyonlar: [] }
      const res = await adminApi.adisyonlar<ApiAdisyon>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] }))
      return { adisyonlar: apiItems(res) }
    },
    [customerId, tenantId, canAdisyon, refreshKey],
    { initialData: { adisyonlar: [] } },
  )

  // Bu müşterinin iptal olmayan adisyonları.
  const adisyonlar = useMemo(
    () => (data?.adisyonlar || []).map(normalizeAdisyon).filter((a) => a.customerId === customerId && a.status !== 'Cancelled'),
    [data, customerId],
  )

  // Tüm satırları kur (süzgeçten önce).
  const allRows = useMemo<JournalRow[]>(() => {
    const rows: JournalRow[] = []
    for (const a of adisyonlar) {
      const fallbackTs = Date.parse(a.approvedAtUtc || a.openedAtUtc || '') || 0
      for (const it of a.items) {
        const ts = Date.parse(it.createdAtUtc || '') || fallbackTs
        rows.push({
          ts,
          kind: it.type,
          desc: it.description,
          staff: it.staffName,
          amount: it.lineTotal,
          covered: it.coveredByPackage,
        })
      }
    }
    // Tamamlanmış randevular = "müşteri seansa geldi" olayı (hizmet + personel + tarih).
    for (const ap of appointments) {
      if (ap.customerId !== customerId || ap.status !== 'tamamlandi') continue
      const ts = Date.parse(`${ap.date}T${ap.time || '00:00'}:00`) || Date.parse(ap.date || '') || 0
      rows.push({
        ts,
        kind: 'Session',
        desc: ap.islem || 'Seans',
        staff: ap.personel || null,
        amount: Number(ap.price || 0),
        covered: false,
      })
    }
    return rows.sort((x, y) => y.ts - x.ts)
  }, [adisyonlar, appointments, customerId])

  // Seçili dönem aralığı.
  const { startMs, endMs, label } = useMemo(() => {
    const now = new Date()
    let start: Date
    let end: Date
    let lbl: string
    if (gran === 'day') {
      start = startOfDay(now)
      start.setDate(start.getDate() + offset)
      end = new Date(start)
      end.setDate(end.getDate() + 1)
      lbl = `${start.getDate()} ${TR_MONTHS[start.getMonth()]} ${start.getFullYear()}`
    } else if (gran === 'week') {
      start = mondayOf(now)
      start.setDate(start.getDate() + offset * 7)
      end = new Date(start)
      end.setDate(end.getDate() + 7)
      const last = new Date(end)
      last.setDate(last.getDate() - 1)
      lbl = `${start.getDate()} ${TR_MONTHS[start.getMonth()].slice(0, 3)} – ${last.getDate()} ${TR_MONTHS[last.getMonth()].slice(0, 3)}`
    } else {
      start = new Date(now.getFullYear(), now.getMonth() + offset, 1)
      end = new Date(start.getFullYear(), start.getMonth() + 1, 1)
      lbl = `${TR_MONTHS[start.getMonth()]} ${start.getFullYear()}`
    }
    return { startMs: start.getTime(), endMs: end.getTime(), label: lbl }
  }, [gran, offset])

  const rows = useMemo(() => allRows.filter((r) => r.ts >= startMs && r.ts < endMs), [allRows, startMs, endMs])

  // Dönem özeti.
  const summary = useMemo(() => {
    let collected = 0
    let charged = 0
    for (const r of rows) {
      if (r.kind === 'Payment') collected += r.amount
      else if (r.kind === 'Discount') charged -= r.amount
      else if (!r.covered && (r.kind === 'Service' || r.kind === 'Product' || r.kind === 'Extra' || r.kind === 'PackageSale')) charged += r.amount
    }
    return { collected, charged, count: rows.length }
  }, [rows])

  // Bu müşterinin aktif (kalan borçlu) carileri — taksit/cari durumu kartta görünür.
  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.customerId === customerId && a.isActive && a.remainingAmount > 0),
    [accounts, customerId],
  )

  if (!canAdisyon) return null

  const fmtTime = (ts: number) => {
    if (!ts) return ''
    const d = new Date(ts)
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div className="rounded-[20px] border border-[#ead8df]/70 bg-white/80 p-4 shadow-[0_18px_50px_-40px_rgba(142,63,91,0.5)]">
      {/* Başlık + gün/hafta/ay süzgeci */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-[#c85776]/80">
          <ClipboardList className="h-3.5 w-3.5" /> İşlem Defteri
        </div>
        <div className="inline-flex items-center gap-1 rounded-[10px] border border-[#ead8df] bg-[#fff4f8]/40 p-1">
          {([['day', 'Gün'], ['week', 'Hafta'], ['month', 'Ay']] as const).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => { setGran(k); setOffset(0) }}
              className={`rounded-[8px] px-2.5 py-1 text-[10px] font-medium transition-colors ${gran === k ? 'bg-[#c85776] text-white' : 'text-[#352432]/55 hover:bg-white'}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Dönem gezgini */}
      <div className="mb-3 flex items-center justify-between rounded-[12px] border border-[#ead8df]/70 bg-white px-2 py-1.5">
        <button type="button" onClick={() => setOffset((o) => o - 1)} className="grid h-7 w-7 place-items-center rounded-[8px] text-[#352432]/55 hover:bg-[#fff4f8]" aria-label="Önceki dönem">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#352432]">
          <CalendarDays className="h-3.5 w-3.5 text-[#c85776]" /> {label}
          {offset === 0 && <span className="rounded-full bg-[#fff1f6] px-1.5 py-0.5 text-[9px] font-mono uppercase text-[#c85776]">Bu {gran === 'day' ? 'gün' : gran === 'week' ? 'hafta' : 'ay'}</span>}
        </span>
        <button type="button" disabled={offset >= 0} onClick={() => setOffset((o) => Math.min(0, o + 1))} className="grid h-7 w-7 place-items-center rounded-[8px] text-[#352432]/55 hover:bg-[#fff4f8] disabled:opacity-30" aria-label="Sonraki dönem">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Dönem özeti */}
      <div className="mb-3 grid grid-cols-3 gap-px overflow-hidden rounded-[12px] border border-[#ead8df]/65 bg-[#fff1f6]/72 text-center">
        <div className="bg-white p-2">
          <div className="text-[8px] font-mono uppercase text-[#352432]/40">İşlem</div>
          <div className="mt-0.5 font-display text-[14px] tabular-nums text-[#352432]">{summary.count}</div>
        </div>
        <div className="bg-white p-2">
          <div className="text-[8px] font-mono uppercase text-[#352432]/40">Satış / borç</div>
          <div className="mt-0.5 font-display text-[14px] tabular-nums text-[#c85776]">{formatTL(summary.charged)}</div>
        </div>
        <div className="bg-white p-2">
          <div className="text-[8px] font-mono uppercase text-[#352432]/40">Tahsilat</div>
          <div className="mt-0.5 font-display text-[14px] tabular-nums text-emerald-700">{formatTL(summary.collected)}</div>
        </div>
      </div>

      {/* Satırlar */}
      <div className="space-y-1.5">
        {rows.length === 0 ? (
          <div className="rounded-[12px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-6 text-center text-[11px] text-[#352432]/45">
            {loading ? 'Yükleniyor…' : 'Bu dönemde işlem yok.'}
          </div>
        ) : (
          rows.map((r, i) => {
            const meta = OP_META[r.kind]
            return (
              <div key={i} className="flex items-center justify-between gap-2 rounded-[12px] border border-[#f0e0e6] bg-white px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[8px] font-mono uppercase ${meta.tone}`}>{meta.label}</span>
                  <div className="min-w-0">
                    <div className="truncate text-[12px] text-[#352432]">{r.desc}</div>
                    <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wide text-[#352432]/40">
                      <span>{fmtTime(r.ts)}</span>
                      {r.staff && (
                        <span className="flex items-center gap-0.5 text-[#b14d6c]/70"><User className="h-2.5 w-2.5" /> {r.staff}</span>
                      )}
                    </div>
                  </div>
                </div>
                <span className={`shrink-0 font-mono text-[12px] tabular-nums ${r.kind === 'Payment' ? 'text-emerald-700' : r.kind === 'Discount' ? 'text-rose-700' : r.covered ? 'text-amber-700' : r.kind === 'Session' ? 'text-[#352432]/45' : 'text-[#352432]'}`}>
                  {r.covered ? 'paket' : `${r.kind === 'Payment' ? '+' : r.kind === 'Discount' ? '−' : ''}${formatTL(r.amount)}`}
                </span>
              </div>
            )
          })
        )}
      </div>

      {/* Taksit / cari durumu — bu müşterinin açık carileri */}
      {activeAccounts.length > 0 && (
        <div className="mt-3 space-y-1.5 rounded-[14px] border border-[#efbfd0]/50 bg-[#fff1f6]/40 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#b14d6c]">
            <CreditCard className="h-3.5 w-3.5" /> Taksit / Cari Durumu
          </div>
          {activeAccounts.map((a) => {
            const overdue = a.installments.some((i) => i.overdue)
            const plannedCount = a.installments.filter((i) => i.status !== 'Cancelled').length
            return (
              <div key={a.id} className="flex items-center justify-between gap-2 rounded-[10px] border border-[#ead8df]/70 bg-white px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-[12px] text-[#352432]">{a.servicePackageName || a.name}</div>
                  <div className="text-[9px] font-mono uppercase tracking-wide text-[#352432]/45">
                    {plannedCount > 0 ? `${plannedCount} taksit` : 'Peşin'}
                    {a.nextDueDate ? ` · vade ${a.nextDueDate}` : ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-display text-[14px] tabular-nums ${overdue ? 'text-rose-700' : 'text-[#c85776]'}`}>{formatTL(a.remainingAmount)}</div>
                  <div className="text-[8px] font-mono uppercase text-[#352432]/40">{overdue ? 'geciken' : 'kalan'}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5 px-1 text-[9px] text-[#352432]/40">
        <Scissors className="h-2.5 w-2.5" /> Seans gelişleri tamamlanan randevulardan, satış/tahsilat adisyondan gelir.
      </div>
    </div>
  )
}
