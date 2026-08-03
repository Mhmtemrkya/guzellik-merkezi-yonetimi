'use client'

import { useEffect, useMemo, useState } from 'react'
import { useApiQuery } from '@/hooks/useApiQuery'
import ConfirmDialog from '@/components/dashboard/ConfirmDialog'
import { useAuth } from '@/components/dashboard/AuthContext'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { useRealtime } from '@/components/dashboard/RealtimeContext'
import { adminApi } from '@/lib/apiClient'
import { apiItems, formatTL, normalizeAdisyon, normalizePackage, normalizeProduct, normalizeService, normalizeStaff } from '@/lib/apiMappers'
import type { ApiAdisyon, ApiProduct, ApiService, ApiServicePackage, ApiStaff, AdisyonItemTypeKey } from '@/lib/types'
import {
  Banknote, Boxes, CalendarDays, CheckCircle2, ChevronDown, Gift, Package, Percent,
  Plus, ReceiptText, Sparkles, Star, Ticket, Trash2, X,
} from 'lucide-react'

const TYPE_LABELS: Record<AdisyonItemTypeKey, string> = {
  Service: 'Hizmet',
  Product: 'Ürün',
  PackageUse: 'Paketten kullan',
  Extra: 'Ek kalem',
  Payment: 'Tahsilat',
  Discount: 'İndirim',
  PackageSale: 'Paket satışı',
}

const TYPE_TONES: Record<AdisyonItemTypeKey, string> = {
  Service: 'border-sky-300/40 bg-sky-50 text-sky-700',
  Product: 'border-violet-300/40 bg-violet-50 text-violet-700',
  PackageUse: 'border-amber-300/40 bg-amber-50 text-amber-700',
  Extra: 'border-slate-300/40 bg-slate-50 text-slate-700',
  Payment: 'border-emerald-300/40 bg-emerald-50 text-emerald-700',
  Discount: 'border-rose-300/40 bg-rose-50 text-rose-700',
  PackageSale: 'border-fuchsia-300/40 bg-fuchsia-50 text-fuchsia-700',
}

/** Kalem satırındaki renk şeridi + ikon — fiş bir bakışta okunsun. */
const TYPE_ICONS: Record<AdisyonItemTypeKey, typeof Sparkles> = {
  Service: Sparkles,
  Product: Package,
  PackageUse: Ticket,
  Extra: Plus,
  Payment: Banknote,
  Discount: Percent,
  PackageSale: Boxes,
}

const TYPE_BARS: Record<AdisyonItemTypeKey, string> = {
  Service: 'bg-sky-400',
  Product: 'bg-violet-400',
  PackageUse: 'bg-amber-400',
  Extra: 'bg-slate-400',
  Payment: 'bg-emerald-500',
  Discount: 'bg-rose-400',
  PackageSale: 'bg-fuchsia-400',
}

const PAYMENT_METHODS = ['Nakit', 'Kart', 'Havale/EFT'] as const

interface AddForm {
  type: AdisyonItemTypeKey
  refId: string
  description: string
  quantity: number
  unitPrice: number
  staffMemberId: string
  method: string
}

const emptyForm: AddForm = { type: 'Service', refId: '', description: '', quantity: 1, unitPrice: 0, staffMemberId: '', method: 'Nakit' }

/**
 * Adisyon = işlemlerin (hizmet, ürün, paket kullanımı, tahsilat) önce toplandığı ara katman.
 * Yalnızca kurum yöneticisi onaylayınca cariye + kasaya aktarılır (1D · billing.adisyon).
 */
