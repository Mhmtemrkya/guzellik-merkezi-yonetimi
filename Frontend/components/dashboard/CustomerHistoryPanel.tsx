'use client'

import { useEffect, useMemo, useState } from 'react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { adminApi, fetchAllPaged } from '@/lib/apiClient'
import { formatTL, normalizeAdisyon, normalizeAppointment, paymentMethodLabel } from '@/lib/apiMappers'
import type {
  ApiAdisyon,
  ApiAppointment,
  ApiCustomerPackageSession,
  CustomerAccount,
  ServicePackage,
} from '@/lib/types'
import { CalendarCheck2, Loader2, Package, Scissors, Wallet } from 'lucide-react'

type TabKey = 'sessions' | 'operations' | 'payments'

/** Pakete bağlı OLMAYAN seans satırı (tekil hizmet satışı) bu GUID ile gelir. */
const EMPTY_GUID = '00000000-0000-0000-0000-000000000000'

const TABS: { key: TabKey; label: string; icon: typeof CalendarCheck2 }[] = [
  { key: 'sessions', label: 'Seanslar', icon: Package },
  { key: 'operations', label: 'İşlemler', icon: Scissors },
  { key: 'payments', label: 'Ödemeler', icon: Wallet },
]

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

/** Kullanılan/yapılan iş satırı. */
interface HistoryRow {
  key: string
  ts: number
  desc: string
  /** İşi UYGULAYAN personel. */
  appliedBy: string | null
  /** İşi SATAN personel (yalnız İşlemler sekmesinde anlamlı). */
  soldBy: string | null
  /** Sağ sütun: tutar ya da kaynak etiketi. */
  trailing: string
  tone: 'plain' | 'in' | 'package'
}

/**
 * Müşterinin geçmişi — üç sekme, ÜÇ FARKLI SORU:
 *
 * - **Seanslar** = PAKETTEN. Satın alınan paketlerde hangi işlemden kaç seans kaldı ve
 *   geçmişte o paketlerden hangi günler seans kullanıldı.
 * - **İşlemler** = HİZMETTEN. Tek tek hizmet seçilerek yaptırılan işler; KİM SATTI ve
 *   SEANSI KİM YAPTI ile birlikte.
 * - **Ödemeler** = carilere yapılan tahsilatlar (yöntem + hangi satış).
 *
 * Eskiden "Seanslar" ve "İşlemler" ikisi de tamamlanmış randevuları listeliyordu; aynı satır iki
 * sekmede birden görünüyor ve aradaki fark okunmuyordu. Ayrım artık KAYNAK üzerinden: paket mi,
 * tekil hizmet mi.
 *
 * Randevu modalinde kullanılır: müşteri masadayken geçmişi görmek için başka ekrana gitmeye
 * gerek kalmasın. Adisyonlar SUNUCUDA müşteriye göre süzülür (customerId), tüm kurum çekilmez.
 */
