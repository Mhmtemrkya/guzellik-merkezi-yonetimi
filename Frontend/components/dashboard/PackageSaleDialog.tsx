'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Box, CalendarDays, CheckCircle2, Package, ReceiptText, ShoppingBag, Sparkles, Wallet } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useFeature } from '@/components/dashboard/FeatureContext'
import ConsultationWarningBanner from '@/components/dashboard/ConsultationWarningBanner'
import CustomerPicker, { customerSearchProvider } from '@/components/dashboard/CustomerPicker'
import { adminApi, fetchAllPaged } from '@/lib/apiClient'
import { apiItems, formatTL, normalizeCustomer, normalizePackage, normalizeProduct, normalizeService, normalizeStaff } from '@/lib/apiMappers'
import type { ApiAdisyon, ApiCustomer, ApiProduct, ApiService, ApiServicePackage, ApiStaff } from '@/lib/types'

const labelCls = 'block text-[10px] font-mono uppercase tracking-widest text-[#352432]/45'
const inputCls =
  'mt-1 w-full rounded-[10px] border border-[#ead8df] bg-white px-3 py-2 text-[13px] text-[#352432] outline-none transition-colors focus:border-[#c85776]'

/**
 * Paket / Hizmet / Ürün Satışı modalı — salon yazılımı standardı akış:
 * satış fiş (adisyon) üzerinden yapılır → kurum yöneticisi adisyonu onaylayınca
 * tutar cariye borç yazılır, paketse seans bakiyesi müşteriye tanımlanır, peşinat kasaya düşer.
 */