export default function AdisyonPanel({
  customerId,
  tenantId,
  onChanged,
  defaultStaffMemberId,
}: {
  customerId?: string
  tenantId?: string
  onChanged?: () => unknown
  /**
   * Adisyon bir RANDEVUDAN açıldıysa o randevunun personeli. Kalem formunda hazır gelir.
   * Personel boş bırakıldığında prim tahakkuk etmiyor ve satış "Kurum Yöneticisi"ne yazılıyordu;
   * randevuda zaten seçilmiş kişiyi ikinci kez sordurmak bu hatayı davet ediyordu.
   */
  defaultStaffMemberId?: string
}) {
  const canAdisyon = useFeature('billing.adisyon')
  const giftCardsAllowed = useFeature('marketing.giftcards')
  // Adisyon onayı yalnızca yönetici rollerinde (backend /approve personelde 403 döner).
  // Butonu personele göstermek her tıklamada 403 üretiyordu — onun yerine bilgi kartı gösterilir.
  const { user } = useAuth()
  const isStaffUser = user?.role === 'Staff'
  // Personel onaya gönderdi mi — buton tekrar basılmasın, kart durumu yazsın.
  const [sentToApproval, setSentToApproval] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState<AddForm>(() => ({ ...emptyForm, staffMemberId: defaultStaffMemberId ?? '' }))

  // Randevudan gelen personel değişirse (başka randevunun adisyonu açıldı) formu tazele —
  // kullanıcı kendi seçimini yaptıysa ona dokunma.
  useEffect(() => {
    if (!defaultStaffMemberId) return
    setForm((f) => (f.staffMemberId ? f : { ...f, staffMemberId: defaultStaffMemberId }))
  }, [defaultStaffMemberId])
  const [refreshKey, setRefreshKey] = useState(0)
  const [loyaltyPointsInput, setLoyaltyPointsInput] = useState('')
  const [giftSel, setGiftSel] = useState('')
  const [couponCode, setCouponCode] = useState('')
  // İndirim/hediye bölümü varsayılan kapalı — fiş sade kalsın, gerekince açılsın.
  const [perksOpen, setPerksOpen] = useState(false)

  const { data, loading, reload } = useApiQuery<{
    adisyon: ApiAdisyon | null
    services: ApiService[]
    products: ApiProduct[]
    staff: ApiStaff[]
    packages: ApiServicePackage[]
    loyalty: { balance?: number } | null
  }>(
    async () => {
      if (!customerId || !canAdisyon) return { adisyon: null, services: [], products: [], staff: [], packages: [], loyalty: null }
      const [adisyon, services, products, staff, packages, loyalty] = await Promise.all([
        adminApi.openAdisyon<ApiAdisyon>(customerId, tenantId).catch(() => null),
        adminApi.services<ApiService>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.products<ApiProduct>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.packages<ApiServicePackage>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.loyaltyBalance<{ balance?: number }>(customerId, tenantId).catch(() => null),
      ])
      return { adisyon, services: apiItems(services), products: apiItems(products), staff: apiItems(staff), packages: apiItems(packages), loyalty }
    },
    [customerId, tenantId, canAdisyon, refreshKey],
    { initialData: { adisyon: null, services: [], products: [], staff: [], packages: [], loyalty: null } },
  )

  const adisyon = useMemo(() => (data?.adisyon ? normalizeAdisyon(data.adisyon) : null), [data])
  const services = useMemo(() => (data?.services || []).map((s, i) => normalizeService(s, i)), [data])
  const products = useMemo(() => (data?.products || []).map((p, i) => normalizeProduct(p, i)), [data])
  const staff = useMemo(() => (data?.staff || []).map((s, i) => normalizeStaff(s, i)), [data])
  const packages = useMemo(() => (data?.packages || []).map((p, i) => normalizePackage(p, i)).filter((p) => p.isActive), [data])
  const loyaltyBalance = Number(data?.loyalty?.balance || 0)

  // Hediye edilebilir = kurum yöneticisinin sadakat puanı (loyaltyPointCost) belirlediği aktif hizmet/paket.
  const giftableServices = useMemo(
    () => services.filter((s) => s.isActive && (s.loyaltyPointCost || 0) > 0).sort((a, b) => a.loyaltyPointCost - b.loyaltyPointCost),
    [services],
  )
  const giftablePackages = useMemo(
    () => packages.filter((p) => (p.loyaltyPointCost || 0) > 0).sort((a, b) => a.loyaltyPointCost - b.loyaltyPointCost),
    [packages],
  )
  const hasGiftable = giftableServices.length + giftablePackages.length > 0

  if (!canAdisyon || !customerId) return null

  const refresh = async () => {
    setRefreshKey((k) => k + 1)
    await reload()
    if (onChanged) await onChanged()
  }

  // ANLIK TAZELEME: yönetici onayladığında (ya da başka bir sekmede adisyon değiştiğinde)
  // personelin AÇIK olan kartı kendiliğinden güncellensin — sayfayı yenilemeye gerek kalmasın.
  useRealtime(['adisyon', 'sessions', 'accounts'], () => {
    setRefreshKey((k) => k + 1)
    void reload()
    void onChanged?.()
  })

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'İşlem başarısız oldu')
    } finally {
      setBusy(false)
    }
  }

  const openAdisyon = () =>
    run(() => adminApi.createAdisyon({ customerId, customerAccountId: null, notes: null }, tenantId))

  const addItem = () => {
    const isPayment = form.type === 'Payment'
    const isDiscount = form.type === 'Discount'
    const isPackageUse = form.type === 'PackageUse'
    let description = form.description.trim()
    let unitPrice = Number(form.unitPrice) || 0
    let refId: string | null = form.refId || null

    if (form.type === 'Service' && form.refId) {
      const svc = services.find((s) => s.id === form.refId)
      if (svc) {
        description = description || svc.name
        if (!form.unitPrice) unitPrice = Number(svc.price || 0)
      }
    } else if (form.type === 'Product' && form.refId) {
      const prod = products.find((p) => p.id === form.refId)
      if (prod) {
        description = description || prod.name
        if (!form.unitPrice) unitPrice = Number(prod.salePrice || 0)
      }
    } else if (isPackageUse && form.refId) {
      const svc = services.find((s) => s.id === form.refId)
      if (svc) description = description || `${svc.name} (paketten)`
      unitPrice = 0
    } else if (form.type === 'PackageSale' && form.refId) {
      const pkg = packages.find((p) => p.id === form.refId)
      if (pkg) {
        description = description || `Paket satışı: ${pkg.name}`
        if (!form.unitPrice) unitPrice = Number(pkg.totalPrice || 0)
      }
    } else if (isPayment) {
      description = description || `Tahsilat · ${form.method}`
      refId = null
    } else if (isDiscount) {
      description = description || 'İndirim'
      refId = null
    }

    if (!description) {
      setError('Açıklama gerekli')
      return
    }
    if (form.type === 'PackageSale' && !refId) {
      setError('Paket seçimi gerekli')
      return
    }
    if ((isPayment || isDiscount || form.type === 'Extra') && unitPrice <= 0) {
      setError('Tutar pozitif olmalı')
      return
    }

    // Tahsilat kaleminin ödeme yöntemi (nakit/kart/havale) — kanonik değere çevrilir.
    const methodMap: Record<string, string> = { Nakit: 'cash', Kart: 'card', 'Havale/EFT': 'transfer' }
    const body = {
      type: form.type,
      refId,
      description,
      quantity: isPayment || isDiscount ? 1 : Math.max(1, Number(form.quantity) || 1),
      unitPrice,
      staffMemberId: form.staffMemberId || null,
      coveredByPackage: isPackageUse,
      method: isPayment ? (methodMap[form.method] || 'cash') : null,
    }
    if (!adisyon) return
    run(async () => {
      await adminApi.addAdisyonItem(adisyon.id, body, tenantId)
      // Personel seçimi KORUNUR: aynı fişe arka arkaya kalem eklenirken (aynı seansın hizmeti +
      // ürünü) her seferinde yeniden seçtirmek, boş bırakılıp atıfın kaybolmasına yol açıyordu.
      setForm({ ...emptyForm, type: form.type, method: form.method, staffMemberId: form.staffMemberId })
    })
  }

  const net = adisyon ? adisyon.paymentTotal - adisyon.chargeTotal : 0

  // ---------- Sadakat puanı kullanımı (1 puan = 1 ₺ indirim; hediye = ürün bedeli kadar puan) ----------
  // Kalem açıklamasındaki "· {N}P" işareti harcanan puanı taşır; kalem silinir/adisyon iptal
  // edilirse puan otomatik iade edilir.
  const POINT_MARKER = /·\s(\d+)P$/
  const pointsOf = (desc: string): number => {
    const m = POINT_MARKER.exec(desc)
    return m ? Number(m[1]) : 0
  }

  const redeemDiscount = (points: number) => {
    if (!adisyon) return
    const maxByDebt = Math.max(0, Math.ceil(adisyon.chargeTotal - adisyon.paymentTotal))
    if (points <= 0) return setError('Puan pozitif olmalı')
    if (points > loyaltyBalance) return setError(`Yetersiz puan — bakiye ${loyaltyBalance}P`)
    if (points > maxByDebt) return setError(`İndirim kalan borcu aşamaz (en çok ${maxByDebt}P)`)
    run(async () => {
      await adminApi.adjustLoyalty({ customerId, points: -points, description: 'Adisyon indirimi' }, tenantId)
      try {
        await adminApi.addAdisyonItem(adisyon.id, {
          type: 'Discount', refId: null, description: `Sadakat indirimi · ${points}P`,
          quantity: 1, unitPrice: points, staffMemberId: null, coveredByPackage: false,
        }, tenantId)
      } catch (e) {
        // İndirim kalemi yazılamadıysa puanı geri yükle
        await adminApi.adjustLoyalty({ customerId, points, description: 'İndirim iadesi (hata)' }, tenantId).catch(() => undefined)
        throw e
      }
      setLoyaltyPointsInput('')
    })
  }

  // Hediye çeki / kupon kodu uygula — backend indirim kalemi ekler, onayda redeem eder.
  const applyCoupon = () => {
    if (!adisyon) return
    const code = couponCode.trim()
    if (!code) return setError('Kupon/çek kodu girin')
    run(async () => {
      await adminApi.applyAdisyonGiftCard(adisyon.id, code, tenantId)
      setCouponCode('')
    })
  }

  const redeemGift = (sel: string) => {
    if (!adisyon || !sel) return
    const [kind, id] = sel.split(':')
    const svc = kind === 'svc' ? services.find((s) => s.id === id) : undefined
    const pkg = kind === 'pkg' ? packages.find((p) => p.id === id) : undefined
    const name = svc?.name || pkg?.name
    // Hediye maliyeti kurum yöneticisinin katalogda belirlediği sadakat puanıdır (parasal fiyat değil).
    const cost = Number(svc?.loyaltyPointCost ?? pkg?.loyaltyPointCost ?? 0)
    if (!name || cost <= 0) return setError('Bu hizmet/paket sadakat puanı ile hediye olarak tanımlı değil')
    if (cost > loyaltyBalance) return setError(`Yetersiz puan — gerekli ${cost}P, bakiye ${loyaltyBalance}P`)
    run(async () => {
      await adminApi.adjustLoyalty({ customerId, points: -cost, description: `Hediye: ${name}` }, tenantId)
      try {
        await adminApi.addAdisyonItem(adisyon.id, {
          type: svc ? 'Service' : 'PackageSale', refId: id,
          description: `Hediye: ${name} · ${cost}P`,
          quantity: 1, unitPrice: 0, staffMemberId: null, coveredByPackage: false,
        }, tenantId)
      } catch (e) {
        await adminApi.adjustLoyalty({ customerId, points: cost, description: 'Hediye iadesi (hata)' }, tenantId).catch(() => undefined)
        throw e
      }
      setGiftSel('')
    })
  }

  const removeItemWithRefund = (itemId: string, description: string) =>
    run(async () => {
      await adminApi.removeAdisyonItem(adisyon!.id, itemId, tenantId)
      const pts = pointsOf(description)
      if (pts > 0) await adminApi.adjustLoyalty({ customerId, points: pts, description: 'Kalem silindi — puan iadesi' }, tenantId)
    })

  const cancelWithRefund = () =>
    run(async () => {
      const refund = (adisyon?.items || []).reduce((s, it) => s + pointsOf(it.description), 0)
      await adminApi.cancelAdisyon(adisyon!.id, tenantId)
      if (refund > 0) await adminApi.adjustLoyalty({ customerId, points: refund, description: 'Adisyon iptal — puan iadesi' }, tenantId)
    })

  // Açık adisyonu tamamen sil (kalemler + varsa harcanan puan iadesi). Onaylı adisyon silme cariden yapılır.
  const doDeleteAdisyon = async () => {
    if (!adisyon) return
    const refund = (adisyon.items || []).reduce((s, it) => s + pointsOf(it.description), 0)
    await adminApi.deleteAdisyon(adisyon.id, tenantId)
    if (refund > 0) await adminApi.adjustLoyalty({ customerId, points: refund, description: 'Adisyon silindi — puan iadesi' }, tenantId)
    await refresh()
  }

  // Fiş özeti: kalan ödenecek + tahsilat ilerlemesi (başlıktaki büyük rakam).
  const due = adisyon ? Math.max(0, adisyon.chargeTotal - adisyon.paymentTotal) : 0
  const overpaid = adisyon ? Math.max(0, adisyon.paymentTotal - adisyon.chargeTotal) : 0
  const paidPct = adisyon && adisyon.chargeTotal > 0
    ? Math.min(100, Math.round((adisyon.paymentTotal / adisyon.chargeTotal) * 100))
    : 0

  // Kalem ekleme önizlemesi: seçilen katalog fiyatı × adet (kullanıcı tutarı boş bıraksa da görünür).
  const selectedRefPrice =
    form.type === 'Service' || form.type === 'PackageUse'
      ? Number(services.find((s) => s.id === form.refId)?.price || 0)
      : form.type === 'Product'
        ? Number(products.find((p) => p.id === form.refId)?.salePrice || 0)
        : form.type === 'PackageSale'
          ? Number(packages.find((p) => p.id === form.refId)?.totalPrice || 0)
          : 0
  const effectiveUnit = form.type === 'PackageUse' ? 0 : (Number(form.unitPrice) || selectedRefPrice)
  const previewQty = form.type === 'Payment' || form.type === 'Discount' ? 1 : Math.max(1, Number(form.quantity) || 1)
  const previewTotal = effectiveUnit * previewQty

  const fieldClass =
    'w-full rounded-[11px] border border-[#ead8df] bg-white px-3 py-2 text-[12.5px] text-[#352432] outline-none transition-colors focus:border-[#c85776]'
  const labelClass = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#7e5f6e]'

  return (
    <div className="overflow-hidden rounded-[20px] border border-[#ead8df]/80 bg-white shadow-[0_18px_50px_-40px_rgba(142,63,91,0.5)]">
      {/* ---------- BAŞLIK: durum + ödenecek tutar ---------- */}
      <div className="relative border-b border-[#f2e2e9] bg-gradient-to-br from-[#fff5f8] via-white to-[#fff1f6] px-4 py-3.5">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
          style={{ background: 'linear-gradient(90deg, transparent, #ffd3df 22%, #d9a441 50%, #ffd3df 78%, transparent)' }}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border border-[#f0d9e2] bg-white text-[#c05277]">
              <ReceiptText className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="text-[9.5px] font-mono uppercase tracking-widest text-[#a3576f]">Adisyon</div>
              <div className="truncate text-[13px] font-bold text-[#352432]">
                {adisyon
                  ? `${adisyon.items.length} kalem${adisyon.openedAtUtc ? ` · ${adisyon.openedAtUtc.slice(0, 10)}` : ''}`
                  : 'Açık adisyon yok'}
              </div>
            </div>
          </div>
          {adisyon && (
            <div className="flex items-center gap-3">
              <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-[9.5px] font-bold text-amber-700">● AÇIK</span>
              <div className="text-right">
                <div className="text-[9px] font-mono uppercase tracking-widest text-[#a3576f]">
                  {overpaid > 0 ? 'Fazla tahsilat' : 'Ödenecek'}
                </div>
                <div className={`font-display text-[26px] leading-7 tabular-nums ${overpaid > 0 ? 'text-emerald-700' : 'text-[#352432]'}`}>
                  {formatTL(overpaid > 0 ? overpaid : due)}
                </div>
              </div>
            </div>
          )}
        </div>
        {adisyon && adisyon.chargeTotal > 0 && (
          <div className="mt-2.5 flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f7e9ee]">
              <span className="block h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500" style={{ width: `${paidPct}%` }} />
            </span>
            <span className="shrink-0 text-[10px] font-semibold text-[#705a66]">%{paidPct} tahsil edildi</span>
          </div>
        )}
      </div>

      <div className="p-4">
        {error && (
          <div className="mb-3 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] font-medium text-rose-700">{error}</div>
        )}

        {!adisyon ? (
          <div className="rounded-[16px] border border-dashed border-[#ead8df] bg-[#fffafb] px-4 py-7 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#fff1f6] text-[#c05277]">
              <ReceiptText className="h-6 w-6" />
            </span>
            <p className="mx-auto mt-2.5 max-w-[320px] text-[12px] leading-relaxed text-[#705a66]">
              Açık adisyon yok. Hizmet, ürün ve tahsilat önce adisyona düşer; <b className="text-[#4a3a44]">onaylayınca</b> cariye ve kasaya aktarılır.
            </p>
            <button
              type="button"
              disabled={busy || loading}
              onClick={openAdisyon}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#c85776] to-[#a63e5f] px-5 py-2 text-[12px] font-semibold text-white shadow-[0_14px_26px_-16px_rgba(168,62,95,0.9)] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Adisyon aç
            </button>
          </div>
        ) : (
          <>
            {/* ---------- KALEMLER ---------- */}
            <div className="overflow-hidden rounded-[14px] border border-[#f0e0e6]">
              {adisyon.items.length === 0 && (
                <div className="bg-[#fffafb] px-3 py-6 text-center text-[11.5px] text-[#705a66]">
                  Henüz kalem yok — aşağıdan hizmet, ürün veya tahsilat ekleyin.
                </div>
              )}
              {adisyon.items.map((it, idx) => {
                const Icon = TYPE_ICONS[it.type]
                return (
                  <div
                    key={it.id}
                    className={`group relative flex items-center gap-2.5 bg-white py-2.5 pl-3.5 pr-3 ${idx > 0 ? 'border-t border-[#f6ebef]' : ''}`}
                  >
                    <span aria-hidden className={`absolute inset-y-1.5 left-0 w-[3px] rounded-full ${TYPE_BARS[it.type]}`} />
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[9px] border ${TYPE_TONES[it.type]}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-[#352432]">{it.description}</span>
                      <span className="block truncate text-[10px] text-[#705a66]">
                        {TYPE_LABELS[it.type]}
                        {it.quantity > 1 ? ` · ${it.quantity} adet × ${formatTL(it.unitPrice)}` : ''}
                        {it.staffName ? ` · ${it.staffName}` : ''}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 font-display text-[14px] tabular-nums ${
                        it.type === 'Payment' ? 'text-emerald-700' : it.type === 'Discount' ? 'text-rose-700' : it.coveredByPackage ? 'text-amber-700' : 'text-[#352432]'
                      }`}
                    >
                      {it.coveredByPackage ? 'paketten' : `${it.type === 'Payment' ? '+' : it.type === 'Discount' ? '−' : ''}${formatTL(it.lineTotal)}`}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => removeItemWithRefund(it.id, it.description)}
                      className="shrink-0 rounded-md p-1 text-[#c2a8b4] transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                      aria-label="Kalemi sil"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>

            {/* ---------- TOPLAMLAR ---------- */}
            <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-[14px] border border-[#f0dae2] bg-[#f7e9ee] text-center">
              <div className="bg-white px-2 py-2.5">
                <div className="text-[9px] font-mono uppercase tracking-wide text-[#a3576f]">Borç</div>
                <div className="font-display text-[15px] tabular-nums text-rose-700">{formatTL(adisyon.chargeTotal)}</div>
              </div>
              <div className="bg-white px-2 py-2.5">
                <div className="text-[9px] font-mono uppercase tracking-wide text-[#a3576f]">Tahsilat</div>
                <div className="font-display text-[15px] tabular-nums text-emerald-700">{formatTL(adisyon.paymentTotal)}</div>
              </div>
              <div className="bg-white px-2 py-2.5">
                <div className="text-[9px] font-mono uppercase tracking-wide text-[#a3576f]">{overpaid > 0 ? 'Fazla' : 'Kalan'}</div>
                <div className={`font-display text-[15px] tabular-nums ${overpaid > 0 ? 'text-emerald-700' : due > 0 ? 'text-[#352432]' : 'text-emerald-700'}`}>
                  {formatTL(overpaid > 0 ? overpaid : due)}
                </div>
              </div>
            </div>

            {/* ---------- İNDİRİM & HEDİYE (katlanır) ---------- */}
            <div className="mt-3 overflow-hidden rounded-[14px] border border-[#f0e0e6] bg-[#fffafc]">
              <button
                type="button"
                onClick={() => setPerksOpen((o) => !o)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
              >
                <span className="flex items-center gap-2 text-[11.5px] font-semibold text-[#4a3a44]">
                  <Gift className="h-4 w-4 text-[#c05277]" /> İndirim & hediye
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9.5px] font-bold text-amber-700">{loyaltyBalance}P</span>
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-[#a3576f] transition-transform duration-300 ${perksOpen ? 'rotate-180' : ''}`} />
              </button>
              {perksOpen && (
                <div className="space-y-2.5 border-t border-[#f6ebef] p-3">
                  {/* Sadakat puanı */}
                  <div className="rounded-[12px] border border-amber-200/70 bg-amber-50/40 p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-amber-700">
                        <Star className="h-3.5 w-3.5" /> Sadakat puanı
                      </span>
                      <span className="rounded-full border border-amber-300/50 bg-white px-2.5 py-0.5 font-display text-[13px] tabular-nums text-amber-700">{loyaltyBalance}P</span>
                    </div>
                    {loyaltyBalance > 0 ? (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={1}
                            max={loyaltyBalance}
                            value={loyaltyPointsInput}
                            onChange={(e) => setLoyaltyPointsInput(e.target.value)}
                            placeholder="İndirim puanı (1P = 1₺)"
                            className="w-full rounded-[10px] border border-amber-200/80 bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-amber-400"
                          />
                          <button
                            type="button"
                            disabled={busy || !Number(loyaltyPointsInput)}
                            onClick={() => redeemDiscount(Number(loyaltyPointsInput))}
                            className="shrink-0 rounded-[10px] border border-amber-300/60 bg-amber-100 px-3 py-1.5 text-[11px] font-semibold text-amber-800 transition-colors hover:bg-amber-200 disabled:opacity-40"
                          >
                            İndirim
                          </button>
                        </div>
                        {hasGiftable ? (
                          <div className="flex items-center gap-1.5">
                            <select
                              value={giftSel}
                              onChange={(e) => setGiftSel(e.target.value)}
                              className="w-full rounded-[10px] border border-amber-200/80 bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-amber-400"
                            >
                              <option value="">Hediye seç…</option>
                              {giftableServices.length > 0 && (
                                <optgroup label="Hizmetler">
                                  {giftableServices.map((s) => (
                                    <option key={s.id} value={`svc:${s.id}`} disabled={s.loyaltyPointCost > loyaltyBalance}>
                                      {s.name} · {s.loyaltyPointCost}P{s.loyaltyPointCost > loyaltyBalance ? ' · yetersiz' : ''}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              {giftablePackages.length > 0 && (
                                <optgroup label="Paketler">
                                  {giftablePackages.map((p) => (
                                    <option key={p.id} value={`pkg:${p.id}`} disabled={p.loyaltyPointCost > loyaltyBalance}>
                                      {p.name} · {p.loyaltyPointCost}P{p.loyaltyPointCost > loyaltyBalance ? ' · yetersiz' : ''}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                            <button
                              type="button"
                              disabled={busy || !giftSel}
                              onClick={() => redeemGift(giftSel)}
                              className="shrink-0 rounded-[10px] border border-amber-300/60 bg-amber-100 px-3 py-1.5 text-[11px] font-semibold text-amber-800 transition-colors hover:bg-amber-200 disabled:opacity-40"
                            >
                              Hediye et
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center rounded-[10px] border border-dashed border-amber-300/60 bg-white/60 px-2.5 py-1.5 text-[10.5px] leading-snug text-amber-700">
                            Hediye edilebilir hizmet/paket yok. Katalogda sadakat puanı belirleyin.
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="mt-1.5 text-[10.5px] text-amber-700">Puan yok — her 10₺ onaylı tahsilat 1 puan kazandırır.</p>
                    )}
                  </div>

                  {/* Hediye çeki / kupon */}
                  {giftCardsAllowed && (
                    <div className="rounded-[12px] border border-violet-200/70 bg-violet-50/40 p-2.5">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-violet-700">
                        <Ticket className="h-3.5 w-3.5" /> Hediye çeki / kupon
                      </div>
                      <div className="mt-2 flex items-center gap-1.5">
                        <input
                          value={couponCode}
                          onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon() } }}
                          placeholder="Kodu girin (ör. YILBASI25)"
                          className="w-full rounded-[10px] border border-violet-200/80 bg-white px-2.5 py-1.5 font-mono text-[12px] uppercase text-[#352432] outline-none focus:border-violet-400"
                        />
                        <button
                          type="button"
                          disabled={busy || !couponCode.trim()}
                          onClick={applyCoupon}
                          className="shrink-0 rounded-[10px] border border-violet-300/60 bg-violet-100 px-3 py-1.5 text-[11px] font-semibold text-violet-800 transition-colors hover:bg-violet-200 disabled:opacity-40"
                        >
                          Uygula
                        </button>
                      </div>
                      <p className="mt-1 text-[10.5px] text-violet-700">İndirim kalemi olarak eklenir; adisyon onaylanınca kod kullanılmış sayılır.</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ---------- KALEM EKLE ---------- */}
            <div className="mt-3 rounded-[16px] border border-[#f0e0e6] bg-[#fffafb] p-3">
              <div className="mb-2 text-[10px] font-mono uppercase tracking-widest text-[#a3576f]">Kalem ekle</div>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(TYPE_LABELS) as AdisyonItemTypeKey[]).map((t) => {
                  const Icon = TYPE_ICONS[t]
                  const on = form.type === t
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm({ ...emptyForm, type: t, method: form.method, staffMemberId: form.staffMemberId })}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10.5px] font-semibold transition-colors ${
                        on ? `${TYPE_TONES[t]} ring-1 ring-current/20` : 'border-[#ead8df] bg-white text-[#705a66] hover:bg-white'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" /> {TYPE_LABELS[t]}
                    </button>
                  )
                })}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2.5">
                {(form.type === 'Service' || form.type === 'PackageUse') && (
                  <label className="col-span-2 block">
                    <span className={labelClass}>{form.type === 'PackageUse' ? 'Paketten kullanılacak hizmet' : 'Hizmet'}</span>
                    <select value={form.refId} onChange={(e) => setForm({ ...form, refId: e.target.value })} className={fieldClass}>
                      <option value="">Hizmet seç…</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>{s.name} · {formatTL(Number(s.price || 0))}</option>
                      ))}
                    </select>
                  </label>
                )}
                {form.type === 'Product' && (
                  <label className="col-span-2 block">
                    <span className={labelClass}>Ürün</span>
                    <select value={form.refId} onChange={(e) => setForm({ ...form, refId: e.target.value })} className={fieldClass}>
                      <option value="">Ürün seç…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} · {formatTL(p.salePrice)} (stok {p.currentStock})</option>
                      ))}
                    </select>
                  </label>
                )}
                {form.type === 'PackageSale' && (
                  <label className="col-span-2 block">
                    <span className={labelClass}>Paket</span>
                    <select value={form.refId} onChange={(e) => setForm({ ...form, refId: e.target.value })} className={fieldClass}>
                      <option value="">Paket seç…</option>
                      {packages.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} · {formatTL(p.totalPrice)} · {p.totalSessions} seans</option>
                      ))}
                    </select>
                  </label>
                )}
                {(form.type === 'Extra' || form.type === 'Discount' || form.type === 'Payment') && (
                  <label className="col-span-2 block">
                    <span className={labelClass}>Açıklama</span>
                    <input
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder={form.type === 'Payment' ? 'Tahsilat açıklaması (opsiyonel)' : 'Açıklama'}
                      className={fieldClass}
                    />
                  </label>
                )}

                {form.type === 'Payment' && (
                  <label className="block">
                    <span className={labelClass}>Ödeme yöntemi</span>
                    <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className={fieldClass}>
                      {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </label>
                )}

                {form.type !== 'PackageUse' && (
                  <label className="block">
                    <span className={labelClass}>{form.type === 'Payment' || form.type === 'Discount' ? 'Tutar' : 'Birim fiyat'}</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.unitPrice || ''}
                      onChange={(e) => setForm({ ...form, unitPrice: Number(e.target.value) })}
                      placeholder={selectedRefPrice > 0 ? `Katalog: ${formatTL(selectedRefPrice)}` : '0'}
                      className={fieldClass}
                    />
                  </label>
                )}

                {form.type !== 'Payment' && form.type !== 'Discount' && (
                  <label className="block">
                    <span className={labelClass}>Adet</span>
                    <input
                      type="number"
                      min={1}
                      step="1"
                      value={form.quantity}
                      onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
                      className={fieldClass}
                    />
                  </label>
                )}

                {(form.type === 'Service' || form.type === 'Product' || form.type === 'Extra' || form.type === 'PackageUse' || form.type === 'PackageSale') && (
                  <label className="col-span-2 block">
                    {/* SATIŞ mı UYGULAMA mı: ürün/paket satışında "satış yapan" (prim + kim sattı),
                        hizmet/paket kullanımında "işlem yapan" (uygulayan personel). Tek "Personel"
                        etiketi hangi rolün sorulduğunu belirsiz bırakıyordu. */}
                    <span className={labelClass}>
                      {form.type === 'Product' || form.type === 'PackageSale' ? 'Satış yapan' : 'İşlem yapan'}
                    </span>
                    <select value={form.staffMemberId} onChange={(e) => setForm({ ...form, staffMemberId: e.target.value })} className={fieldClass}>
                      <option value="">Seçilmedi</option>
                      {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    {!form.staffMemberId && (
                      <span className="mt-1 block text-[10.5px] leading-snug text-[#a3576f]">
                        Boş bırakılırsa prim hesaplanmaz ve kayıt “Kurum Yöneticisi” adına geçer.
                      </span>
                    )}
                  </label>
                )}
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={addItem}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[12px] border border-[#c85776]/45 bg-[#fff1f6] px-3 py-2.5 text-[12px] font-semibold text-[#a3576f] transition-colors hover:bg-[#ffe6ef] disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                Kalem ekle
                {previewTotal > 0 && form.type !== 'PackageUse' && (
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] tabular-nums text-[#4a3a44]">
                    {previewQty > 1 ? `${previewQty} × ${formatTL(effectiveUnit)} = ` : ''}{formatTL(previewTotal)}
                  </span>
                )}
              </button>
            </div>

            {/* Taksitli satış bilgisi — onayda cariye taksitli işlenir */}
            {adisyon.plannedInstallmentCount > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-[12px] border border-[#efbfd0]/60 bg-[#fff1f6]/60 px-3 py-2 text-[11px] text-[#b14d6c]">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Taksitli satış: {adisyon.plannedInstallmentCount} taksit
                  {adisyon.plannedFirstDueDate ? ` · ilk vade ${adisyon.plannedFirstDueDate}` : ''}. Onaylanınca cariye taksitli işlenir.
                </span>
              </div>
            )}

            {/* ---------- ONAY / İPTAL / SİL ---------- */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              {/* Personelde onay YÖNETİCİYE gider: istek onay kapısında yakalanıp Onaylar
                  sayfasına düşer, yönetici onaylayınca gerçekten işlenir. */}
              {isStaffUser ? (
                <div className="col-span-2 space-y-2">
                  <button
                    type="button"
                    disabled={busy || adisyon.items.length === 0 || sentToApproval}
                    onClick={() =>
                      run(async () => {
                        await adminApi.approveAdisyon(adisyon.id, tenantId)
                        setSentToApproval(true)
                      })
                    }
                    className="inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-gradient-to-r from-indigo-600 to-indigo-700 px-3 py-2.5 text-[12.5px] font-semibold text-white shadow-[0_14px_26px_-16px_rgba(67,56,202,0.9)] transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {sentToApproval ? 'Onaya gönderildi' : 'Onaya gönder'}
                    {adisyon.items.length > 0 && !sentToApproval && (
                      <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] tabular-nums">{formatTL(adisyon.chargeTotal)}</span>
                    )}
                  </button>
                  <div className="flex items-start gap-2 rounded-[12px] border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-[11.5px] text-indigo-800">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      {sentToApproval
                        ? 'Kurum yöneticisinin Onaylar sayfasına düştü. Onaylandığında satış cariye ve kasaya işlenecek.'
                        : 'Onay yetkisi kurum yöneticisindedir. Gönderdiğinde yöneticinin Onaylar sayfasına düşer; onaylanınca cariye ve kasaya işlenir.'}
                    </span>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy || adisyon.items.length === 0}
                  onClick={() => run(() => adminApi.approveAdisyon(adisyon.id, tenantId))}
                  className="col-span-2 inline-flex items-center justify-center gap-2 rounded-[12px] bg-gradient-to-r from-emerald-600 to-emerald-700 px-3 py-2.5 text-[12.5px] font-semibold text-white shadow-[0_14px_26px_-16px_rgba(4,120,87,0.9)] transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Onayla → cariye + kasaya aktar
                  {adisyon.items.length > 0 && (
                    <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] tabular-nums">{formatTL(adisyon.chargeTotal)}</span>
                  )}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={cancelWithRefund}
                className="inline-flex items-center justify-center gap-1.5 rounded-[11px] border border-[#ead8df] bg-white px-3 py-2 text-[11.5px] font-semibold text-[#705a66] transition-colors hover:bg-[#fff4f8] disabled:opacity-40"
              >
                <X className="h-4 w-4" /> Adisyonu iptal et
              </button>

              {/* Adisyonu tamamen sil (açık adisyon) — şık onay modalı */}
              <ConfirmDialog
                destructive
                title="Adisyonu sil"
                confirmLabel="Evet, sil"
                cancelLabel="Vazgeç"
                onConfirm={doDeleteAdisyon}
                description={
                  <span className="block space-y-1.5">
                    <span className="block">Bu <b>açık adisyon</b> ve tüm kalemleri kalıcı olarak silinecek.</span>
                    <span className="block">• Kullanılan sadakat puanı iade edilir.</span>
                    <span className="block text-rose-600">Bu işlem geri alınamaz.</span>
                  </span>
                }
                trigger={
                  <button
                    type="button"
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-1.5 rounded-[11px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Adisyonu sil
                  </button>
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
