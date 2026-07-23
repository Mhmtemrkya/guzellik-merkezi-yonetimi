'use client'

import { useMemo, useState } from 'react'
import { useApiQuery } from '@/hooks/useApiQuery'
import ConfirmDialog from '@/components/dashboard/ConfirmDialog'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { adminApi } from '@/lib/apiClient'
import { apiItems, formatTL, normalizeAdisyon, normalizePackage, normalizeProduct, normalizeService, normalizeStaff } from '@/lib/apiMappers'
import type { ApiAdisyon, ApiProduct, ApiService, ApiServicePackage, ApiStaff, AdisyonItemTypeKey } from '@/lib/types'
import { CalendarDays, CheckCircle2, Plus, ReceiptText, Star, Trash2, X } from 'lucide-react'

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
}: {
  customerId?: string
  tenantId?: string
  onChanged?: () => unknown
}) {
  const canAdisyon = useFeature('billing.adisyon')
  const giftCardsAllowed = useFeature('marketing.giftcards')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState<AddForm>(emptyForm)
  const [refreshKey, setRefreshKey] = useState(0)
  const [loyaltyPointsInput, setLoyaltyPointsInput] = useState('')
  const [giftSel, setGiftSel] = useState('')
  const [couponCode, setCouponCode] = useState('')

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
      setForm({ ...emptyForm, type: form.type, method: form.method })
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

  return (
    <div className="rounded-[20px] border border-[#ead8df]/70 bg-white/80 p-4 shadow-[0_18px_50px_-40px_rgba(142,63,91,0.5)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-[#c85776]/80">
          <ReceiptText className="h-3.5 w-3.5" /> Adisyon
        </div>
        {adisyon && (
          <span className="rounded-full border border-amber-300/50 bg-amber-50 px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest text-amber-700">
            Açık · {adisyon.items.length} kalem
          </span>
        )}
      </div>

      {error && (
        <div className="mb-2 rounded-[12px] border border-rose-300/40 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{error}</div>
      )}

      {!adisyon ? (
        <div className="rounded-[14px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-4 text-center">
          <p className="text-[12px] text-[#352432]/55">
            Açık adisyon yok. İşlemler önce adisyona düşer; onaylayınca cariye + kasaya aktarılır.
          </p>
          <button
            type="button"
            disabled={busy || loading}
            onClick={openAdisyon}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#c85776] px-4 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Adisyon aç
          </button>
        </div>
      ) : (
        <>
          {/* Kalemler */}
          <div className="space-y-1.5">
            {adisyon.items.length === 0 && (
              <div className="rounded-[12px] border border-[#f0e0e6] bg-[#fffafb] px-3 py-2 text-center text-[11px] text-[#352432]/45">
                Henüz kalem yok — aşağıdan ekleyin.
              </div>
            )}
            {adisyon.items.map((it) => (
              <div key={it.id} className="flex items-center justify-between gap-2 rounded-[12px] border border-[#f0e0e6] bg-white px-3 py-2">
                <div className="min-w-0 flex items-center gap-2">
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[8px] font-mono uppercase ${TYPE_TONES[it.type]}`}>
                    {TYPE_LABELS[it.type]}
                  </span>
                  <span className="truncate text-[12px] text-[#352432]">
                    {it.description}
                    {it.quantity > 1 && <span className="text-[#352432]/45"> ×{it.quantity}</span>}
                    {it.staffName && <span className="text-[#352432]/45"> · {it.staffName}</span>}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`font-mono text-[12px] tabular-nums ${it.type === 'Payment' ? 'text-emerald-700' : it.type === 'Discount' ? 'text-rose-700' : it.coveredByPackage ? 'text-amber-700' : 'text-[#352432]'}`}>
                    {it.coveredByPackage ? 'paket' : `${it.type === 'Payment' ? '+' : it.type === 'Discount' ? '−' : ''}${formatTL(it.lineTotal)}`}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => removeItemWithRefund(it.id, it.description)}
                    className="text-[#352432]/30 transition-colors hover:text-rose-600 disabled:opacity-40"
                    aria-label="Kalemi sil"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Toplamlar */}
          <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-[12px] border border-[#ead8df]/65 bg-[#fff1f6]/72 text-center">
            <div className="bg-white p-2">
              <div className="text-[8px] font-mono uppercase text-[#352432]/40">Borç</div>
              <div className="mt-0.5 font-display text-[14px] tabular-nums text-rose-700">{formatTL(adisyon.chargeTotal)}</div>
            </div>
            <div className="bg-white p-2">
              <div className="text-[8px] font-mono uppercase text-[#352432]/40">Tahsilat</div>
              <div className="mt-0.5 font-display text-[14px] tabular-nums text-emerald-700">{formatTL(adisyon.paymentTotal)}</div>
            </div>
            <div className="bg-white p-2">
              <div className="text-[8px] font-mono uppercase text-[#352432]/40">Net</div>
              <div className={`mt-0.5 font-display text-[14px] tabular-nums ${net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatTL(net)}</div>
            </div>
          </div>

          {/* Sadakat puanı — indirim veya hediye olarak kullan */}
          <div className="mt-3 rounded-[14px] border border-amber-200/70 bg-amber-50/40 p-2.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-amber-700">
                <Star className="h-3.5 w-3.5" /> Sadakat Puanı
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
                    placeholder={`İndirim puanı (1P = 1₺)`}
                    className="w-full rounded-[10px] border border-amber-200/80 bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    disabled={busy || !Number(loyaltyPointsInput)}
                    onClick={() => redeemDiscount(Number(loyaltyPointsInput))}
                    className="shrink-0 rounded-[10px] border border-amber-300/60 bg-amber-100 px-3 py-1.5 text-[11px] font-medium text-amber-800 transition-colors hover:bg-amber-200 disabled:opacity-40"
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
                      className="shrink-0 rounded-[10px] border border-amber-300/60 bg-amber-100 px-3 py-1.5 text-[11px] font-medium text-amber-800 transition-colors hover:bg-amber-200 disabled:opacity-40"
                    >
                      Hediye Et
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center rounded-[10px] border border-dashed border-amber-300/60 bg-white/60 px-2.5 py-1.5 text-[10px] leading-snug text-amber-700/70">
                    Hediye edilebilir hizmet/paket yok. Katalogda hizmet veya pakete sadakat puanı belirleyin.
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-1.5 text-[10px] text-amber-700/70">Puan yok — her 10₺ onaylı tahsilat 1 puan kazandırır.</p>
            )}
          </div>

          {/* Hediye çeki / kupon kodu */}
          {giftCardsAllowed && (
            <div className="mt-3 rounded-[14px] border border-violet-200/70 bg-violet-50/40 p-2.5">
              <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-violet-700">
                <ReceiptText className="h-3.5 w-3.5" /> Hediye Çeki / Kupon
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
                  className="shrink-0 rounded-[10px] border border-violet-300/60 bg-violet-100 px-3 py-1.5 text-[11px] font-medium text-violet-800 transition-colors hover:bg-violet-200 disabled:opacity-40"
                >
                  Uygula
                </button>
              </div>
              <p className="mt-1 text-[10px] text-violet-700/70">İndirim kalemi olarak eklenir; adisyon onaylanınca kod kullanılmış sayılır.</p>
            </div>
          )}

          {/* Kalem ekle */}
          <div className="mt-3 rounded-[14px] border border-[#f0e0e6] bg-[#fffafb] p-2.5">
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(TYPE_LABELS) as AdisyonItemTypeKey[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm({ ...emptyForm, type: t, method: form.method })}
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-wide transition-colors ${
                    form.type === t ? TYPE_TONES[t] : 'border-[#ead8df]/70 bg-white text-[#352432]/50 hover:bg-[#fff4f8]/50'
                  }`}
                >
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-2">
              {(form.type === 'Service' || form.type === 'PackageUse') && (
                <select
                  value={form.refId}
                  onChange={(e) => setForm({ ...form, refId: e.target.value })}
                  className="col-span-2 rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]"
                >
                  <option value="">Hizmet seç…</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} · {formatTL(Number(s.price || 0))}</option>
                  ))}
                </select>
              )}
              {form.type === 'Product' && (
                <select
                  value={form.refId}
                  onChange={(e) => setForm({ ...form, refId: e.target.value })}
                  className="col-span-2 rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]"
                >
                  <option value="">Ürün seç…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} · {formatTL(p.salePrice)} (stok {p.currentStock})</option>
                  ))}
                </select>
              )}
              {form.type === 'PackageSale' && (
                <select
                  value={form.refId}
                  onChange={(e) => setForm({ ...form, refId: e.target.value })}
                  className="col-span-2 rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]"
                >
                  <option value="">Paket seç…</option>
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} · {formatTL(p.totalPrice)} · {p.totalSessions} seans</option>
                  ))}
                </select>
              )}
              {(form.type === 'Extra' || form.type === 'Discount' || form.type === 'Payment') && (
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={form.type === 'Payment' ? 'Tahsilat açıklaması (ops.)' : 'Açıklama'}
                  className="col-span-2 rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]"
                />
              )}

              {form.type === 'Payment' && (
                <select
                  value={form.method}
                  onChange={(e) => setForm({ ...form, method: e.target.value })}
                  className="rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]"
                >
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              )}

              {form.type !== 'PackageUse' && (
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.unitPrice || ''}
                  onChange={(e) => setForm({ ...form, unitPrice: Number(e.target.value) })}
                  placeholder={form.type === 'Payment' || form.type === 'Discount' ? 'Tutar' : 'Birim fiyat'}
                  className="rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]"
                />
              )}

              {form.type !== 'Payment' && form.type !== 'Discount' && (
                <input
                  type="number"
                  min={1}
                  step="1"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
                  placeholder="Adet"
                  className="rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]"
                />
              )}

              {(form.type === 'Service' || form.type === 'Product' || form.type === 'Extra' || form.type === 'PackageUse' || form.type === 'PackageSale') && (
                <select
                  value={form.staffMemberId}
                  onChange={(e) => setForm({ ...form, staffMemberId: e.target.value })}
                  className="col-span-2 rounded-[10px] border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]"
                >
                  <option value="">Personel (ops.)</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={addItem}
              className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-[#c85776]/40 bg-[#fff1f6] px-3 py-1.5 text-[11px] font-medium text-[#b14d6c] transition-colors hover:bg-[#ffe6ef] disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Kalem ekle
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

          {/* Onayla / İptal */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy || adisyon.items.length === 0}
              onClick={() => run(() => adminApi.approveAdisyon(adisyon.id, tenantId))}
              className="inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-emerald-600 px-3 py-2 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <CheckCircle2 className="h-4 w-4" /> Onayla → cariye aktar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={cancelWithRefund}
              className="inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[#ead8df] bg-white px-3 py-2 text-[11px] font-medium text-[#352432]/70 transition-colors hover:bg-[#fff4f8]/60 disabled:opacity-40"
            >
              <X className="h-4 w-4" /> İptal
            </button>
          </div>

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
                className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-rose-200 bg-rose-50/60 px-3 py-1.5 text-[11px] font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" /> Adisyonu sil
              </button>
            }
          />
        </>
      )}
    </div>
  )
}