export default function PackageSaleDialog({
  tenantId,
  presetCustomer,
  presetPackageId,
  presetService,
  serviceSale,
  productSale,
  onDone,
  triggerLabel,
  triggerClassName,
  stayOnPage,
}: {
  tenantId?: string
  /** Müşteri kartından açılırsa müşteri sabitlenir. */
  presetCustomer?: { id: string; name: string; branchId?: string | null }
  /** Paket kartından açılırsa paket ön-seçili gelir. */
  presetPackageId?: string
  /** Hizmet kartından açılırsa paket yerine bu hizmet satılır. */
  presetService?: { id: string; name: string; price: number }
  /** true ise hizmet satışı modu: hizmet sabit gelmek yerine listeden seçilir. */
  serviceSale?: boolean
  /** true ise ürün satışı modu: stoktaki satış ürünlerinden seçim yapılır. */
  productSale?: boolean
  onDone?: () => unknown
  triggerLabel?: string
  triggerClassName?: string
  /** true ise satış sonrası müşteri kartına yönlendirme yapılmaz (ör. randevu modalı içinden satış). */
  stayOnPage?: boolean
}) {
  const canAdisyon = useFeature('billing.adisyon')
  const canProducts = useFeature('stock.products')
  const router = useRouter()
  const isProductSale = Boolean(productSale)
  const isServiceSale = !isProductSale && (Boolean(presetService) || Boolean(serviceSale))
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const [customerId, setCustomerId] = useState('')
  const [packageId, setPackageId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [productId, setProductId] = useState('')
  const [price, setPrice] = useState<number | ''>('')
  const [quantity, setQuantity] = useState(1)
  const [downPayment, setDownPayment] = useState<number | ''>('')
  const [staffMemberId, setStaffMemberId] = useState('')
  const [notes, setNotes] = useState('')
  // Ödeme planı: peşin (taksit yok) ya da taksit (N ay, ilk vade). Cariye onayda işlenir.
  const [payMode, setPayMode] = useState<'pesin' | 'taksit'>('pesin')
  const [installmentCount, setInstallmentCount] = useState(3)
  const [firstDueDate, setFirstDueDate] = useState('')

  // Ön-seçimler modal her açılışta tazelensin
  useEffect(() => {
    if (open) {
      setCustomerId(presetCustomer?.id || '')
      setPackageId(presetPackageId || '')
      setServiceId(presetService?.id || '')
      setProductId('')
      // İlk taksit vadesi varsayılan: bir ay sonrası.
      const d = new Date()
      d.setMonth(d.getMonth() + 1)
      setFirstDueDate(d.toISOString().slice(0, 10))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const { data } = useApiQuery<{ customers: ApiCustomer[]; packages: ApiServicePackage[]; services: ApiService[]; products: ApiProduct[]; staff: ApiStaff[] }>(
    async () => {
      if (!open) return { customers: [], packages: [], services: [], products: [], staff: [] }
      // Sınırsız müşteri ölçeği: müşteri listesi çekilmez — seçim sunucu aramasıyla yapılır.
      const [packages, services, products, staff] = await Promise.all([
        isServiceSale || isProductSale
          ? Promise.resolve({ items: [] })
          : adminApi.packages<ApiServicePackage>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        isServiceSale && !presetService
          ? adminApi.services<ApiService>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] }))
          : Promise.resolve({ items: [] }),
        isProductSale
          ? adminApi.products<ApiProduct>({ tenantId, page: 1, pageSize: 500 }).catch(() => ({ items: [] }))
          : Promise.resolve({ items: [] }),
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
      ])
      return {
        customers: [],
        packages: apiItems(packages),
        services: apiItems(services),
        products: apiItems(products),
        staff: apiItems(staff),
      }
    },
    [open, tenantId, presetCustomer?.id, isServiceSale, isProductSale],
    { initialData: { customers: [], packages: [], services: [], products: [], staff: [] } },
  )

  const customerSearch = useMemo(() => customerSearchProvider(tenantId), [tenantId])
  const packages = useMemo(
    () => (data?.packages || []).map((p, i) => normalizePackage(p, i)).filter((p) => p.isActive || p.id === presetPackageId),
    [data, presetPackageId],
  )
  const staff = useMemo(() => (data?.staff || []).map((s, i) => normalizeStaff(s, i)), [data])
  const services = useMemo(
    () => (data?.services || []).map((s, i) => normalizeService(s, i)).filter((s) => s.isActive),
    [data],
  )
  const products = useMemo(
    () => (data?.products || [])
      .map((p, i) => normalizeProduct(p, i))
      .filter((p) => p.isActive && p.salePrice > 0 && p.currentStock > 0)
      .filter((p) => !presetCustomer?.branchId || !p.branchId || p.branchId === presetCustomer.branchId),
    [data, presetCustomer?.branchId],
  )
  const selectedPackage = packages.find((p) => p.id === packageId)
  // Hizmet satışında: sabit gelen hizmet ya da listeden seçilen.
  const pickedService = services.find((s) => s.id === serviceId)
  const selectedService: { id: string; name: string; price: number } | null =
    presetService ?? (pickedService ? { id: pickedService.id, name: pickedService.name, price: pickedService.price } : null)
  const selectedProduct = products.find((p) => p.id === productId)

  const basePrice = isProductSale
    ? Number(selectedProduct?.salePrice || 0)
    : isServiceSale
      ? Number(selectedService?.price || 0)
      : Number(selectedPackage?.totalPrice || 0)
  const unitPrice = price === '' ? basePrice : Number(price)
  const qty = isProductSale || isServiceSale ? Math.max(1, quantity) : 1
  const total = Math.round(unitPrice * qty * 100) / 100
  const isInstallment = payMode === 'taksit'
  const perInstallment = isInstallment && installmentCount > 0 ? Math.round((total / installmentCount) * 100) / 100 : 0

  if (!canAdisyon || (isProductSale && !canProducts)) return null

  const reset = () => {
    setServiceId(presetService?.id || '')
    setProductId('')
    setPrice('')
    setQuantity(1)
    setDownPayment('')
    setStaffMemberId('')
    setNotes('')
    setPayMode('pesin')
    setInstallmentCount(3)
    setError('')
    setDone(false)
  }

  const submit = async () => {
    const cid = presetCustomer?.id || customerId
    if (!cid) return setError('Müşteri seçin')
    if (!isServiceSale && !isProductSale && !selectedPackage) return setError('Paket seçin')
    if (isServiceSale && !selectedService) return setError('Hizmet seçin')
    if (isProductSale && !selectedProduct) return setError('Ürün seçin')
    if (unitPrice <= 0) return setError('Satış fiyatı pozitif olmalı')
    if (isProductSale && qty > Number(selectedProduct!.currentStock || 0)) {
      return setError(`Yetersiz stok — kullanılabilir ${selectedProduct!.currentStock} ${selectedProduct!.unit}`)
    }
    const pay = Number(downPayment) || 0
    if (pay < 0 || pay > total) return setError('Peşinat 0 ile toplam tutar arasında olmalı')
    if (isInstallment) {
      if (installmentCount < 1) return setError('Taksit sayısı en az 1 olmalı')
      if (!firstDueDate) return setError('İlk taksit vadesi seçin')
      if (pay >= total) return setError('Peşinat tutarın tamamını karşılıyor — peşin seçin')
    }

    setBusy(true)
    setError('')
    try {
      // 1) Açık adisyonu bul/aç + taksit planını yaz (peşin = 0). Tek çağrı: açık fiş varsa
      //    onu döndürür ve planı uygular, yoksa yeni fiş açar. Onayda cariye taksitli işlenir.
      const adisyon = await adminApi.createAdisyon<ApiAdisyon>(
        {
          customerId: cid,
          customerAccountId: null,
          notes: notes.trim() || null,
          installmentCount: isInstallment ? installmentCount : 0,
          firstDueDate: isInstallment ? firstDueDate : null,
        },
        tenantId,
      )
      if (!adisyon?.id) throw new Error('Adisyon açılamadı')

      // 2) Satış kalemi — onayda cariye borç (+ paketse müşteriye seans bakiyesi).
      await adminApi.addAdisyonItem(
        adisyon.id,
        isProductSale
          ? {
              type: 'Product',
              refId: selectedProduct!.id,
              description: selectedProduct!.name,
              quantity: qty,
              unitPrice,
              staffMemberId: staffMemberId || null,
              coveredByPackage: false,
            }
          : isServiceSale
          ? {
              type: 'Service',
              refId: selectedService!.id,
              description: selectedService!.name,
              quantity: qty,
              unitPrice,
              staffMemberId: staffMemberId || null,
              coveredByPackage: false,
            }
          : {
              type: 'PackageSale',
              refId: selectedPackage!.id,
              description: `Paket satışı: ${selectedPackage!.name}`,
              quantity: 1,
              unitPrice,
              staffMemberId: staffMemberId || null,
              coveredByPackage: false,
            },
        tenantId,
      )

      // 3) Peşinat alındıysa tahsilat kalemi — onayda cariye ödeme + kasaya gelir.
      if (pay > 0) {
        await adminApi.addAdisyonItem(
          adisyon.id,
          {
            type: 'Payment',
            refId: null,
            description: isProductSale
              ? `Ürün peşinatı: ${selectedProduct!.name}`
              : isServiceSale
                ? `Peşinat: ${selectedService!.name}`
                : `Paket peşinatı: ${selectedPackage!.name}`,
            quantity: 1,
            unitPrice: pay,
            staffMemberId: null,
            coveredByPackage: false,
          },
          tenantId,
        )
      }

      if (onDone) await onDone()
      // Satıştan sonra DOĞRUDAN müşteri kartına git (önmuhasebeye uğramadan): adisyon/işlem
      // defteri, taksit/cari durumu orada görünür ve yönetici onayı da oradan yapılır.
      // stayOnPage: randevu modalı gibi akış içinden satışta yönlendirme yapılmaz.
      setOpen(false)
      if (!stayOnPage) router.push(`/admin/musteriler?customer=${cid}&sale=1`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Satış kaydedilemedi')
    } finally {
      setBusy(false)
    }
  }

  const TriggerIcon = isProductSale ? Box : isServiceSale ? ShoppingBag : Package
  const title = isProductSale ? 'Ürün Satışı' : isServiceSale ? 'Hizmet Satışı' : 'Paket Satışı'
  const submitLabel = isProductSale
    ? 'Ürün satışını adisyona ekle'
    : isServiceSale
      ? 'Hizmet satışını adisyona ekle'
      : 'Paket satışını adisyona ekle'

  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className={
            triggerClassName ||
            'inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[#c85776]/40 bg-[#fff1f6] px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-[#b14d6c] transition-colors hover:bg-[#ffe6ef]'
          }
        >
          <TriggerIcon className="h-3.5 w-3.5" /> {triggerLabel || title}
        </button>
      </DialogTrigger>

      <DialogContent
        className="overflow-hidden rounded-[28px] border border-[#ead8df]/[0.90] bg-white/[0.96] p-0 text-[#352432] shadow-[0_34px_120px_-58px_rgba(120,71,88,0.72)] backdrop-blur-2xl sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(94vw, 720px)', maxWidth: 'min(94vw, 720px)', maxHeight: '92dvh' }}
      >
        <div className="relative flex max-h-[92dvh] flex-col overflow-hidden bg-gradient-to-br from-white via-[#fff7fa] to-[#fff0f5]">
          <motion.span
            aria-hidden
            animate={{ opacity: [0.55, 0.95, 0.55] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#f0aac2]/[0.28] blur-3xl"
          />
          <motion.span
            aria-hidden
            animate={{ opacity: [0.4, 0.75, 0.4] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
            className="pointer-events-none absolute -left-20 bottom-20 h-60 w-60 rounded-full bg-[#ffd3df]/[0.22] blur-3xl"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-8 top-0 h-px"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(240,170,194,0.95) 30%, rgba(255,211,223,0.95) 60%, transparent)',
            }}
          />

          {/* HEADER */}
          <header className="relative shrink-0 border-b border-[#ead8df]/[0.70] px-6 py-4 pr-12 sm:px-7">
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-start gap-3.5"
            >
              <motion.span
                whileHover={{ rotate: -8, scale: 1.06 }}
                transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#efbfd0]/[0.80] bg-white text-[#c85776] shadow-[0_14px_34px_-24px_rgba(200,87,118,0.8)]"
              >
                <TriggerIcon className="h-4 w-4" strokeWidth={1.6} />
              </motion.span>
              <div className="min-w-0 flex-1">
                <div className="text-[9px] font-mono uppercase tracking-[0.26em] text-[#c85776]/75">
                  Adisyon API · POST
                </div>
                <DialogTitle className="mt-0.5 font-display text-2xl font-normal tracking-tight text-[#352432]">{title}</DialogTitle>
                <DialogDescription className="mt-0.5 text-[11px] text-[#352432]/50">
                  Satış adisyona düşer; kurum yöneticisi onaylayınca
                  {isProductSale ? ' cariye işlenir ve stoktan düşer.' : ` cariye${isServiceSale ? '' : ' + seans bakiyesine'} işlenir.`}
                </DialogDescription>
              </div>
            </motion.div>
          </header>

          {/* BODY */}
          {done ? (
            <div className="relative px-8 py-12 text-center">
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600"
              >
                <CheckCircle2 className="h-8 w-8" />
              </motion.span>
              <h4 className="mt-4 font-display text-xl tracking-tight text-[#352432]">Satış adisyona eklendi</h4>
              <p className="mx-auto mt-1.5 max-w-sm text-[12px] text-[#352432]/55">
                Adisyon onaylandığında tutar cariye borç olarak yazılacak
                {Number(downPayment) > 0 ? ', peşinat kasaya gelir düşecek' : ''}
                {isProductSale ? ' ve ürün stoktan düşülecek' : isServiceSale ? '' : ' ve paket seansları müşteriye tanımlanacak'}.
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mt-6 rounded-[12px] bg-[#c85776] px-6 py-2.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
              >
                Tamam
              </button>
            </div>
          ) : (
            <div className="relative min-h-0 flex-1 space-y-3.5 overflow-y-auto px-6 py-5 sm:px-7">
              {error && (
                <div className="rounded-[12px] border border-rose-300/40 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>
              )}

              {/* Müşteri */}
              {presetCustomer ? (
                <div className="flex items-center gap-2.5 rounded-[14px] border border-[#ead8df]/70 bg-white px-3 py-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-[#fff1f6] font-display text-[13px] text-[#c85776]">
                    {presetCustomer.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">Müşteri</div>
                    <div className="text-[13.5px] font-medium text-[#352432]">{presetCustomer.name}</div>
                  </div>
                </div>
              ) : (
                <label className={labelCls}>
                  Müşteri
                  <CustomerPicker
                    items={[]}
                    onSearch={customerSearch}
                    value={customerId}
                    onChange={setCustomerId}
                    className={inputCls}
                  />
                </label>
              )}

              <ConsultationWarningBanner customerId={presetCustomer?.id || customerId} tenantId={tenantId} />

              {/* Satılan şey */}
              {isProductSale ? (
                <>
                  <label className={labelCls}>
                    Ürün
                    <select
                      value={productId}
                      onChange={(e) => {
                        setProductId(e.target.value)
                        setPrice('')
                        setQuantity(1)
                      }}
                      className={inputCls}
                    >
                      <option value="">Ürün seç…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id} disabled={p.currentStock <= 0}>
                          {p.name} · {formatTL(p.salePrice)} · stok {p.currentStock} {p.unit}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedProduct && (
                    <div className="flex items-center justify-between gap-2.5 rounded-[14px] border border-violet-200/70 bg-violet-50/60 px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-white text-violet-600">
                          <Box className="h-4 w-4" />
                        </span>
                        <div>
                          <div className="text-[10px] font-mono uppercase tracking-widest text-violet-600/70">
                            {selectedProduct.brand || selectedProduct.categoryLabel}
                          </div>
                          <div className="text-[13.5px] font-medium text-[#352432]">{selectedProduct.name}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-display text-[15px] tabular-nums text-violet-700">{formatTL(selectedProduct.salePrice)}</div>
                        <div className={`text-[10px] ${selectedProduct.isCritical ? 'text-amber-700' : 'text-[#352432]/45'}`}>
                          Stok {selectedProduct.currentStock} {selectedProduct.unit}
                        </div>
                      </div>
                    </div>
                  )}

                  {products.length === 0 && (
                    <div className="rounded-[12px] border border-amber-300/40 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                      Satış fiyatı tanımlı aktif ürün bulunamadı.
                    </div>
                  )}
                </>
              ) : isServiceSale ? (
                presetService ? (
                  <div className="flex items-center justify-between gap-2.5 rounded-[14px] border border-[#efbfd0]/60 bg-[#fff1f6]/60 px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-white text-[#c85776]">
                        <Sparkles className="h-4 w-4" />
                      </span>
                      <div>
                        <div className="text-[10px] font-mono uppercase tracking-widest text-[#b14d6c]/70">Hizmet</div>
                        <div className="text-[13.5px] font-medium text-[#352432]">{presetService.name}</div>
                      </div>
                    </div>
                    <div className="font-display text-[15px] tabular-nums text-[#b14d6c]">{formatTL(Number(presetService.price || 0))}</div>
                  </div>
                ) : (
                  <label className={labelCls}>
                    Hizmet
                    <select
                      value={serviceId}
                      onChange={(e) => {
                        setServiceId(e.target.value)
                        setPrice('')
                      }}
                      className={inputCls}
                    >
                      <option value="">Hizmet seç…</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>{s.name} · {formatTL(s.price)}{s.duration ? ` · ${s.duration} dk` : ''}</option>
                      ))}
                    </select>
                  </label>
                )
              ) : (
                <>
                  <label className={labelCls}>
                    Paket
                    <select
                      value={packageId}
                      onChange={(e) => {
                        setPackageId(e.target.value)
                        setPrice('')
                      }}
                      className={inputCls}
                    >
                      <option value="">Paket seç…</option>
                      {packages.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} · {formatTL(p.totalPrice)} · {p.totalSessions} seans</option>
                      ))}
                    </select>
                  </label>

                  {selectedPackage && selectedPackage.items.length > 0 && (
                    <div className="rounded-[14px] border border-[#ead8df]/65 bg-[#fffafc] p-3">
                      <div className="mb-1.5 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">Paket içeriği</div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedPackage.items.map((it, i) => (
                          <span key={i} className="rounded-md border border-[#e7c7d4]/70 bg-[#fff1f6]/60 px-2 py-1 text-[10.5px] text-[#b14d6c]">
                            {it.serviceName} × {it.sessionCount} seans
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className={`grid gap-3 ${isServiceSale || isProductSale ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <label className={labelCls}>
                  {isServiceSale || isProductSale ? 'Birim fiyat' : 'Satış fiyatı'}
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={price === '' ? (basePrice || '') : price}
                    onChange={(e) => setPrice(e.target.value === '' ? '' : Number(e.target.value))}
                    className={inputCls}
                  />
                </label>
                {(isServiceSale || isProductSale) && (
                  <label className={labelCls}>
                    {isProductSale ? `Miktar${selectedProduct?.unit ? ` (${selectedProduct.unit})` : ''}` : 'Adet'}
                    <input
                      type="number"
                      min={1}
                      max={isProductSale ? selectedProduct?.currentStock : undefined}
                      step={1}
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                      className={inputCls}
                    />
                  </label>
                )}
                <label className={labelCls}>
                  Peşinat (ops.)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={downPayment}
                    onChange={(e) => setDownPayment(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="0,00"
                    className={inputCls}
                  />
                </label>
              </div>

              {/* Ödeme planı: peşin ya da taksit — taksit cariye onayda kurulur */}
              <div className="rounded-[14px] border border-[#ead8df]/70 bg-[#fffafc] p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">
                  <Wallet className="h-3.5 w-3.5" /> Ödeme planı
                </div>
                <div className="inline-flex rounded-[10px] border border-[#ead8df] bg-white p-1">
                  {([['pesin', 'Peşin'], ['taksit', 'Taksit']] as const).map(([k, l]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setPayMode(k)}
                      className={`rounded-[8px] px-5 py-1.5 text-[11px] font-medium transition-colors ${payMode === k ? 'bg-[#c85776] text-white shadow-sm' : 'text-[#352432]/55 hover:bg-[#fff4f8]'}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>

                {isInstallment && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className={labelCls}>
                      Taksit sayısı
                      <input
                        type="number"
                        min={1}
                        max={36}
                        step="1"
                        value={installmentCount}
                        onChange={(e) => setInstallmentCount(Math.max(1, Math.min(36, Number(e.target.value) || 1)))}
                        className={inputCls}
                      />
                    </label>
                    <label className={labelCls}>
                      İlk taksit vadesi
                      <input
                        type="date"
                        value={firstDueDate}
                        onChange={(e) => setFirstDueDate(e.target.value)}
                        className={inputCls}
                      />
                    </label>
                    {perInstallment > 0 && (
                      <div className="flex items-center gap-1.5 rounded-[10px] border border-[#efbfd0]/50 bg-[#fff1f6]/50 px-3 py-2 text-[11px] text-[#b14d6c] sm:col-span-2">
                        <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          {installmentCount} taksit × {formatTL(perInstallment)}
                          {Number(downPayment) > 0 && (
                            <span className="text-emerald-700"> · peşinat {formatTL(Number(downPayment))} ilk taksitlere sayılır</span>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className={labelCls}>
                  Satışı yapan personel (prim · ops.)
                  <select value={staffMemberId} onChange={(e) => setStaffMemberId(e.target.value)} className={inputCls}>
                    <option value="">Personel seç…</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </label>
                <label className={labelCls}>
                  Not (ops.)
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Adisyon notu"
                    className={inputCls}
                  />
                </label>
              </div>

              <div className="flex items-center justify-between rounded-[14px] border border-[#ead8df]/70 bg-white px-3.5 py-2.5">
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[#352432]/55">
                  <ReceiptText className="h-3.5 w-3.5 text-[#c85776]" /> Adisyona yazılacak
                </span>
                <span className="font-display text-[15px] tabular-nums text-[#352432]">
                  Borç {formatTL(total)}
                  {Number(downPayment) > 0 && (
                    <span className="text-emerald-700"> · Tahsilat {formatTL(Number(downPayment))}</span>
                  )}
                  {isInstallment && (
                    <span className="text-[#b14d6c]"> · {installmentCount}× taksit</span>
                  )}
                </span>
              </div>
            </div>
          )}

          {/* FOOTER */}
          {!done && (
            <footer className="relative shrink-0 border-t border-[#ead8df]/[0.70] px-6 py-4 sm:px-7">
              <button
                type="button"
                disabled={busy}
                onClick={submit}
                className="group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-[14px] bg-[#c85776] px-4 py-2.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <TriggerIcon className="h-4 w-4" />
                {busy ? 'Kaydediliyor…' : submitLabel}
              </button>
            </footer>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
