'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  Box,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  Layers3,
  Loader2,
  Package,
  ReceiptText,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Tag,
  Wallet,
} from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useFeature } from '@/components/dashboard/FeatureContext'
import ConsultationWarningBanner from '@/components/dashboard/ConsultationWarningBanner'
import CustomerPicker, { customerSearchProvider } from '@/components/dashboard/CustomerPicker'
import { adminApi } from '@/lib/apiClient'
import { apiItems, formatTL, normalizePackage, normalizeProduct, normalizeService, normalizeStaff } from '@/lib/apiMappers'
import type { ApiAdisyon, ApiCustomer, ApiProduct, ApiService, ApiServicePackage, ApiStaff } from '@/lib/types'

const labelCls = 'block text-[10px] font-mono uppercase tracking-widest text-[#352432]/45'
const inputCls =
  'mt-1 w-full rounded-[10px] border border-[#ead8df] bg-white px-3 py-2 text-[13px] text-[#352432] outline-none transition-colors focus:border-[#c85776]'

type SaleStep = 'form' | 'confirm' | 'done'

/** Kategori + alt kategori + arama ile filtrelenebilen kaynak (paket/hizmet) seçici öğesi. */
interface PickerItem {
  id: string
  name: string
  price: number
  cat: string
  sub: string
  meta?: string
  content?: string[]
}

