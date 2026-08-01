'use client'

import { useEffect, useMemo, useState } from 'react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { adminApi, fetchAllPaged } from '@/lib/apiClient'
import { formatTL, normalizeAdisyon, normalizeAppointment } from '@/lib/apiMappers'
import type { AdisyonItemTypeKey, ApiAdisyon, ApiAppointment, CustomerAccount } from '@/lib/types'
import { CalendarCheck2, Loader2, ReceiptText, Wallet } from 'lucide-react'

type TabKey = 'sessions' | 'operations' | 'payments'

const TABS: { key: TabKey; label: string; icon: typeof CalendarCheck2 }[] = [
  { key: 'sessions', label: 'Seanslar', icon: CalendarCheck2 },
  { key: 'operations', label: 'İşlemler', icon: ReceiptText },
  { key: 'payments', label: 'Ödemeler', icon: Wallet },
]

/** Adisyon kalem tipi → kısa rozet. "hangi işlem" sütununun etiketi. */
const OP_LABEL: Record<AdisyonItemTypeKey, string> = {
  Service: 'Hizmet',
  Product: 'Ürün',
  PackageUse: 'Paketten',
  Extra: 'Ek kalem',
  Payment: 'Tahsilat',
  Discount: 'İndirim',
  PackageSale: 'Paket satışı',
}

interface Row {
  key: string
  ts: number
  /** Sol sütunda rozet olarak yazılan işlem türü. */
  tag: string
  desc: string
  meta: string | null
  /** Sağ sütun: tutar metni (boşsa tire). */
  amount: string
  tone: 'plain' | 'in' | 'out' | 'package'
}

function fmtDate(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}
function fmtTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Backend ödeme yöntemi kodunu insan diline çevirir. */
function methodLabel(method: string): string {
  const key = (method || '').toLowerCase()
  if (key.includes('cash') || key.includes('nakit')) return 'Nakit'
  if (key.includes('card') || key.includes('kart')) return 'Kart'
  if (key.includes('transfer') || key.includes('havale') || key.includes('eft')) return 'Havale'
  return method || 'Tahsilat'
}

/**
 * Müşterinin PAKET SONRASI geçmişi — tek panelde üç tablo:
 *
 * - **Seanslar**: kullanılan seansların TARİHLERİ (tamamlanmış randevular + adisyondaki
 *   "paketten kullan" kalemleri). "Kaç seansı kaldı" bilgisi bakiyeden okunuyordu ama
 *   "hangi gün geldi" hiçbir yerde yazmıyordu.
 * - **İşlemler**: satış, ürün, ek kalem, indirim, paket kullanımı — kronolojik.
 * - **Ödemeler**: carilere yapılan tüm tahsilatlar (yöntem + hangi satış).
 *
 * Randevu modalinde kullanılır: müşteri masadayken geçmişi görmek için başka ekrana gitmeye
 * gerek kalmasın. Adisyonlar SUNUCUDA müşteriye göre süzülür (customerId), tüm kurum çekilmez.
 */