export default function CustomerHistoryPanel({
  customerId,
  tenantId,
  accounts = [],
  sessions = [],
  packages = [],
  refreshKey = 0,
}: {
  customerId: string
  tenantId?: string
  accounts?: CustomerAccount[]
  /** Müşterinin seans bakiyeleri — çağıran zaten çekiyor, ikinci kez istenmez. */
  sessions?: ApiCustomerPackageSession[]
  /** Paket adını çözmek için katalog. */
  packages?: ServicePackage[]
  refreshKey?: number
}) {
  // Adisyon pakete bağlı: kapalıysa işlem defteri hiç dolmaz — sekmeyi göstermeyip
  // boş bir tabloyla kullanıcıyı yanıltmayalım.
  const canAdisyon = useFeature('billing.adisyon')
  const [tab, setTab] = useState<TabKey>('sessions')

  /**
   * SEANS/PAKET VERİSİ PROP'A BIRAKILMAZ — panel eksikse kendisi çeker.
   *
   * "Seanslar" sekmesi bir randevunun paketten mi karşılandığını `packageServiceIds` kümesiyle
   * ayırt eder; bu küme `sessions`'tan kurulur. Müşteri kartı bu prop'ları HİÇ geçmiyordu:
   * küme boş kalıyor, TAMAMLANMIŞ HER randevu eleniyor ve müşteri paketinden seans kullanmış
   * olsa bile sekme "Paketten henüz seans kullanılmamış" diyordu (randevu modalinde prop'lar
   * geçildiği için aynı panel orada doğru çalışıyordu — hata yalnız müşteri kartında görünürdü).
   * Panelin kendi verisini garanti etmesi, bu sınıf hatanın yeni çağıranlarda tekrarını önler.
   */
  const needsOwnSessions = sessions.length === 0
  const needsOwnPackages = packages.length === 0

  const { data, loading } = useApiQuery<{
    appts: ApiAppointment[]
    adisyonlar: ApiAdisyon[]
    sessions: ApiCustomerPackageSession[]
    packages: ServicePackage[]
  }>(
    async () => {
      if (!customerId) return { appts: [], adisyonlar: [], sessions: [], packages: [] }
      // SAYFALAR SONUNA KADAR: tek sayfa 200 kayıtla sınırlıydı — uzun süreli müşteride
      // geçmişin eski kısmı sessizce eksik görünüyordu (sunucu süzgeci sayesinde yalnız bu
      // müşterinin kayıtları okunur, maliyet düşük).
      const [appts, adisyonlar, ownSessions, ownPackages] = await Promise.all([
        fetchAllPaged<ApiAppointment>((page, pageSize) =>
          adminApi.appointments<ApiAppointment>({ tenantId, customerId, page, pageSize }), 200,
        ).catch(() => [] as ApiAppointment[]),
        canAdisyon
          ? fetchAllPaged<ApiAdisyon>((page, pageSize) =>
              adminApi.adisyonlar<ApiAdisyon>({ tenantId, customerId, page, pageSize }), 200,
            ).catch(() => [] as ApiAdisyon[])
          : Promise.resolve([] as ApiAdisyon[]),
        needsOwnSessions
          ? adminApi.customerSessions<ApiCustomerPackageSession>(customerId, tenantId)
              .then((rows) => (Array.isArray(rows) ? rows : []))
              .catch(() => [] as ApiCustomerPackageSession[])
          : Promise.resolve([] as ApiCustomerPackageSession[]),
        // Paket adı yalnız başlıkta kullanılır; alınamazsa "Paket" yazılır, sekme yine çalışır.
        needsOwnPackages
          ? fetchAllPaged<ServicePackage>((page, pageSize) =>
              adminApi.packages<ServicePackage>({ tenantId, page, pageSize }), 200,
            ).catch(() => [] as ServicePackage[])
          : Promise.resolve([] as ServicePackage[]),
      ])
      return { appts, adisyonlar, sessions: ownSessions, packages: ownPackages }
    },
    [customerId, tenantId, canAdisyon, refreshKey, needsOwnSessions, needsOwnPackages],
    { initialData: { appts: [], adisyonlar: [], sessions: [], packages: [] } },
  )

  /** Prop verilmişse o kullanılır (çağıran zaten çekmiştir), yoksa panelin kendi çektiği. */
  const effectiveSessions = needsOwnSessions ? (data?.sessions || []) : sessions
  const effectivePackages = needsOwnPackages ? (data?.packages || []) : packages

  const appointments = useMemo(
    () => (data?.appts || []).map((a, i) => normalizeAppointment(a, {}, i)),
    [data],
  )
  // İptal edilmiş adisyon geçmişte yaşanmış sayılmaz — hiçbir sekmede görünmez.
  const adisyonlar = useMemo(
    () => (data?.adisyonlar || []).map(normalizeAdisyon).filter((a) => a.status !== 'Cancelled'),
    [data],
  )

  /** Paketten gelen seans satırları, pakete göre gruplanmış (kalan bakiye görünümü). */
  const packageGroups = useMemo(() => {
    const map = new Map<
      string,
      { packageId: string; name: string; rows: { serviceDefinitionId: string; serviceName: string; remaining: number; total: number }[] }
    >()
    for (const s of effectiveSessions) {
      const pid = s.servicePackageId
      const sid = s.serviceDefinitionId
      if (!pid || pid === EMPTY_GUID || !sid) continue
      const entry = map.get(pid) ?? { packageId: pid, name: effectivePackages.find((p) => p.id === pid)?.name || 'Paket', rows: [] }
      const row = entry.rows.find((r) => r.serviceDefinitionId === sid)
      if (row) {
        row.remaining += s.remainingSessions ?? 0
        row.total += s.totalSessions ?? 0
      } else {
        entry.rows.push({
          serviceDefinitionId: sid,
          serviceName: s.serviceName ?? 'Hizmet',
          remaining: s.remainingSessions ?? 0,
          total: s.totalSessions ?? 0,
        })
      }
      map.set(pid, entry)
    }
    return Array.from(map.values())
  }, [effectiveSessions, effectivePackages])

  /** Paketten karşılanan hizmetler — SEZGİSEL ayrım (aşağıdaki kesin bağ yoksa kullanılır). */
  const packageServiceIds = useMemo(() => {
    const set = new Set<string>()
    for (const s of effectiveSessions) {
      if (s.servicePackageId && s.servicePackageId !== EMPTY_GUID && s.serviceDefinitionId) {
        set.add(s.serviceDefinitionId)
      }
    }
    return set
  }, [effectiveSessions])

  /** PAKETE ait seans kayıtlarının kimlikleri — randevunun bağlı olduğu seansı sınıflandırır. */
  const packageSessionIds = useMemo(() => {
    const set = new Set<string>()
    for (const s of effectiveSessions) {
      if (s.id && s.servicePackageId && s.servicePackageId !== EMPTY_GUID) set.add(s.id)
    }
    return set
  }, [effectiveSessions])

  /**
   * Bir randevu PAKETTEN mi karşılandı?
   *
   * KESİN CEVAP randevunun bağlı olduğu seans kaydıdır (`sourceSessionId`) — sunucu bunu
   * tamamlamada GERÇEKTEN düşülen seansla yazar. Sezgi ("hizmet herhangi bir pakette geçiyor")
   * müşteri aynı hizmeti hem paketten hem tekil satın aldığında yanılıyordu: tekil haktan
   * yapılan iş "Seanslar"a, paketten yapılan iş "İşlemler"e düşebiliyordu.
   * Bağı olmayan ESKİ kayıtlar için sezgi korunur.
   */
  const isFromPackage = useMemo(() => (ap: { price: number; serviceDefinitionId?: string; sourceSessionId?: string | null }): boolean => {
    if (Number(ap.price || 0) > 0) return false // ücretli randevu seans TÜKETMEZ
    if (ap.sourceSessionId) return packageSessionIds.has(ap.sourceSessionId)
    return Boolean(ap.serviceDefinitionId) && packageServiceIds.has(ap.serviceDefinitionId!)
  }, [packageSessionIds, packageServiceIds])

  /** Hizmet → o hizmeti satan personel (satışın carisinden). "Kim verdi" sorusunun cevabı. */
  const soldByService = useMemo(() => {
    const accountById = new Map(accounts.map((a) => [a.id, a]))
    const map = new Map<string, string>()
    for (const s of effectiveSessions) {
      if (!s.serviceDefinitionId || !s.customerAccountId) continue
      const seller = accountById.get(s.customerAccountId)?.soldByStaffName
      if (seller && !map.has(s.serviceDefinitionId)) map.set(s.serviceDefinitionId, seller)
    }
    return map
  }, [effectiveSessions, accounts])

  const apptTs = (ap: { date: string; time: string }): number =>
    Date.parse(`${ap.date}T${ap.time || '00:00'}:00`) || Date.parse(ap.date || '') || 0

  /** PAKETTEN kullanılan seanslar: tamamlanmış ücretsiz randevular + adisyon "Paketten" kalemleri. */
  const sessionRows = useMemo<HistoryRow[]>(() => {
    const rows: HistoryRow[] = []
    for (const ap of appointments) {
      if (ap.status !== 'tamamlandi') continue
      // ÜCRETLİ randevu seans TÜKETMEZ; paket defterine girmez (İşlemler'de görünür).
      if (!isFromPackage(ap)) continue
      rows.push({
        key: `ap-${ap.id}`,
        ts: apptTs(ap),
        desc: ap.islem || 'Seans',
        appliedBy: ap.personel || null,
        soldBy: null,
        trailing: 'Randevu',
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
          desc: it.description,
          appliedBy: it.staffName,
          soldBy: null,
          trailing: 'Adisyon',
          tone: 'package',
        })
      }
    }
    return rows.sort((x, y) => y.ts - x.ts)
  }, [appointments, adisyonlar, isFromPackage])

  /** HİZMETTEN yaptırılanlar: tekil hizmet satışına/ücretli randevuya dayanan işler. */
  const operationRows = useMemo<HistoryRow[]>(() => {
    const rows: HistoryRow[] = []
    for (const ap of appointments) {
      if (ap.status !== 'tamamlandi') continue
      // İki sekme AYNI yargıyı kullanır: bir iş ya buraya ya Seanslar'a düşer, ikisine birden değil.
      if (isFromPackage(ap)) continue
      rows.push({
        key: `apop-${ap.id}`,
        ts: apptTs(ap),
        desc: ap.islem || 'Hizmet',
        appliedBy: ap.personel || null,
        soldBy: (ap.serviceDefinitionId && soldByService.get(ap.serviceDefinitionId)) || null,
        trailing: Number(ap.price || 0) > 0 ? formatTL(Number(ap.price)) : 'Hizmet hakkı',
        tone: 'plain',
      })
    }
    // Adisyonda salonda verilen hizmetler (randevusuz ek işlem dahil).
    for (const a of adisyonlar) {
      const fallback = Date.parse(a.approvedAtUtc || a.openedAtUtc || '') || 0
      for (const it of a.items) {
        if (it.type !== 'Service' && it.type !== 'Extra') continue
        if (it.coveredByPackage) continue
        rows.push({
          key: `it-${it.id}`,
          ts: Date.parse(it.createdAtUtc || '') || fallback,
          desc: it.description,
          appliedBy: it.staffName,
          soldBy: it.staffName,
          trailing: formatTL(it.lineTotal),
          tone: 'plain',
        })
      }
    }
    return rows.sort((x, y) => y.ts - x.ts)
  }, [appointments, adisyonlar, isFromPackage, soldByService])

  /**
   * Ödeme listesi carilerin TAHSİLAT satırlarından kurulur (adisyondaki ödeme kalemi onayda
   * zaten cariye tahsilat olarak yazılır — ikisini birleştirmek aynı parayı iki kez gösterirdi).
   */
  const paymentRows = useMemo<HistoryRow[]>(() => {
    const rows: HistoryRow[] = []
    for (const acc of accounts) {
      for (const p of acc.payments || []) {
        rows.push({
          key: `pay-${p.id}`,
          ts: Date.parse(p.occurredAtUtc || '') || 0,
          desc: acc.servicePackageName || acc.name,
          appliedBy: paymentMethodLabel(p.method),
          soldBy: null,
          trailing: `+${formatTL(p.amount)}`,
          tone: 'in',
        })
      }
    }
    return rows.sort((x, y) => y.ts - x.ts)
  }, [accounts])

  const rows = tab === 'sessions' ? sessionRows : tab === 'operations' ? operationRows : paymentRows

  const remainingTotal = useMemo(
    () => packageGroups.reduce((n, g) => n + g.rows.reduce((m, r) => m + r.remaining, 0), 0),
    [packageGroups],
  )
  const paidTotal = useMemo(
    () => accounts.reduce((sum, a) => sum + (a.payments || []).reduce((s, p) => s + p.amount, 0), 0),
    [accounts],
  )
  const caption =
    tab === 'sessions'
      ? packageGroups.length > 0
        ? `${packageGroups.length} paket · ${remainingTotal} seans kaldı · ${sessionRows.length} kullanım`
        : 'Satın alınmış paket yok'
      : tab === 'operations'
        ? `${operationRows.length} işlem`
        : `${paymentRows.length} tahsilat · ${formatTL(paidTotal)}`

  const emptyText =
    tab === 'sessions'
      ? 'Paketten henüz seans kullanılmamış.'
      : tab === 'operations'
        ? 'Tek tek hizmet seçilerek yaptırılmış işlem yok.'
        : 'Bu müşteriden henüz tahsilat alınmamış.'

  // Adisyon kapalıyken işlem defteri yalnız randevulardan dolar; sekme yine de anlamlıdır.
  useEffect(() => {
    if (!canAdisyon && tab === 'operations' && operationRows.length === 0) setTab('sessions')
  }, [canAdisyon, tab, operationRows.length])

  return (
    <div className="rounded-2xl border border-[#efe1e7] bg-white p-4">
      <h4 className="font-display text-[13.5px] font-extrabold tracking-[-0.01em] text-[#2b1e29]">Müşteri geçmişi</h4>

      {/* Sekmeler */}
      <div className="mt-2.5 inline-flex w-full items-center gap-1 rounded-xl border border-[#efe1e7] bg-[#fdf9fb] p-1">
        {TABS.map((t) => (
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

      {/* SEANSLAR: önce kalan bakiye (paket → işlem kırılımı), sonra kullanım geçmişi. */}
      {tab === 'sessions' && packageGroups.length > 0 && (
        <div className="mt-2 space-y-2">
          {packageGroups.map((g) => (
            <div key={g.packageId} className="rounded-xl border border-[#f0e2e9] bg-[#fdf9fb] px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[12px] font-bold text-[#2b1e29]">{g.name}</span>
                {/* NET CEVAP: "3 / 4 seans" hangi sayının kalan olduğunu söylemiyordu. */}
                {(() => {
                  const rem = g.rows.reduce((n, r) => n + r.remaining, 0)
                  return (
                    <span className={`shrink-0 text-[11px] font-semibold ${rem > 0 ? 'text-[#8e3f5b]' : 'text-[#705a66]'}`}>
                      {rem > 0 ? `${rem} seans kaldı` : 'Seans kalmadı'}
                    </span>
                  )
                })()}
              </div>
              <ul className="mt-1.5 space-y-1">
                {g.rows.map((r) => (
                  <li key={r.serviceDefinitionId} className="flex items-baseline justify-between gap-2 text-[11.5px]">
                    <span className="min-w-0 truncate text-[#4a3a44]">{r.serviceName}</span>
                    <span className="shrink-0 font-semibold text-[#705a66]">
                      {r.remaining > 0 ? (
                        <>
                          <span className="tabular-nums text-[#8e3f5b]">{r.remaining} seans kaldı</span>
                          <span className="ml-1.5 text-[10.5px] tabular-nums">({r.total} seanslık)</span>
                        </>
                      ) : (
                        <span className="tabular-nums">Bitti ({r.total} seans kullanıldı)</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Tablo başlığı */}
      <div className="mt-2 grid grid-cols-[64px_1fr_auto] items-center gap-2 border-b border-[#f4e8ee] pb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#a3576f]">
        <span>Tarih</span>
        <span>{tab === 'sessions' ? 'Kullanılan seans' : tab === 'operations' ? 'İşlem' : 'Satış'}</span>
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
                  {/* İşlemler sekmesinde İKİ KİŞİ vardır: satan ve uygulayan. */}
                  <span className="block truncate text-[11px] text-[#705a66]">
                    {tab === 'operations'
                      ? [
                          r.soldBy ? `Satan: ${r.soldBy}` : 'Satan belirtilmemiş',
                          r.appliedBy ? `Yapan: ${r.appliedBy}` : 'Yapan belirtilmemiş',
                        ].join(' · ')
                      : r.appliedBy || (tab === 'sessions' ? 'Personel belirtilmemiş' : '')}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-right text-[12px] font-semibold tabular-nums ${
                    r.tone === 'in'
                      ? 'text-emerald-700'
                      : r.tone === 'package'
                        ? 'text-[#b8863b]'
                        : 'text-[#4a3a44]'
                  }`}
                >
                  {r.trailing || '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