/**
 * Paket / Hizmet / Ürün Satışı modalı — salon yazılımı standardı akış:
 * satış fiş (adisyon) üzerinden yapılır. Modal içinde satış hazırlanır, "Onayla ve tamamla"
 * adımında adisyon açılır + onaylanır → tutar cariye borç yazılır, paket/hizmetse seans bakiyesi
 * müşteriye tanımlanır (randevuda hemen kullanılabilir), peşinat kasaya düşer. Onay yetkisi olmayan
 * personelde satış yönetici onayına bırakılır.
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
  const [step, setStep] = useState<SaleStep>('form')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Onay yetkisi olmayan personelde satış açık adisyon olarak yönetici onayına bırakılır.
  const [pendingApproval, setPendingApproval] = useState(false)

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
      setStep('form')
      setPendingApproval(false)
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
          ? adminApi.services<ApiService>({ tenantId, page: 1, pageSize: 300 }).catch(() => ({ items: [] }))
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

  // Kategori/alt-kategori/arama ile süzülebilir seçici verisi (paket + hizmet).
  const packagePickerItems = useMemo<PickerItem[]>(
    () => packages.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.totalPrice,
      cat: p.category || '',
      sub: p.subCategory || '',
      meta: `${formatTL(p.totalPrice)} · ${p.totalSessions} seans`,
      content: p.items.slice(0, 5).map((it) => `${it.serviceName} ×${it.sessionCount}`),
    })),
    [packages],
  )
  const servicePickerItems = useMemo<PickerItem[]>(
    () => services.map((s) => ({
      id: s.id,
      name: s.name,
      price: s.price,
      cat: s.group || '',
      sub: s.subGroup || '',
      meta: `${formatTL(s.price)}${s.duration ? ` · ${s.duration} dk` : ''}`,
    })),
    [services],
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
  const pay = Number(downPayment) || 0

  if (!canAdisyon || (isProductSale && !canProducts)) return null

  const reset = () => {
    setStep('form')
    setPendingApproval(false)
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
  }

  // Satılan şeyin adı (özet/onay ekranında).
  const soldName = isProductSale
    ? selectedProduct?.name
    : isServiceSale
      ? selectedService?.name
      : selectedPackage?.name

  // Form doğrulama → onay önizlemesine geç (henüz backend çağrısı yok).
  const goToConfirm = () => {
    const cid = presetCustomer?.id || customerId
    if (!cid) return setError('Müşteri seçin')
    if (!isServiceSale && !isProductSale && !selectedPackage) return setError('Paket seçin')
    if (isServiceSale && !selectedService) return setError('Hizmet seçin')
    if (isProductSale && !selectedProduct) return setError('Ürün seçin')
    if (unitPrice <= 0) return setError('Satış fiyatı pozitif olmalı')
    if (isProductSale && qty > Number(selectedProduct!.currentStock || 0)) {
      return setError(`Yetersiz stok — kullanılabilir ${selectedProduct!.currentStock} ${selectedProduct!.unit}`)
    }
    if (pay < 0 || pay > total) return setError('Peşinat 0 ile toplam tutar arasında olmalı')
    if (isInstallment) {
      if (installmentCount < 1) return setError('Taksit sayısı en az 1 olmalı')
      if (!firstDueDate) return setError('İlk taksit vadesi seçin')
      if (pay >= total) return setError('Peşinat tutarın tamamını karşılıyor — peşin seçin')
    }
    setError('')
    setStep('confirm')
  }

  // Onayla ve tamamla: adisyon aç + kalemleri ekle + onayla (tek akış).
  const confirmAndApprove = async () => {
    const cid = presetCustomer?.id || customerId
    if (!cid) return
    setBusy(true)
    setError('')
    try {
      // 1) Açık adisyonu bul/aç + taksit planını yaz (peşin = 0). Onayda cariye taksitli işlenir.
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

      // 2) Satış kalemi — onayda cariye borç (+ paket/hizmetse müşteriye seans bakiyesi).
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

      // 4) Anında onay — cariye işle + seans bakiyesini aç (randevuda hemen kullanılabilir).
      //    Onay yetkisi olmayan personelde adisyon açık kalır, yönetici onayına düşer.
      try {
        await adminApi.approveAdisyon(adisyon.id, tenantId)
        setPendingApproval(false)
      } catch {
        setPendingApproval(true)
      }

      if (onDone) await onDone()
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Satış kaydedilemedi')
    } finally {
      setBusy(false)
    }
  }

  const finishAndClose = () => {
    const cid = presetCustomer?.id || customerId
    setOpen(false)
    // stayOnPage: randevu modalı gibi akış içinden satışta yönlendirme yapılmaz.
    if (!stayOnPage && cid) router.push(`/admin/musteriler?customer=${cid}&sale=1`)
  }

  const TriggerIcon = isProductSale ? Box : isServiceSale ? ShoppingBag : Package
  const title = isProductSale ? 'Ürün Satışı' : isServiceSale ? 'Hizmet Satışı' : 'Paket Satışı'

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
                {step === 'confirm' ? <ShieldCheck className="h-4 w-4" strokeWidth={1.6} /> : <TriggerIcon className="h-4 w-4" strokeWidth={1.6} />}
              </motion.span>
              <div className="min-w-0 flex-1">
                <div className="text-[9px] font-mono uppercase tracking-[0.26em] text-[#c85776]/75">
                  {step === 'confirm' ? 'Adisyon API · onay' : step === 'done' ? 'Adisyon · tamamlandı' : 'Adisyon API · POST'}
                </div>
                <DialogTitle className="mt-0.5 font-display text-2xl font-normal tracking-tight text-[#352432]">
                  {step === 'confirm' ? 'Satışı onayla' : title}
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-[11px] text-[#352432]/50">
                  {step === 'confirm'
                    ? 'Onaylayınca satış cariye işlenir' + (isProductSale ? ' ve stoktan düşer.' : isServiceSale ? ' ve seans olarak tanımlanır.' : ' ve seans bakiyesi tanımlanır.')
                    : `Satış adisyona düşer; onaylayınca ${isProductSale ? 'cariye işlenir ve stoktan düşer.' : `cariye${isServiceSale ? '' : ' + seans bakiyesine'} işlenir.`}`}
                </DialogDescription>
              </div>
            </motion.div>
          </header>

          {/* BODY */}
          {step === 'done' ? (
            <div className="relative px-8 py-12 text-center">
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                className={`mx-auto grid h-14 w-14 place-items-center rounded-full ${pendingApproval ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}
              >
                {pendingApproval ? <ReceiptText className="h-8 w-8" /> : <CheckCircle2 className="h-8 w-8" />}
              </motion.span>
              <h4 className="mt-4 font-display text-xl tracking-tight text-[#352432]">
                {pendingApproval ? 'Satış oluşturuldu · onay bekliyor' : 'Satış tamamlandı'}
              </h4>
              <p className="mx-auto mt-1.5 max-w-sm text-[12px] text-[#352432]/55">
                {pendingApproval ? (
                  <>Adisyon açıldı; kurum yöneticisi onayladığında tutar cariye işlenecek{isProductSale ? ' ve ürün stoktan düşecek' : isServiceSale ? ' ve hizmet seansı tanımlanacak' : ' ve paket seansları tanımlanacak'}.</>
                ) : (
                  <>
                    Tutar cariye borç olarak yazıldı
                    {pay > 0 ? ', peşinat kasaya gelir düştü' : ''}
                    {isProductSale ? ' ve ürün stoktan düşüldü.' : isServiceSale ? '. Hizmet seansı tanımlandı — randevu vermeye hazır.' : '. Paket seansları tanımlandı — randevu vermeye hazır.'}
                  </>
                )}
              </p>
              <button
                type="button"
                onClick={finishAndClose}
                className="mt-6 rounded-[12px] bg-[#c85776] px-6 py-2.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
              >
                {stayOnPage ? 'Tamam' : 'Müşteri kartına git'}
              </button>
            </div>
          ) : step === 'confirm' ? (
            /* ONAY ÖNİZLEME */
            <div className="relative min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5 sm:px-7">
              {error && (
                <div className="rounded-[12px] border border-rose-300/40 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>
              )}

              <div className="rounded-[16px] border border-[#efbfd0]/60 bg-white/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/70">
                      {isProductSale ? 'Ürün' : isServiceSale ? 'Hizmet' : 'Paket'}
                    </div>
                    <div className="mt-0.5 truncate font-display text-lg tracking-tight text-[#352432]">{soldName}</div>
                    <div className="mt-0.5 text-[11px] text-[#352432]/50">
                      {presetCustomer?.name || 'Müşteri'} · {qty > 1 ? `${qty} adet · ` : ''}birim {formatTL(unitPrice)}
                    </div>
                  </div>
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-[#fff1f6] text-[#c85776]">
                    {isProductSale ? <Box className="h-5 w-5" /> : isServiceSale ? <Sparkles className="h-5 w-5" /> : <Package className="h-5 w-5" />}
                  </span>
                </div>

                {!isProductSale && !isServiceSale && selectedPackage && selectedPackage.items.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[#f1e5ea] pt-3">
                    {selectedPackage.items.map((it, i) => (
                      <span key={i} className="rounded-md border border-[#e7c7d4]/70 bg-[#fff1f6]/60 px-2 py-1 text-[10.5px] text-[#b14d6c]">
                        {it.serviceName} × {it.sessionCount} seans
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2">
                <div className="rounded-[14px] border border-[#ead8df]/70 bg-white px-3.5 py-3">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/45">Adisyona yazılacak</div>
                  <div className="mt-1 font-display text-xl tabular-nums text-[#352432]">Borç {formatTL(total)}</div>
                  {pay > 0 && <div className="text-[11px] text-emerald-700">Tahsilat {formatTL(pay)}</div>}
                </div>
                <div className="rounded-[14px] border border-[#ead8df]/70 bg-white px-3.5 py-3">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/45">Ödeme planı</div>
                  <div className="mt-1 font-display text-xl tracking-tight text-[#352432]">
                    {isInstallment ? `${installmentCount}× taksit` : 'Peşin'}
                  </div>
                  {isInstallment && perInstallment > 0 && (
                    <div className="text-[11px] text-[#b14d6c]">{formatTL(perInstallment)} / ay · ilk {new Date(firstDueDate).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })}</div>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-[12px] border border-emerald-200/60 bg-emerald-50/60 px-3.5 py-2.5 text-[11.5px] leading-snug text-emerald-800">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
                <span>
                  Onaylayınca tutar cariye borç yazılır{pay > 0 ? ', peşinat kasaya gelir düşer' : ''}
                  {isProductSale ? ' ve ürün stoktan düşülür' : isServiceSale ? ' ve hizmet seansı müşteriye tanımlanır' : ' ve paket seansları müşteriye tanımlanır'}. {isProductSale ? '' : 'Randevu buradan hemen açılabilir.'}
                </span>
              </div>
            </div>
          ) : (
            /* FORM */
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
                  <div>
                    <div className={labelCls}>Hizmet</div>
                    <CatalogPicker items={servicePickerItems} value={serviceId} onChange={(id) => { setServiceId(id); setPrice('') }} accent="rose" emptyText="Hizmet bulunamadı." />
                  </div>
                )
              ) : (
                <>
                  <div>
                    <div className={labelCls}>Paket</div>
                    <CatalogPicker items={packagePickerItems} value={packageId} onChange={(id) => { setPackageId(id); setPrice('') }} accent="rose" emptyText="Paket bulunamadı." />
                  </div>
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
                          {pay > 0 && (
                            <span className="text-emerald-700"> · peşinat {formatTL(pay)} ilk taksitlere sayılır</span>
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
                  {pay > 0 && (
                    <span className="text-emerald-700"> · Tahsilat {formatTL(pay)}</span>
                  )}
                  {isInstallment && (
                    <span className="text-[#b14d6c]"> · {installmentCount}× taksit</span>
                  )}
                </span>
              </div>
            </div>
          )}

          {/* FOOTER */}
          {step === 'form' && (
            <footer className="relative shrink-0 border-t border-[#ead8df]/[0.70] px-6 py-4 sm:px-7">
              <button
                type="button"
                onClick={goToConfirm}
                className="group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-[14px] bg-[#c85776] px-4 py-2.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
              >
                <ShieldCheck className="h-4 w-4" />
                Satışı incele ve onayla
              </button>
            </footer>
          )}
          {step === 'confirm' && (
            <footer className="relative flex shrink-0 items-center gap-2.5 border-t border-[#ead8df]/[0.70] px-6 py-4 sm:px-7">
              <button
                type="button"
                disabled={busy}
                onClick={() => { setError(''); setStep('form') }}
                className="inline-flex items-center gap-1.5 rounded-[14px] border border-[#ead8df] bg-white px-4 py-2.5 text-[12.5px] font-medium text-[#705a66] transition-colors hover:border-[#efbfd0] hover:text-[#c85776] disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" /> Düzenle
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={confirmAndApprove}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-[14px] bg-[#c85776] px-4 py-2.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {busy ? 'Onaylanıyor…' : 'Onayla ve tamamla'}
              </button>
            </footer>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Kategori + alt kategori + arama ile süzülebilir seçici ----------

function CatalogPicker({
  items,
  value,
  onChange,
  accent = 'rose',
  emptyText,
}: {
  items: PickerItem[]
  value: string
  onChange: (id: string) => void
  accent?: 'rose' | 'violet'
  emptyText: string
}) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [sub, setSub] = useState('')

  const cats = useMemo(
    () => Array.from(new Set(items.map((i) => i.cat).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'tr')),
    [items],
  )
  const subs = useMemo(
    () => Array.from(new Set(items.filter((i) => !cat || i.cat === cat).map((i) => i.sub).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'tr')),
    [items, cat],
  )
  const filtered = useMemo(() => {
    const term = q.trim().toLocaleLowerCase('tr')
    return items.filter(
      (i) =>
        (!cat || i.cat === cat) &&
        (!sub || i.sub === sub) &&
        (!term || i.name.toLocaleLowerCase('tr').includes(term)),
    )
  }, [items, cat, sub, q])

  const selectedActive = accent === 'violet'
    ? 'border-violet-400 bg-violet-50'
    : 'border-[#c85776] bg-[#fdf4f8]'
  const pillActive = accent === 'violet'
    ? 'bg-violet-500 text-white'
    : 'bg-[#c85776] text-white'

  const Pill = ({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-medium transition-colors ${
        active ? pillActive : 'border border-[#ead8df] bg-white text-[#352432]/60 hover:bg-[#fff4f8]'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="mt-1 space-y-2">
      {/* Arama */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#c85776]/50" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ada göre ara…"
          className="w-full rounded-[10px] border border-[#ead8df] bg-white py-2 pl-9 pr-3 text-[13px] text-[#352432] outline-none transition-colors focus:border-[#c85776]"
        />
      </div>

      {/* Üst kategori filtresi */}
      {cats.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <Tag className="h-3 w-3 shrink-0 text-[#c85776]/50" />
          <Pill active={!cat} label="Tümü" onClick={() => { setCat(''); setSub('') }} />
          {cats.map((c) => (
            <Pill key={c} active={cat === c} label={c} onClick={() => { setCat(c); setSub('') }} />
          ))}
        </div>
      )}

      {/* Alt kategori filtresi (seçili üst kategoriye göre) */}
      {subs.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 pl-4">
          <Layers3 className="h-3 w-3 shrink-0 text-[#c85776]/40" />
          <Pill active={!sub} label="Tüm alt kategoriler" onClick={() => setSub('')} />
          {subs.map((s) => (
            <Pill key={s} active={sub === s} label={s} onClick={() => setSub(s)} />
          ))}
        </div>
      )}

      {/* Sonuç listesi */}
      <div className="max-h-60 space-y-1.5 overflow-y-auto rounded-[12px] border border-[#ead8df]/70 bg-[#fffafc] p-1.5">
        {filtered.map((i) => {
          const active = value === i.id
          return (
            <button
              key={i.id}
              type="button"
              onClick={() => onChange(i.id)}
              className={`flex w-full items-start justify-between gap-2 rounded-[10px] border px-3 py-2 text-left transition-colors ${
                active ? selectedActive : 'border-transparent bg-white hover:border-[#efbfd0]'
              }`}
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-[#352432]">{i.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-[#352432]/45">
                  {i.cat && <span className="rounded bg-[#fff1f6] px-1 py-0.5 text-[#b14d6c]">{i.cat}</span>}
                  {i.sub && <span className="rounded bg-[#f4ecf9] px-1 py-0.5 text-violet-600">{i.sub}</span>}
                  {i.meta && <span>{i.meta}</span>}
                </div>
                {i.content && i.content.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {i.content.map((c, idx) => (
                      <span key={idx} className="rounded border border-[#e7c7d4]/60 bg-white px-1 py-0.5 text-[9.5px] text-[#b14d6c]">{c}</span>
                    ))}
                  </div>
                )}
              </div>
              {active && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#c85776]" />}
            </button>
          )
        })}
        {filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-[12px] text-[#352432]/45">{emptyText}</div>
        )}
      </div>
    </div>
  )
}