export default function CustomerHistoryPanel({
  customerId,
  tenantId,
  accounts = [],
  refreshKey = 0,
}: {
  customerId: string
  tenantId?: string
  accounts?: CustomerAccount[]
  refreshKey?: number
}) {
  // Adisyon pakete bağlı: kapalıysa işlem defteri hiç dolmaz — sekmeyi göstermeyip
  // boş bir tabloyla kullanıcıyı yanıltmayalım.
  const canAdisyon = useFeature('billing.adisyon')
  const tabs = useMemo(() => TABS.filter((t) => t.key !== 'operations' || canAdisyon), [canAdisyon])
  const [tab, setTab] = useState<TabKey>('sessions')
  useEffect(() => {
    if (!canAdisyon && tab === 'operations') setTab('sessions')
  }, [canAdisyon, tab])

  const { data, loading } = useApiQuery<{ appts: ApiAppointment[]; adisyonlar: ApiAdisyon[] }>(
    async () => {
      if (!customerId) return { appts: [], adisyonlar: [] }
      // SAYFALAR SONUNA KADAR: tek sayfa 200 kayıtla sınırlıydı — uzun süreli müşteride
      // geçmişin eski kısmı sessizce eksik görünüyordu (sunucu süzgeci sayesinde yalnız bu
      // müşterinin kayıtları okunur, maliyet düşük).
      const [appts, adisyonlar] = await Promise.all([
        fetchAllPaged<ApiAppointment>((page, pageSize) =>
          adminApi.appointments<ApiAppointment>({ tenantId, customerId, page, pageSize }), 200,
        ).catch(() => [] as ApiAppointment[]),
        canAdisyon
          ? fetchAllPaged<ApiAdisyon>((page, pageSize) =>
              adminApi.adisyonlar<ApiAdisyon>({ tenantId, customerId, page, pageSize }), 200,
            ).catch(() => [] as ApiAdisyon[])
          : Promise.resolve([] as ApiAdisyon[]),
      ])
      return { appts, adisyonlar }
    },
    [customerId, tenantId, canAdisyon, refreshKey],
    { initialData: { appts: [], adisyonlar: [] } },
  )

  const appointments = useMemo(
    () => (data?.appts || []).map((a, i) => normalizeAppointment(a, {}, i)),
    [data],
  )
  // İptal edilmiş adisyon geçmişte yaşanmış sayılmaz — hiçbir sekmede görünmez.
  const adisyonlar = useMemo(
    () => (data?.adisyonlar || []).map(normalizeAdisyon).filter((a) => a.status !== 'Cancelled'),
    [data],
  )

  /** Kullanılan seanslar: PAKETTEN karşılanan tamamlanmış randevular + "Paketten" adisyon kalemleri. */
  const sessionRows = useMemo<Row[]>(() => {
    const rows: Row[] = []
    for (const ap of appointments) {
      if (ap.status !== 'tamamlandi') continue
      // ÜCRETLİ randevu seans TÜKETMEZ (backend de artık tüketmiyor); bu sekme "paket
      // kullanımı" listesidir — ücretlileri de koyunca kalan seans hesabı yanlış okunuyordu.
      // Ücretli ziyaretler "İşlemler" sekmesinde görünmeye devam eder.
      if (Number(ap.price || 0) > 0) continue
      const ts = Date.parse(`${ap.date}T${ap.time || '00:00'}:00`) || Date.parse(ap.date || '') || 0
      rows.push({
        key: `ap-${ap.id}`,
        ts,
        tag: 'Randevu',
        desc: ap.islem || 'Seans',
        meta: ap.personel || null,
        amount: '',
        tone: 'plain',
      })
    }
    for (const a of adisyonlar) {
      const fallback = Date.parse(a.approvedAtUtc || a.openedAtUtc || '') || 0
      for (const it of a.items) {
        if (it.type !== 'PackageUse') continue
        rows.push({
          key: `pu-${it.id}`,
          ts: Date.parse(it.createdAtUtc || '') || fallback,
          tag: 'Paketten',
          desc: it.description,
          meta: it.staffName,
          amount: 'paket',
          tone: 'package',
        })
      }
    }
    return rows.sort((x, y) => y.ts - x.ts)
  }, [appointments, adisyonlar])

  /** İşlem geçmişi: adisyondaki her kalem + seans gelişleri. */
  const operationRows = useMemo<Row[]>(() => {
    const rows: Row[] = []
    for (const a of adisyonlar) {
      const fallback = Date.parse(a.approvedAtUtc || a.openedAtUtc || '') || 0
      for (const it of a.items) {
        rows.push({
          key: `it-${it.id}`,
          ts: Date.parse(it.createdAtUtc || '') || fallback,
          tag: OP_LABEL[it.type] ?? 'İşlem',
          desc: it.description,
          meta: it.staffName,
          amount: it.coveredByPackage
            ? 'paket'
            : `${it.type === 'Payment' ? '+' : it.type === 'Discount' ? '−' : ''}${formatTL(it.lineTotal)}`,
          tone: it.coveredByPackage
            ? 'package'
            : it.type === 'Payment'
              ? 'in'
              : it.type === 'Discount'
                ? 'out'
                : 'plain',
        })
      }
    }
    for (const ap of appointments) {
      if (ap.status !== 'tamamlandi') continue
      rows.push({
        key: `apop-${ap.id}`,
        ts: Date.parse(`${ap.date}T${ap.time || '00:00'}:00`) || Date.parse(ap.date || '') || 0,
        tag: 'Seans',
        desc: ap.islem || 'Seans',
        meta: ap.personel || null,
        amount: '',
        tone: 'plain',
      })
    }
    return rows.sort((x, y) => y.ts - x.ts)
  }, [adisyonlar, appointments])

  /**
   * Ödeme listesi carilerin TAHSİLAT satırlarından kurulur (adisyondaki ödeme kalemi onayda
   * zaten cariye tahsilat olarak yazılır — ikisini birleştirmek aynı parayı iki kez gösterirdi).
   */
  const paymentRows = useMemo<Row[]>(() => {
    const rows: Row[] = []
    for (const acc of accounts) {
      for (const p of acc.payments || []) {
        rows.push({
          key: `pay-${p.id}`,
          ts: Date.parse(p.occurredAtUtc || '') || 0,
          tag: methodLabel(p.method),
          desc: acc.servicePackageName || acc.name,
          meta: p.reference || null,
          amount: `+${formatTL(p.amount)}`,
          tone: 'in',
        })
      }
    }
    return rows.sort((x, y) => y.ts - x.ts)
  }, [accounts])

  const rows = tab === 'sessions' ? sessionRows : tab === 'operations' ? operationRows : paymentRows

  // Sekme başlığındaki özet: kaç kayıt ve (ödemede) toplam tutar.
  const paidTotal = useMemo(
    () => accounts.reduce((sum, a) => sum + (a.payments || []).reduce((s, p) => s + p.amount, 0), 0),
    [accounts],
  )
  const caption =
    tab === 'sessions'
      ? sessionRows.length > 0
        ? `${sessionRows.length} kullanım · son ${fmtDate(sessionRows[0].ts)}`
        : 'Henüz kullanılmış seans yok'
      : tab === 'operations'
        ? `${operationRows.length} işlem`
        : `${paymentRows.length} tahsilat · ${formatTL(paidTotal)}`

  const emptyText =
    tab === 'sessions'
      ? 'Paket alındı ama henüz seans kullanılmamış.'
      : tab === 'operations'
        ? 'Bu müşteri için işlem kaydı yok.'
        : 'Bu müşteriden henüz tahsilat alınmamış.'

  return (
    <div className="rounded-2xl border border-[#efe1e7] bg-white p-4">
      <h4 className="font-display text-[13.5px] font-extrabold tracking-[-0.01em] text-[#2b1e29]">Müşteri geçmişi</h4>

      {/* Sekmeler */}
      <div className="mt-2.5 inline-flex w-full items-center gap-1 rounded-xl border border-[#efe1e7] bg-[#fdf9fb] p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11.5px] font-semibold transition-colors ${
              tab === t.key ? 'bg-[#8e3f5b] text-white' : 'text-[#705a66] hover:bg-white'
            }`}
          >
            <t.icon className="h-3.5 w-3.5" strokeWidth={1.9} />
            {t.label}
          </button>
        ))}
      </div>

      <p className="mt-2 text-[11.5px] text-[#705a66]">{caption}</p>

      {/* Tablo başlığı */}
      <div className="mt-2 grid grid-cols-[64px_1fr_auto] items-center gap-2 border-b border-[#f4e8ee] pb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#a3576f]">
        <span>Tarih</span>
        <span>İşlem</span>
        <span className="text-right">{tab === 'sessions' ? 'Kaynak' : 'Tutar'}</span>
      </div>

      {/* Satırlar — uzun geçmişte panel şişmesin diye kendi içinde kayar. */}
      <div className="max-h-[280px] overflow-y-auto">
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-[#705a66]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Geçmiş yükleniyor…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-[#705a66]">{emptyText}</div>
        ) : (
          <ul className="divide-y divide-[#f7eef2]">
            {rows.map((r) => (
              <li key={r.key} className="grid grid-cols-[64px_1fr_auto] items-baseline gap-2 py-2">
                <span className="text-[11.5px] tabular-nums leading-tight text-[#705a66]">
                  {fmtDate(r.ts)}
                  {fmtTime(r.ts) && <span className="block text-[10px] text-[#8b7480]">{fmtTime(r.ts)}</span>}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-[#2b1e29]">{r.desc}</span>
                  {/* Seans sekmesinde tür zaten sağ sütunda; burada personel yazar. */}
                  <span className="block truncate text-[11px] text-[#705a66]">
                    {tab === 'sessions'
                      ? r.meta || 'Personel belirtilmemiş'
                      : [r.tag, r.meta].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-right text-[12px] font-semibold tabular-nums ${
                    r.tone === 'in'
                      ? 'text-emerald-700'
                      : r.tone === 'out'
                        ? 'text-rose-700'
                        : r.tone === 'package'
                          ? 'text-[#b8863b]'
                          : 'text-[#4a3a44]'
                  }`}
                >
                  {tab === 'sessions' ? r.tag : r.amount || '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
