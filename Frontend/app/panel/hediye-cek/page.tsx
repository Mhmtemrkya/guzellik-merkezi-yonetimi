'use client'

import { Suspense, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { apiItems, formatTL, guidOrUndefined, normalizeGiftCard, normalizePackage, normalizeService } from '@/lib/apiMappers'
import type { ApiGiftCard, ApiService, ApiServicePackage, GiftCard, GiftCardKind } from '@/lib/types'
import GiftCardShareModal from '@/components/dashboard/GiftCardShareModal'
import CustomerPicker, { customerSearchProvider, type CustomerPickerItem } from '@/components/dashboard/CustomerPicker'
import CatalogPicker, { type PickerItem } from '@/components/dashboard/CatalogPicker'
import GiftCardScanModal from '@/components/dashboard/GiftCardScanModal'
import { CheckCircle2, Gift, Image as ImageIcon, Link2, Lock, Percent, Plus, Power, QrCode, Sparkles, Ticket, Trash2, Wallet, XCircle } from 'lucide-react'

type ScopeKey = 'all' | 'active' | 'stored' | 'coupon'

const kindMeta: Record<GiftCardKind, { label: string; icon: typeof Gift }> = {
  Percentage: { label: 'Yüzde İndirim', icon: Percent },
  FixedAmount: { label: 'Sabit İndirim', icon: Ticket },
  StoredValue: { label: 'Hediye Çeki', icon: Wallet },
}

function statusBadge(g: GiftCard): { label: string; cls: string; Icon: typeof CheckCircle2 } {
  if (g.isValid) return { label: 'Geçerli', cls: 'text-[#2f9e72] bg-[#2f9e72]/12 border-[#2f9e72]/30', Icon: CheckCircle2 }
  if (g.isActive) return { label: 'Süresi/hakkı doldu', cls: 'text-[#d1556f] bg-[#d1556f]/10 border-[#d1556f]/25', Icon: XCircle }
  return { label: 'Pasif', cls: 'text-[#74616A] bg-[#705a66]/10 border-[#705a66]/20', Icon: XCircle }
}

/* ----- İmza bileşen: gerçek hediye-kartı / bilet görünümlü kart ----- */
function GiftCardTile({
  card,
  index,
  busy,
  onToggleActive,
  onDelete,
  onShow,
}: {
  card: GiftCard
  index: number
  busy: boolean
  onToggleActive: () => void
  onDelete: () => void
  /** Basılabilir/gönderilebilir kart görselini açar. */
  onShow: () => void
}) {
  const meta = kindMeta[card.kind]
  const Icon = meta.icon
  const status = statusBadge(card)

  // Üst görsel — türüne göre farklı bilet/kart estetiği
  let visual: ReactNode
  if (card.kind === 'StoredValue') {
    // Metalik gül-altın hediye çeki
    visual = (
      <div className="gc-metallic relative flex min-h-[212px] flex-col overflow-hidden rounded-t-[22px] p-5">
        {/* parlak köşe vurgusu */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_85%_at_85%_-15%,rgba(255,255,255,0.6),transparent_55%)]" />
        {/* marka monogramı */}
        <div className="pointer-events-none absolute right-4 top-2 select-none font-display text-[42px] font-bold leading-none text-[#7a3450]/20">A</div>
        <div className="relative flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/50 bg-white/55 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#5e2740] backdrop-blur">
            <Icon className="h-3 w-3" strokeWidth={2.2} /> {meta.label}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full border bg-white/55 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider backdrop-blur ${status.cls}`}>
            <status.Icon className="h-3 w-3" /> {status.label}
          </span>
        </div>
        <div className="relative mt-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7a3450]/75">Bakiye</p>
          <p className="mt-1 font-display text-[34px] font-bold leading-none text-[#4a1f33]">
            {formatTL(card.balance)}
            <span className="ml-1.5 align-baseline text-base font-semibold text-[#7a3450]/55">/ {formatTL(card.value)}</span>
          </p>
        </div>
        <div className="relative mt-auto flex items-end justify-between gap-2 border-t border-[#7a3450]/15 pt-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#7a3450]/65">Kod</p>
            <p className="gc-code mt-0.5 text-[15px] font-bold text-[#4a1f33]">{card.code}</p>
          </div>
          <div className="space-y-0.5 text-right text-[10px] font-semibold uppercase tracking-wide text-[#7a3450]/75">
            <p>Kullanım: {card.usedCount}{card.maxUses > 0 ? ` / ${card.maxUses}` : ' / ∞'}</p>
            {card.validUntil && <p>SKT: {new Date(card.validUntil).toLocaleDateString('tr-TR')}</p>}
          </div>
        </div>
      </div>
    )
  } else if (card.kind === 'Percentage') {
    // Yüzde indirim kuponu — sol perforasyonlu beyaz bilet
    visual = (
      <div className="gc-perf-left relative flex min-h-[212px] flex-col rounded-t-[22px] border border-[#EAD8DF] bg-white p-5 pl-8">
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#A5556E]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#A5556E]">
            <Icon className="h-3 w-3" strokeWidth={2.2} /> {meta.label}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${status.cls}`}>
            <status.Icon className="h-3 w-3" /> {status.label}
          </span>
        </div>
        <div className="my-auto py-3 text-center">
          <p className="font-display text-[52px] font-bold leading-none text-[#A5556E]">%{card.value}</p>
          {card.note && <p className="mt-2 text-[12px] font-medium text-[#74616A]">{card.note}</p>}
        </div>
        <div className="mt-auto flex items-end justify-between gap-2 border-t border-[#EAD8DF] pt-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#74616A]">Kod</p>
            <p className="gc-code mt-0.5 text-[15px] font-bold text-[#241923]">{card.code}</p>
          </div>
          <div className="space-y-0.5 text-right text-[10px] font-semibold uppercase tracking-wide text-[#74616A]">
            <p>Kullanım: {card.usedCount}{card.maxUses > 0 ? ` / ${card.maxUses}` : ' / ∞'}</p>
            {card.validUntil && <p>SKT: {new Date(card.validUntil).toLocaleDateString('tr-TR')}</p>}
          </div>
        </div>
      </div>
    )
  } else {
    // Sabit tutar kuponu — krem/altın kesik kenarlı bilet
    visual = (
      <div className="gc-perf-edges relative flex min-h-[212px] flex-col rounded-t-[22px] border border-[#e7cfa6]/60 bg-[#fbf3e6] p-5">
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#b88938]/25 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#9a6f22]">
            <Icon className="h-3 w-3" strokeWidth={2.2} /> {meta.label}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${status.cls}`}>
            <status.Icon className="h-3 w-3" /> {status.label}
          </span>
        </div>
        <div className="my-auto py-3 text-center">
          <p className="font-display text-[46px] font-bold leading-none text-[#9a6f22]">{formatTL(card.value)}</p>
          {card.note && <p className="mt-2 text-[12px] font-medium text-[#74616A]">{card.note}</p>}
        </div>
        <div className="mt-auto flex items-end justify-between gap-2 border-t border-[#b88938]/25 pt-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#74616A]">Kod</p>
            <p className="gc-code mt-0.5 rounded-md bg-white px-2 py-0.5 text-[15px] font-bold text-[#241923]">{card.code}</p>
          </div>
          <div className="space-y-0.5 text-right text-[10px] font-semibold uppercase tracking-wide text-[#74616A]">
            <p>Kullanım: {card.usedCount}{card.maxUses > 0 ? ` / ${card.maxUses}` : ' / ∞'}</p>
            {card.validUntil && <p>SKT: {new Date(card.validUntil).toLocaleDateString('tr-TR')}</p>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -5 }}
      className={`flex h-full flex-col rounded-[24px] shadow-[0_20px_44px_-28px_rgba(200,87,118,0.55)] ${
        card.isValid ? '' : 'opacity-70 grayscale transition-all duration-500 hover:opacity-100 hover:grayscale-0'
      }`}
    >
      {visual}
      {/* Aksiyon barı */}
      <div className="flex flex-wrap gap-2 rounded-b-[22px] border border-t-0 border-[#EAD8DF] bg-white/96 p-3">
        {/* Asıl eylem: kartın müşteriye gidecek hâlini aç (indir / yazdır / paylaş). */}
        <button
          type="button"
          onClick={onShow}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-[12px] bg-gradient-to-r from-[#A5556E] to-[#8C4460] px-2.5 py-2 text-[11.5px] font-semibold text-white transition-transform hover:-translate-y-0.5"
        >
          <ImageIcon className="h-3.5 w-3.5" /> Kartı göster
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onToggleActive}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-[#f7ecf1] px-2.5 py-2 text-[11px] font-semibold text-[#5d4a56] transition-colors hover:bg-[#efdfe7] hover:text-[#A5556E] disabled:opacity-50"
        >
          <Power className="h-3.5 w-3.5" /> {card.isActive ? 'Pasifleştir' : 'Aktifleştir'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-[#d1556f]/10 px-2.5 py-2 text-[11px] font-semibold text-[#cf4d68] transition-colors hover:bg-[#d1556f]/18 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" /> Sil
        </button>
      </div>
    </motion.div>
  )
}

function HediyeCekPageInner() {
  const search = useSearchParams()
  const scopeParam = (search?.get('scope') as ScopeKey | null) ?? 'all'
  const scope: ScopeKey = ['all', 'active', 'stored', 'coupon'].includes(scopeParam) ? scopeParam : 'all'

  const { selectedInstitutionId, selectedInstitution, selectedBranch } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const branchId = guidOrUndefined(selectedBranch?.id || selectedBranch?.branchId)

  const { data, loading, error, reload } = useApiQuery<ApiGiftCard[]>(
    async () => (tenantId ? adminApi.giftCards<ApiGiftCard>(tenantId).catch(() => []) : []),
    [tenantId],
    { initialData: [] },
  )
  const cards = useMemo(() => (data || []).map((g, i) => normalizeGiftCard(g, i)), [data])

  /*
   * KATALOG (hizmet + paket). Çek serbest metne değil GERÇEK KAYDA bağlanır: satış ekranı
   * müşterinin çekini görünce doğru hizmeti/paketi kendiliğinden seçebilsin diye. Serbest
   * metinden eşleştirme denemek ("El ve Ayak Bakım" ≟ "El & Ayak Bakımı") kırılgan olurdu.
   */
  const { data: catalog } = useApiQuery<{ services: ApiService[]; packages: ApiServicePackage[] }>(
    async () => {
      if (!tenantId) return { services: [], packages: [] }
      const [svc, pkg] = await Promise.all([
        adminApi.services<ApiService>({ tenantId, page: 1, pageSize: 500 }).catch(() => ({ items: [] })),
        adminApi.packages<ApiServicePackage>({ tenantId, page: 1, pageSize: 500 }).catch(() => ({ items: [] })),
      ])
      return { services: apiItems(svc), packages: apiItems(pkg) }
    },
    [tenantId],
    { initialData: { services: [], packages: [] } },
  )

  const serviceItems = useMemo<PickerItem[]>(
    () => (catalog?.services || []).map((s, i) => {
      const n = normalizeService(s, i)
      return { id: n.id, name: n.name, price: n.price, cat: n.group || '', sub: n.subGroup || '', meta: `${n.duration} dk` }
    }),
    [catalog],
  )
  const packageItems = useMemo<PickerItem[]>(
    () => (catalog?.packages || []).map((p, i) => {
      const n = normalizePackage(p, i)
      return { id: n.id, name: n.name, price: n.totalPrice, cat: n.category || '', sub: '', meta: `${n.items.length} hizmet` }
    }),
    [catalog],
  )

  // Kart görseline basılacak kurum logosu. Hata YUTULUR: logo bulunamazsa kart yine çizilir,
  // sadece logonun yerine kurum adı yazılır (bkz. GiftCardArtwork).
  const { data: profile } = useApiQuery<{ logoData?: string | null; slug?: string | null } | null>(
    async () => (tenantId ? adminApi.publicProfile<{ logoData?: string | null; slug?: string | null }>().catch(() => null) : null),
    [tenantId],
    { initialData: null },
  )

  const filtered = useMemo(() => {
    switch (scope) {
      case 'active':
        return cards.filter((c) => c.isValid)
      case 'stored':
        return cards.filter((c) => c.kind === 'StoredValue')
      case 'coupon':
        return cards.filter((c) => c.kind !== 'StoredValue')
      default:
        return cards
    }
  }, [cards, scope])

  // ----- Oluşturma formu -----
  const [kind, setKind] = useState<GiftCardKind>('StoredValue')
  const [value, setValue] = useState('')
  const [code, setCode] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [validFrom, setValidFrom] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [note, setNote] = useState('')
  /**
   * Çekin bağlandığı katalog kaydı — 'service' | 'package'. Seçilince kartın üzerine basılan
   * kapsam metni de kendiliğinden dolar (kullanıcı isterse üzerine yazabilir).
   */
  const [targetKind, setTargetKind] = useState<'service' | 'package'>('service')
  const [targetId, setTargetId] = useState('')
  /** Kartın üzerine basılan kapsam ve alıcı — ikisi de opsiyonel. */
  const [scopeLabel, setScopeLabel] = useState('')
  const [recipientName, setRecipientName] = useState('')
  /**
   * Kartın bağlanacağı müşteri (opsiyonel). Bağlanırsa alıcı adı ve WhatsApp numarası
   * kendiliğinden gelir — gönderimde numara elle yazılmak zorunda kalmaz.
   */
  const [customer, setCustomer] = useState<CustomerPickerItem | null>(null)
  /** Seçili katalog kaydı — kapsam metnini ve rozeti besler. */
  const selectedTarget = useMemo(
    () => (targetKind === 'service' ? serviceItems : packageItems).find((i) => i.id === targetId) ?? null,
    [targetKind, targetId, serviceItems, packageItems],
  )

  /*
   * QR İLE MÜŞTERİ EŞLEŞTİRME. Kart müşterisiz basılıp elden verilir; sonra işletme QR'ı
   * okutup "bu kart şu müşterinin" der. Sıra ÖNEMLİ: önce müşteri seçilir, sonra okutulur —
   * tersi olsaydı okunan kart bir yere iliştirilene kadar havada kalırdı.
   */
  const [assignCustomer, setAssignCustomer] = useState<CustomerPickerItem | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [scanBusy, setScanBusy] = useState(false)
  const [scanError, setScanError] = useState('')
  const [assignNotice, setAssignNotice] = useState('')

  /** Görseli açılan kart. */
  const [shareCard, setShareCard] = useState<GiftCard | null>(null)
  /**
   * Kart→müşteri telefonu eşlemesi. Liste ucu telefon döndürmediği için (ve şifreli alan
   * olduğundan sunucuda da aranamadığı için) seçim anında burada tutulur; gönderim kutusuna
   * ön-dolum bundan gelir. Bilinmiyorsa kutu boş açılır, kullanıcı elle yazar.
   */
  const [phoneByCard, setPhoneByCard] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const resetForm = (): void => {
    setValue('')
    setCode('')
    setValidFrom('')
    setValidUntil('')
    setMaxUses('')
    setNote('')
    setScopeLabel('')
    setRecipientName('')
    setCustomer(null)
    setTargetId('')
  }

  const handleCreate = async (): Promise<void> => {
    const numericValue = Number(value)
    if (!numericValue || numericValue <= 0) {
      setActionError('Geçerli bir değer girin.')
      return
    }
    if (kind === 'Percentage' && numericValue > 100) {
      setActionError('Yüzde indirim 100’ü aşamaz.')
      return
    }
    setBusy(true)
    setActionError('')
    try {
      const created = await adminApi.createGiftCard<{ id?: string }>(
        {
          code: code.trim() || null,
          kind,
          value: numericValue,
          // Başlangıç günün BAŞI, bitiş günün SONU: iki tarih de dahildir (kartta öyle yazar).
          validFromUtc: validFrom ? new Date(`${validFrom}T00:00:00`).toISOString() : null,
          validUntilUtc: validUntil ? new Date(`${validUntil}T23:59:59`).toISOString() : null,
          maxUses: maxUses ? Number(maxUses) : 0,
          note: note.trim() || null,
          // Kapsam metni yazılmadıysa seçilen katalog kaydının adı karta basılır.
          scopeLabel: scopeLabel.trim() || selectedTarget?.name || null,
          serviceDefinitionId: targetKind === 'service' ? targetId || null : null,
          servicePackageId: targetKind === 'package' ? targetId || null : null,
          // Alıcı adı yazılmadıysa seçilen müşterinin adı karta basılır.
          recipientName: recipientName.trim() || customer?.name || null,
          customerId: customer?.id ?? null,
          branchId: branchId ?? null,
        },
        tenantId,
      )
      // Yeni kartın telefonu hemen eşlensin: "Kartı göster" ile açılan gönderim kutusu
      // ön-dolu gelsin diye (liste ucu telefonu döndürmüyor).
      const createdId = (created as { id?: string } | null)?.id
      if (createdId && customer?.phone) {
        setPhoneByCard((m) => ({ ...m, [createdId]: customer.phone as string }))
      }
      resetForm()
      await reload()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Oluşturulamadı.')
    } finally {
      setBusy(false)
    }
  }

  const runAction = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setActionError('')
    try {
      await fn()
      await reload()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'İşlem başarısız.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Okunan kodu seçili müşteriye bağlar. Kart BAŞKA bir müşteriye tanımlıysa sunucu 409 döner;
   * kullanıcıya sorulur ve onaylarsa devir açık izinle tekrarlanır (sessizce üzerine yazılmaz).
   */
  const assignScanned = async (code: string): Promise<void> => {
    if (!assignCustomer) { setScanError('Önce müşteri seçin.'); return }
    setScanBusy(true)
    setScanError('')
    try {
      await adminApi.assignGiftCardCustomer({ code, customerId: assignCustomer.id }, tenantId)
      setAssignNotice(`${code} kartı ${assignCustomer.name} adlı müşteriye tanımlandı.`)
      setScanOpen(false)
      setAssignCustomer(null)
      await reload()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Eşleştirilemedi.'
      // 409 → devir onayı. Mesaj sunucudan geldiği gibi gösterilir, karar kullanıcınındır.
      if (/başka bir müşteriye/i.test(message)) {
        const ok = window.confirm(`${message}

Bu kartı ${assignCustomer.name} adlı müşteriye devretmek istiyor musunuz?`)
        if (ok) {
          try {
            await adminApi.assignGiftCardCustomer({ code, customerId: assignCustomer.id, allowReassign: true }, tenantId)
            setAssignNotice(`${code} kartı ${assignCustomer.name} adlı müşteriye devredildi.`)
            setScanOpen(false)
            setAssignCustomer(null)
            await reload()
            return
          } catch (e2) {
            setScanError(e2 instanceof Error ? e2.message : 'Devredilemedi.')
            return
          }
        }
        setScanError('')
        return
      }
      setScanError(message)
    } finally {
      setScanBusy(false)
    }
  }

  const stats = useMemo(() => {
    const active = cards.filter((c) => c.isValid).length
    const storedBalance = cards.filter((c) => c.kind === 'StoredValue').reduce((s, c) => s + c.balance, 0)
    return { total: cards.length, active, storedBalance }
  }, [cards])

  const valueLabel = kind === 'Percentage' ? 'Yüzde (%)' : kind === 'StoredValue' ? 'Yüklenecek bakiye' : 'İndirim tutarı'
  const valueAdorn = kind === 'Percentage' ? '%' : '₺'

  const featureAllowed = useFeature('marketing.giftcards')
  /** WhatsApp gönderimi ayrı bir paket özelliği — kapalıysa gönder düğmesi hiç çizilmez. */
  const canWhatsApp = useFeature('notifications.whatsapp')
  if (!featureAllowed) {
    return (
      <>
        <Topbar title="Hediye Çeki & Kupon" subtitle="Pakete dahil değil" breadcrumbs={['Admin', 'İşletme', 'Hediye Çeki']} />
        <div className="mx-auto mt-10 max-w-md rounded-[22px] border border-[#EAD8DF] bg-white p-8 text-center">
          <Lock className="mx-auto h-8 w-8 text-[#A5556E]/60" />
          <div className="mt-3 font-display text-xl text-[#241923]">Hediye Çeki & Kupon</div>
          <p className="mt-2 text-[13px] text-[#74616A]">Bu özellik paketinizde yok. Üst pakete geçerek hediye çeki ve kupon tanımlayabilirsiniz.</p>
        </div>
      </>
    )
  }

  const statCards = [
    { label: 'Toplam kod', value: String(stats.total), icon: Gift, chip: 'bg-[#fbeaf1] text-[#A5556E]' },
    { label: 'Geçerli (aktif)', value: String(stats.active), icon: CheckCircle2, chip: 'bg-[#e6f5ee] text-[#2f9e72]' },
    { label: 'Hediye çeki bakiyesi', value: formatTL(Math.round(stats.storedBalance)), icon: Wallet, chip: 'bg-[#f7eed9] text-[#b88938]' },
  ]

  const tabs: [ScopeKey, string][] = [
    ['all', 'Tümü'],
    ['active', 'Aktif'],
    ['stored', 'Hediye çeki'],
    ['coupon', 'Kupon'],
  ]

  return (
    <>
      <Topbar
        title="Hediye Çeki & Kupon"
        subtitle={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Tüm şubeler'}`}
        breadcrumbs={['Admin', 'İşletme', 'Hediye Çeki']}
      />

      <div className="relative mx-auto w-full max-w-[1600px] space-y-7 p-4 sm:p-6 xl:px-8">
        {/* Özet */}
        <div className="grid gap-4 sm:grid-cols-3">
          {statCards.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.05 }}
              className="flex items-start gap-4 rounded-[20px] border border-[#EAD8DF] bg-white/95 p-5 shadow-[0_12px_30px_-20px_rgba(200,87,118,0.5)]"
            >
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${s.chip}`}>
                <s.icon className="h-5 w-5" strokeWidth={1.9} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#74616A]">{s.label}</p>
                <p className="mt-1 truncate font-display text-[28px] font-bold leading-tight text-[#241923]">{s.value}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Oluşturma formu */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          className="rounded-[22px] border border-[#EAD8DF] bg-white/95 p-5 shadow-[0_14px_34px_-24px_rgba(200,87,118,0.5)] sm:p-6"
        >
          <div className="flex items-center gap-3 border-b border-[#EAD8DF] pb-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#A5556E] to-[#8C4460] text-white shadow-[0_8px_16px_-8px_rgba(214,95,131,0.9)]">
              <Plus className="h-4 w-4" strokeWidth={2.5} />
            </div>
            <h2 className="font-display text-lg font-bold text-[#241923]">Yeni hediye çeki / kupon oluştur</h2>
            <Sparkles className="ml-auto h-4 w-4 text-[#e9a6bf]" />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#74616A]">Tür</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as GiftCardKind)}
                className="w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] text-[#2A2027] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40"
              >
                <option value="StoredValue">Hediye Çeki (yüklü bakiye)</option>
                <option value="Percentage">Yüzde İndirim Kuponu</option>
                <option value="FixedAmount">Sabit Tutar İndirim Kuponu</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#74616A]">{valueLabel}</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-[#a98a98]">{valueAdorn}</span>
                <input
                  type="number"
                  min={0}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={kind === 'Percentage' ? 'örn. 15' : 'örn. 500'}
                  className="w-full rounded-[12px] border border-[#EAD8DF] bg-white py-2.5 pl-8 pr-3 text-[13px] text-[#2A2027] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40"
                />
              </div>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#74616A]">Kod (boş = otomatik)</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="örn. YILBASI25"
                style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.12em' }}
                className="w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] uppercase text-[#2A2027] outline-none transition placeholder:tracking-normal placeholder:text-[#c9b3bd] focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#74616A]">Geçerlilik başlangıcı (ops.)</span>
              <input
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
                className="w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] text-[#2A2027] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#74616A]">Son geçerlilik (ops.)</span>
              <input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] text-[#2A2027] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#74616A]">Maks. kullanım (0 = sınırsız)</span>
              <input
                type="number"
                min={0}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder="0"
                className="w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] text-[#2A2027] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#74616A]">Açıklama (ops.)</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="örn. Yılbaşı kampanyası"
                className="w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] text-[#2A2027] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40"
              />
              <span className="mt-1 block text-[10.5px] text-[#74616A]">Sadece iç kayıt notu — kartın üzerine basılmaz.</span>
            </label>
            {/* Aşağıdaki iki alan KARTIN ÜZERİNE BASILIR (iç not değil). */}
            {/* KATALOG BAĞI — çekin hangi hizmet/paket için geçerli olduğu. */}
            <div className="sm:col-span-2 lg:col-span-3">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold text-[#74616A]">Hangi hizmet / paket için? (ops.)</span>
                <div className="inline-flex rounded-full border border-[#EAD8DF] bg-[#F7F6F6] p-0.5">
                  {(['service', 'package'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => { setTargetKind(k); setTargetId('') }}
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                        targetKind === k ? 'bg-[#A5556E] text-white' : 'text-[#5A4B53] hover:text-[#8C4460]'
                      }`}
                    >
                      {k === 'service' ? 'Hizmet' : 'Paket'}
                    </button>
                  ))}
                </div>
                {selectedTarget && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#8ED6B4] bg-[#DFF3EA] px-2.5 py-0.5 text-[10.5px] font-semibold text-[#15694A]">
                    <Link2 className="h-3 w-3" /> {selectedTarget.name}
                  </span>
                )}
              </div>
              <CatalogPicker
                items={targetKind === 'service' ? serviceItems : packageItems}
                value={targetId}
                clearable
                onChange={setTargetId}
                emptyText={targetKind === 'service' ? 'Hizmet bulunamadı.' : 'Paket bulunamadı.'}
              />
              <span className="mt-1 block text-[10.5px] text-[#74616A]">
                Bağlarsanız satış ekranı, çeki olan müşteride bu hizmeti/paketi kendiliğinden seçer.
              </span>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#74616A]">Kartta yazacak kapsam (ops.)</span>
              <input
                value={scopeLabel}
                onChange={(e) => setScopeLabel(e.target.value)}
                placeholder={selectedTarget?.name || 'örn. El ve Ayak Bakım'}
                className="w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] text-[#2A2027] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40"
              />
              <span className="mt-1 block text-[10.5px] text-[#74616A]">Kartta “…geçerli <b>El ve Ayak Bakım</b> çekidir.” diye yazar. Boşsa “tüm hizmetlerde”.</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#74616A]">Müşteriye bağla (ops.)</span>
              <CustomerPicker
                items={customer ? [customer] : []}
                value={customer?.id ?? ''}
                onChange={(id) => { if (!id) setCustomer(null) }}
                onSelectItem={(item) => setCustomer(item)}
                onSearch={customerSearchProvider(tenantId)}
                placeholder="İsim veya telefonla ara…"
              />
              <span className="mt-1 block text-[10.5px] text-[#74616A]">
                Bağlarsanız kartın alıcı adı ve WhatsApp numarası kendiliğinden gelir.
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#74616A]">Kartta yazacak alıcı (ops.)</span>
              <input
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="örn. Ayşe Yılmaz"
                className="w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] text-[#2A2027] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40"
              />
              <span className="mt-1 block text-[10.5px] text-[#74616A]">Boş bırakılırsa kartta noktalı boşluk kalır, elle yazılır.</span>
            </label>
          </div>
          {actionError && <div className="mt-4 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-700">{actionError}</div>}
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={handleCreate}
              className="inline-flex items-center gap-2 rounded-[14px] bg-gradient-to-r from-[#A5556E] to-[#8C4460] px-6 py-2.5 text-[13px] font-semibold text-white shadow-[0_16px_30px_-16px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} /> Oluştur
            </button>
          </div>
        </motion.div>

        {/* QR İLE MÜŞTERİ EŞLEŞTİRME — basılı kartı müşteriye bağlama. */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.12 }}
          className="rounded-[22px] border border-[#EAD8DF] bg-white/95 p-5 shadow-[0_14px_34px_-24px_rgba(200,87,118,0.5)] sm:p-6"
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-[#EAD8DF] pb-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#A5556E] to-[#8C4460] text-white">
              <QrCode className="h-4 w-4" strokeWidth={2.2} />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-bold text-[#241923]">Kartı müşteriye tanımla</h2>
              <p className="text-[11.5px] text-[#74616A]">
                Basılı kartı verdikten sonra: önce müşteriyi seçin, sonra kartın üzerindeki QR&apos;ı okutun.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-[#74616A]">1. Müşteri</span>
              <CustomerPicker
                items={assignCustomer ? [assignCustomer] : []}
                value={assignCustomer?.id ?? ''}
                onChange={(id) => { if (!id) setAssignCustomer(null) }}
                onSelectItem={(item) => { setAssignCustomer(item); setAssignNotice('') }}
                onSearch={customerSearchProvider(tenantId)}
                placeholder="İsim veya telefonla ara…"
              />
            </label>
            <button
              type="button"
              disabled={!assignCustomer}
              onClick={() => { setScanError(''); setScanOpen(true) }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] bg-gradient-to-r from-[#A5556E] to-[#8C4460] px-5 text-[13px] font-semibold text-white shadow-[0_16px_30px_-16px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
            >
              <QrCode className="h-4 w-4" /> 2. QR okut
            </button>
          </div>

          {assignNotice && (
            <p className="mt-3 rounded-[12px] border border-[#8ED6B4] bg-[#DFF3EA] px-3 py-2 text-[12px] font-medium text-[#15694A]">
              {assignNotice}
            </p>
          )}
        </motion.div>

        <GiftCardScanModal
          open={scanOpen}
          onClose={() => setScanOpen(false)}
          onScanned={(code) => void assignScanned(code)}
          busy={scanBusy}
          error={scanError}
          title="Kartı müşteriye tanımla"
          hint={assignCustomer ? `${assignCustomer.name} adlı müşteriye bağlanacak.` : undefined}
        />

        {/* Filtre sekmeleri */}
        <div className="flex flex-wrap items-center gap-1 border-b border-[#EAD8DF]">
          {tabs.map(([key, label]) => (
            <a
              key={key}
              href={`/panel/hediye-cek?scope=${key}`}
              className={`relative px-4 py-2.5 text-[13px] font-semibold transition-colors ${
                scope === key ? 'text-[#A5556E]' : 'text-[#74616A] hover:text-[#241923]'
              }`}
            >
              {label}
              {scope === key && (
                <motion.span layoutId="gc-tab-underline" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[#A5556E]" />
              )}
            </a>
          ))}
        </div>

        <ApiStateNotice
          loading={loading}
          error={error}
          empty={!loading && !error && filtered.length === 0}
          emptyMessage="Bu filtrede kayıt yok. Yukarıdan yeni bir hediye çeki/kupon oluşturabilirsin."
        />

        {/* Kartın müşteriye gidecek hâli — indir / yazdır / paylaş. */}
        <GiftCardShareModal
          card={shareCard}
          open={shareCard !== null}
          onClose={() => setShareCard(null)}
          salonName={selectedInstitution?.name || 'Güzellik Merkezi'}
          salonSlug={profile?.slug ?? null}
          logoDataUrl={profile?.logoData ?? null}
          defaultPhone={shareCard ? (phoneByCard[shareCard.id] ?? '') : ''}
          /* Gönderim yalnız WhatsApp özelliği açıkken sunulur: kapalıyken düğmeyi gösterip
             sunucudan 409 almak, kullanıcıya boşuna bir yol denetiyordu. */
          onSendWhatsApp={
            canWhatsApp && shareCard
              ? async (pdfBase64, phone) => {
                  await adminApi.sendGiftCardWhatsapp(
                    { giftCardId: shareCard.id, phone, pdfBase64 },
                    tenantId,
                  )
                }
              : undefined
          }
        />

        {/* Kart ızgarası */}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((g, i) => (
            <GiftCardTile
              key={g.id}
              card={g}
              index={i}
              busy={busy}
              onToggleActive={() => runAction(() => adminApi.setGiftCardActive(g.id, !g.isActive, tenantId))}
              onDelete={() => runAction(() => adminApi.deleteGiftCard(g.id, tenantId))}
              onShow={() => setShareCard(g)}
            />
          ))}
        </div>
      </div>
    </>
  )
}

export default function HediyeCekPage() {
  return (
    <Suspense fallback={null}>
      <HediyeCekPageInner />
    </Suspense>
  )
}
