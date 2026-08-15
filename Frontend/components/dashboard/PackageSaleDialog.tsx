'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Box,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  Package,
  Plus,
  ReceiptText,
  ShieldCheck,
  ShoppingBag,
  Gift,
  Sparkles,
  Star,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import CatalogPicker, { type PickerItem } from '@/components/dashboard/CatalogPicker'
import ConsentSaleNotice from '@/components/dashboard/ConsentSaleNotice'
import AdisyonModal from '@/components/dashboard/AdisyonModal'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useAuth } from '@/components/dashboard/AuthContext'
import { useFeature } from '@/components/dashboard/FeatureContext'
import ConsultationWarningBanner from '@/components/dashboard/ConsultationWarningBanner'
import CustomerPicker, { customerSearchProvider } from '@/components/dashboard/CustomerPicker'
import { normalizeGiftCard } from '@/lib/apiMappers'
import type { ApiGiftCard, GiftCard } from '@/lib/types'
import { adminApi } from '@/lib/apiClient'
import {
  clearPersistentIdempotencySalt, idempotencyKey, newIdempotencySalt, persistentIdempotencySalt,
} from '@/lib/idempotency'

/**
 * Kalıcı tuzun kapsamı. Ekran genelinde TEK kapsam yeter: anahtar zaten müşteri/paket/tutar
 * gibi ayırt edici alanlardan türüyor, tuz yalnız "bu gönderim oturumu" demek. Başarı, iptal
 * ve sıfırlama yollarında düşürülür.
 */
const SALE_SALT_SCOPE = 'package-sale'
import { apiItems, categoryOrderIndex, formatTL, normalizeCustomServiceCategory, normalizePackage, normalizeProduct, normalizeService, normalizeStaff } from '@/lib/apiMappers'
import type { ApiAdisyon, ApiCustomer, ApiCustomServiceCategory, ApiProduct, ApiService, ApiServicePackage, ApiStaff } from '@/lib/types'

const labelCls = 'block text-[10px] font-mono uppercase tracking-widest text-[#74616A]'
const inputCls =
  'mt-1 w-full rounded-[10px] border border-[#EAD8DF] bg-white px-3 py-2 text-[13px] text-[#2A2027] outline-none transition-colors focus:border-[#A5556E]'

/**
 * Peşinat ödeme yöntemleri — CollectionDialog'daki METHOD_OPTIONS ile AYNI değerler.
 * Değerler backend'in beklediği ham anahtarlardır (`cash`/`card`/`transfer`); etiket
 * çevirisi tek yerden yapılır (bkz. lib/apiMappers → paymentMethodLabel).
 */
const DOWN_PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'cash', label: 'Nakit' },
  { value: 'card', label: 'Kart' },
  { value: 'transfer', label: 'Havale / EFT' },
]

type SaleStep = 'form' | 'confirm' | 'done'

/** Onay adımında satışa eklenen ek kalemin türü — adisyon kartındaki kalem türlerinin satış alt kümesi. */
type ExtraKind = 'service' | 'package' | 'product'

/**
 * Onay adımında satışa eklenen ek kalem (henüz kaydedilmedi — yalnız bellekte).
 *
 * <p>Adisyon BİLEREK önceden açılmaz: kullanıcı onaydan vazgeçerse ortada kalem toplamış açık bir
 * fiş kalırdı ve hizmet/paket fişleri "ilk randevuda otomatik işlenir" bayrağını taşıdığı için o
 * hayalet fiş müşterinin ilk randevusunda sessizce cariye borç yazardı. Bütün kalemler tek akışta,
 * "kaydet" anında yazılır.</p>
 */
interface SaleExtra {
  key: string
  kind: ExtraKind
  refId: string
  name: string
  unitPrice: number
  quantity: number
  /** Prim + "kim sattı" — boş bırakılabilir (ana satıştaki personel alanıyla aynı kural). */
  staffMemberId: string
}

const extraKindLabels: Record<ExtraKind, string> = { service: 'Hizmet', package: 'Paket', product: 'Ürün' }
const extraKindIcons: Record<ExtraKind, typeof Sparkles> = { service: Sparkles, package: Boxes, product: Box }
const extraKindTones: Record<ExtraKind, string> = {
  service: 'border-sky-300/50 bg-sky-50 text-sky-700',
  package: 'border-fuchsia-300/50 bg-fuchsia-50 text-fuchsia-700',
  product: 'border-violet-300/50 bg-violet-50 text-violet-700',
}

/**
 * Paket / Hizmet / Ürün Satışı modalı — salon yazılımı standardı akış:
 * satış fiş (adisyon) üzerinden yapılır. Modal içinde satış hazırlanır, onay adımında adisyon
 * kartındaki gibi EK hizmet/paket/ürün eklenebilir, "Satışı kaydet" ile iş biter.
 *
 * <p><b>ADİSYON KARTI KENDİLİĞİNDEN AÇILMAZ</b> (kullanıcı talebi: süreç uzuyordu). Ne olacağını
 * kullanıcıya sormak yerine TAHSİLAT belirler:</p>
 * <ul>
 *   <li><b>Peşinat alındıysa</b> → satış kaydedilir kaydedilmez onaylanır: cariye borç, peşinat
 *       kasaya, seans/stok o an işlenir.</li>
 *   <li><b>Alınmadıysa</b> → satış açık kalır ve müşteri ilk randevusunu tamamladığında otomatik
 *       cariye işlenir (eski Faz 2 davranışı).</li>
 *   <li><b>Fişte ürün varsa</b> erteleme mümkün değildir (stok rezerve edilmez) → peşinat olmasa da
 *       hemen onaylanır.</li>
 * </ul>
 * <p>Onay yetkisi olmayan personelde onay isteği yöneticiye gider.</p>
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
  /** Tetik butonunun etiketi. ReactNode kabul eder — ör. navbar'da dar ekranda gizlenen bir <span>. */
  triggerLabel?: ReactNode
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
  /**
   * SATIŞ AKIŞININ ÇİFT KAYIT FRENİ (bkz. lib/idempotency).
   *
   * Akış üç ayrı yazmadır (fiş aç → N kalem → onayla) ama TEK bir işlemdir: hepsi aynı tuzdan
   * türetilir. Ağ kesilip kullanıcı tekrar gönderdiğinde fiş açma isteği ilk yanıtı oynatır,
   * AYNI `createdId` döner ve kalemler de oynatılır — yani ikinci bir fiş açılmaz ve kalemler
   * çiftlenmez. Tuz akış ortasında dönerse tam tersi olur: ikinci fiş açılır.
   */
  const saleSaltRef = useRef<string>('')
  // KALICI TUZ: gönderim sırasında sayfa yenilenirse (ya da sekme kapanıp açılırsa) aynı tuz
  // geri gelir; yanıtı kaybolmuş bir satışın tekrarı sunucuda oynatılır, ikinci fiş açılmaz.
  // Başarı/iptal yollarında düşürülür, böylece "aynı satışı bir daha yapmak" meşru kalır.
  if (!saleSaltRef.current) saleSaltRef.current = persistentIdempotencySalt(SALE_SALT_SCOPE)
  /**
   * Bu oturumda fişe YAZILMIŞ peşinat kalemi (varsa).
   *
   * Tekrar denemede tutar/yöntem değişmişse önce bu kalem silinir: `addAdisyonItem` bir EKLEME
   * ucudur, ikinci çağrı peşinatı güncellemez, İKİNCİSİNİ ekler (200 ₺ → 400 ₺).
   */
  const depositRef = useRef<{ itemId: string; amount: number; method: string } | null>(null)
  const [step, setStep] = useState<SaleStep>('form')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Onay yetkisi olmayan personelde satış açık adisyon olarak yönetici onayına bırakılır.
  const [pendingApproval, setPendingApproval] = useState(false)
  const { user } = useAuth()
  const isStaffUser = user?.role === 'Staff'

  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
  // Satış sonrası açılan adisyon kartı — Ön Muhasebe'deki gibi açık adisyon.
  const [cardCustomer, setCardCustomer] = useState<{ id: string; name: string } | null>(null)
  const [packageId, setPackageId] = useState('')
  const [serviceId, setServiceId] = useState('')

  /*
   * MÜŞTERİNİN HEDİYE ÇEKİ.
   *
   * Çek bir katalog kaydına bağlıysa (hizmet/paket) satış ekranı onu KENDİLİĞİNDEN seçer —
   * kullanıcı listede aramak zorunda kalmasın. Seçim SESSİZ DEĞİLDİR: üstte bir şerit çıkar ve
   * neyin neden seçildiğini söyler; aksi hâlde kullanıcı kendi seçmediği bir kalemi satmış olur.
   *
   * PARA BURADA İŞLENMEZ: indirim adisyonda, kod uygulanarak yapılır (ApplyGiftCardAsync).
   * Burası yalnız doğru kalemi bulmayı kolaylaştırır.
   */
  const [giftCards, setGiftCards] = useState<GiftCard[]>([])
  /**
   * SADAKAT PUANI. Ek kalem bölümünde "bu müşteri kaç puanı var, bu puanla neyi hediye
   * edebilir" sorusunu cevaplar. Puanla hediye etme İŞLEMİ adisyonda yapılır (kalem
   * `coveredByPackage`/hediye olarak işlenir); burası yalnız hangi kalemlerin YETECEĞİNİ söyler.
   */
  const [loyaltyPoints, setLoyaltyPoints] = useState<number | null>(null)
  /** Otomatik seçim yapıldı mı — kullanıcı sonradan değiştirirse tekrar üzerine yazmayız. */
  const autoPickedRef = useRef(false)
  const [productId, setProductId] = useState('')
  const [price, setPrice] = useState<number | ''>('')
  const [quantity, setQuantity] = useState(1)
  const [downPayment, setDownPayment] = useState<number | ''>('')
  /**
   * PEŞİNATIN ÖDEME YÖNTEMİ (nakit/kart/havale).
   *
   * Adisyon kalemi `method` taşır ve onayda `AdisyonService` yöntem BAŞINA ayrı bir
   * `AccountPayment` açar. Yöntem gönderilmezse sunucu "cash" varsayar — yani kartla alınan
   * peşinat kasa kapanışında nakit görünüyor, gün sonu sayımı tutmuyordu.
   */
  const [downPaymentMethod, setDownPaymentMethod] = useState('cash')
  const [staffMemberId, setStaffMemberId] = useState('')
  const [notes, setNotes] = useState('')
  // Ödeme planı: peşin (taksit yok) ya da taksit (N ay, ilk vade). Cariye onayda işlenir.
  const [payMode, setPayMode] = useState<'pesin' | 'taksit'>('pesin')
  const [installmentCount, setInstallmentCount] = useState(3)
  const [firstDueDate, setFirstDueDate] = useState('')
  /**
   * SATIŞ TARİHİ — geçmişe dönük giriş için (ör. ürün dün satıldı, bugün kaydediliyor).
   * Cariye bu tarih yazılır ve peşinat tahsilatı da bu güne düşer; boş/bugün ise eski davranış.
   * Yalnız ürün satışında gösterilir: hizmet/paket satışı ertelenebildiği için orada kullanıcının
   * verdiği tarih anlamını yitirir.
   */
  const [saleDate, setSaleDate] = useState('')

  /** Satış açık kaldı: ilk randevu tamamlanınca otomatik cariye işlenecek (done ekranı bunu yazar). */
  const [deferred, setDeferred] = useState(false)

  // ---- ONAY ADIMI: ek kalemler ----
  const [extras, setExtras] = useState<SaleExtra[]>([])
  const extraSeq = useRef(0)
  /** Açık ek kalem formunun türü; null = form kapalı. */
  const [extraKind, setExtraKind] = useState<ExtraKind | null>(null)
  const [extraRefId, setExtraRefId] = useState('')
  const [extraPrice, setExtraPrice] = useState<number | ''>('')
  const [extraQty, setExtraQty] = useState(1)
  const [extraStaffId, setExtraStaffId] = useState('')
  const [extraError, setExtraError] = useState('')
  /**
   * Fiş yazıldı ama ONAY başarısız oldu — fişin içeriği eksiksizdir, silinmez. Kullanıcı adisyon
   * kartından tekrar onaylar. Doluyken "kaydet" tuşları kapanır: ikinci deneme aynı satışı ikinci
   * kez yazardı.
   */
  const [savedAdisyonId, setSavedAdisyonId] = useState('')

  const clearExtraForm = (): void => {
    setExtraKind(null)
    setExtraRefId('')
    setExtraPrice('')
    setExtraQty(1)
    setExtraStaffId('')
    setExtraError('')
  }

  // Ön-seçimler modal her açılışta tazelensin
  useEffect(() => {
    if (open) {
      setStep('form')
      setPendingApproval(false)
      setDeferred(false)
      setCustomerId(presetCustomer?.id || '')
      setCustomerName(presetCustomer?.name || '')
      setPackageId(presetPackageId || '')
      setServiceId(presetService?.id || '')
      setProductId('')
      setExtras([])
      setSavedAdisyonId('')
      clearExtraForm()
      // İlk taksit vadesi varsayılan: bir ay sonrası.
      const d = new Date()
      d.setMonth(d.getMonth() + 1)
      setFirstDueDate(d.toISOString().slice(0, 10))
      // Satış tarihi varsayılan: BUGÜN (yerel). toISOString() UTC verir; gece yarısından sonra
      // (UTC+3) bir önceki güne kayar ve satış düne yazılırdı.
      const t = new Date()
      setSaleDate(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /**
   * KATALOGLARIN TAMAMI HER MODDA ÇEKİLİR. Eskiden yalnız satılan türün listesi geliyordu (paket
   * satışında hizmet/ürün listesi boştu); onay adımındaki "ek kalem" seçici o modlarda boş liste
   * gösterirdi. Müşteri listesi çekilmez — sınırsız müşteri ölçeğinde seçim sunucu aramasıyla yapılır.
   */
  const { data } = useApiQuery<{ customers: ApiCustomer[]; packages: ApiServicePackage[]; services: ApiService[]; products: ApiProduct[]; staff: ApiStaff[]; cats: ApiCustomServiceCategory[] }>(
    async () => {
      if (!open) return { customers: [], packages: [], services: [], products: [], staff: [], cats: [] }
      const [packages, services, products, staff, cats] = await Promise.all([
        adminApi.packages<ApiServicePackage>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.services<ApiService>({ tenantId, page: 1, pageSize: 300 }).catch(() => ({ items: [] })),
        canProducts
          ? adminApi.products<ApiProduct>({ tenantId, page: 1, pageSize: 500 }).catch(() => ({ items: [] }))
          : Promise.resolve({ items: [] }),
        adminApi.staff<ApiStaff>({ tenantId, page: 1, pageSize: 200 }).catch(() => ({ items: [] })),
        adminApi.serviceCategories<ApiCustomServiceCategory>(tenantId).catch(() => []),
      ])
      return {
        customers: [],
        packages: apiItems(packages),
        services: apiItems(services),
        products: apiItems(products),
        staff: apiItems(staff),
        cats: Array.isArray(cats) ? cats : [],
      }
    },
    [open, tenantId, canProducts],
    { initialData: { customers: [], packages: [], services: [], products: [], staff: [], cats: [] } },
  )

  // Kategori pill sıralaması için manuel sıra çözücü (SortOrder).
  const categoryOrder = useMemo(() => categoryOrderIndex((data?.cats || []).map((c, i) => normalizeCustomServiceCategory(c, i))), [data])

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

  // Kategori/alt-kategori/arama ile süzülebilir seçici verisi (paket + hizmet + ürün).
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
  const productPickerItems = useMemo<PickerItem[]>(
    () => products.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.salePrice,
      cat: p.categoryLabel || '',
      sub: p.brand || '',
      meta: `${formatTL(p.salePrice)} · stok ${p.currentStock} ${p.unit}`,
    })),
    [products],
  )

  const selectedPackage = packages.find((p) => p.id === packageId)
  // Hizmet satışında: sabit gelen hizmet ya da listeden seçilen.
  const pickedService = services.find((s) => s.id === serviceId)
  const selectedService: { id: string; name: string; price: number } | null =
    presetService ?? (pickedService ? { id: pickedService.id, name: pickedService.name, price: pickedService.price } : null)
  const selectedProduct = products.find((p) => p.id === productId)

  /** Müşteri değişince sadakat puanını tazele. Hata YUTULUR: satış akışı bu yüzden durmaz. */
  useEffect(() => {
    const cid = presetCustomer?.id || customerId
    if (!open || !cid || !tenantId) { setLoyaltyPoints(null); return }
    let alive = true
    void (async () => {
      try {
        const res = await adminApi.loyaltyBalance<{ balance?: number; points?: number }>(cid, tenantId)
        const value = Number(res?.balance ?? res?.points ?? 0)
        if (alive) setLoyaltyPoints(Number.isFinite(value) ? value : 0)
      } catch {
        if (alive) setLoyaltyPoints(null)
      }
    })()
    return () => { alive = false }
  }, [open, presetCustomer?.id, customerId, tenantId])

  /**
   * Mevcut puanla HEDİYE EDİLEBİLECEK kalemler.
   *
   * Ölçüt kataloğun kendi alanıdır (`loyaltyPointCost` > 0 ve puana yetiyorsa) — bkz. hizmet/paket
   * tanımı. Puanı 0 olan kayıt "hediye edilemez" demektir, listeye hiç girmez.
   */
  const giftableWithPoints = useMemo(() => {
    if (loyaltyPoints === null || loyaltyPoints <= 0) return { services: [], packages: [] }
    return {
      services: services.filter((x) => x.loyaltyPointCost > 0 && x.loyaltyPointCost <= loyaltyPoints),
      packages: packages.filter((x) => x.loyaltyPointCost > 0 && x.loyaltyPointCost <= loyaltyPoints),
    }
  }, [loyaltyPoints, services, packages])

  /** Müşteri değişince çekleri tazele; müşteri yoksa listeyi boşalt. */
  useEffect(() => {
    const cid = presetCustomer?.id || customerId
    if (!open || !cid || !tenantId) { setGiftCards([]); autoPickedRef.current = false; return }
    let alive = true
    void (async () => {
      try {
        const rows = await adminApi.giftCardsByCustomer<ApiGiftCard>(cid, tenantId)
        if (alive) setGiftCards((rows || []).map((g, i) => normalizeGiftCard(g, i)))
      } catch {
        // Çek listesi alınamazsa satış akışı DURMAZ: bu yalnız bir kolaylık katmanı.
        if (alive) setGiftCards([])
      }
    })()
    return () => { alive = false }
  }, [open, presetCustomer?.id, customerId, tenantId])

  /**
   * Çeke bağlı katalog kaydı satılacak türle uyuşuyorsa otomatik seçilir.
   * Kullanıcının önceki seçimi EZİLMEZ: yalnız alan boşken ve bir kez.
   */
  const autoGift = useMemo(
    () => giftCards.find((g) => (isServiceSale ? g.serviceDefinitionId : g.servicePackageId)) ?? null,
    [giftCards, isServiceSale],
  )

  useEffect(() => {
    if (!autoGift || autoPickedRef.current || isProductSale) return
    if (isServiceSale) {
      if (serviceId || !autoGift.serviceDefinitionId) return
      setServiceId(autoGift.serviceDefinitionId)
    } else {
      if (packageId || !autoGift.servicePackageId) return
      setPackageId(autoGift.servicePackageId)
    }
    autoPickedRef.current = true
  }, [autoGift, isServiceSale, isProductSale, serviceId, packageId])

  const basePrice = isProductSale
    ? Number(selectedProduct?.salePrice || 0)
    : isServiceSale
      ? Number(selectedService?.price || 0)
      : Number(selectedPackage?.totalPrice || 0)
  const unitPrice = price === '' ? basePrice : Number(price)
  const qty = isProductSale || isServiceSale ? Math.max(1, quantity) : 1
  const mainTotal = Math.round(unitPrice * qty * 100) / 100
  const extrasTotal = Math.round(extras.reduce((sum, e) => sum + e.unitPrice * e.quantity, 0) * 100) / 100
  const total = Math.round((mainTotal + extrasTotal) * 100) / 100
  const isInstallment = payMode === 'taksit'
  const perInstallment = isInstallment && installmentCount > 0 ? Math.round((total / installmentCount) * 100) / 100 : 0
  /**
   * PEŞİNAT ALANI HER SATIŞ TÜRÜNDE AÇIKTIR (9 Ağu 2026, kullanıcı kararı).
   *
   * <p>
   * Alan bir dönem hizmet satışında GİZLENİYORDU (o da bir kullanıcı talebiydi). Sonuç: hizmet
   * satışında tahsilat alınamıyor, dolayısıyla satış cariye HEMEN işlenemiyor, her zaman ilk
   * randevuya erteleniyordu — paket satışında yapılabilen şey hizmette yapılamıyordu. Kullanıcı
   * bu kısıtın kalkmasını ve iki modalın AYNI sistemi paylaşmasını istedi.
   * </p>
   * <p>
   * Alan OPSİYONELDİR: boş bırakılırsa davranış eskisi gibi (erteleme), tutar girilirse satış
   * kaydedilir kaydedilmez cariye işlenir (bkz. <c>approveNow</c>). Yani eski akış kaybolmaz,
   * yanına ikinci bir yol eklenir.
   * </p>
   */
  const showDownPayment = true
  const pay = Number(downPayment) || 0

  /**
   * ERTELEME (ilk randevuda otomatik cariye işleme) YALNIZ ÜRÜNSÜZ FİŞTE MÜMKÜNDÜR.
   *
   * <p>Erteleme stok REZERVE ETMEZ. Fişte ürün varken beklerken o stok başka yerde satılırsa, ilk
   * randevu tamamlanırken çalışan otomatik onay stok kontrolüne takılır ve <em>randevunun
   * tamamlanması</em> topluca başarısız olur (bkz. AppointmentService — onay başarısızsa tamamlama
   * da başarısızdır). Ürün içeren fiş bu yüzden peşinat olmasa da hemen onaylanır; ertelenmez.</p>
   */
  const hasProductItem = isProductSale || extras.some((e) => e.kind === 'product')
  const canDefer = !hasProductItem
  /**
   * Fişte SEANS üreten kalem (hizmet ya da paket satışı) var mı? "Ürün satışı değil" ile aynı şey
   * DEĞİLDİR: ürün satışına ürün ek kalemi eklenince fiş hâlâ tamamen üründür. Ayrım yapılmazsa
   * kullanıcıya "hizmet/paket seansları tanımlandı" denip hiç seans açılmamış olur.
   */
  const hasSessionItem = !isProductSale || extras.some((e) => e.kind !== 'product')

  /**
   * KAYDEDİNCE NE OLACAK — kullanıcıya sorulmaz, tahsilattan türetilir (kullanıcı kuralı):
   * peşinat alındıysa satış hemen cariye işlenir; alınmadıysa ilk randevuya ertelenir. Ürünlü fiş
   * ertelenemediği için peşinatsız da olsa hemen işlenir. Her hâlde adisyon kartı AÇILMAZ.
   */
  const approveNow = pay > 0 || !canDefer

  if (!canAdisyon || (isProductSale && !canProducts)) return null

  const reset = () => {
    // Yeni satış = yeni tuz. Aynı müşteriye birebir aynı satışı tekrar yapmak MEŞRUDUR;
    // tuz dönmeseydi ikinci satış birincinin yanıtı olarak oynatılıp sessizce yutulurdu.
    // Kalıcı kopya da düşer — yoksa yenileme sonrası eski tuz geri gelirdi.
    clearPersistentIdempotencySalt(SALE_SALT_SCOPE)
    saleSaltRef.current = newIdempotencySalt()
    depositRef.current = null
    setStep('form')
    setPendingApproval(false)
    setDeferred(false)
    setServiceId(presetService?.id || '')
    setProductId('')
    setPrice('')
    setQuantity(1)
    setDownPayment('')
    setStaffMemberId('')
    setNotes('')
    setPayMode('pesin')
    setDownPaymentMethod('cash')
    setInstallmentCount(3)
    setExtras([])
    setSavedAdisyonId('')
    clearExtraForm()
    setError('')
  }

  // Satılan şeyin adı (özet/onay ekranında).
  const soldName = isProductSale
    ? selectedProduct?.name
    : isServiceSale
      ? selectedService?.name
      : selectedPackage?.name

  /**
   * Fişteki TÜM ürün kalemleri (ana satış + ek kalemler) için toplam stok kontrolü.
   * Aynı ürün hem ana satışta hem ek kalemde olabilir; backend de stoğu ürün bazında TOPLAYARAK
   * denetler (AdisyonService.ApproveCoreAsync) — istemci tarafı aynı ölçütü kullanmazsa kullanıcı
   * hatayı ancak onay anında görürdü.
   */
  const stockError = (candidate?: SaleExtra): string => {
    const need = new Map<string, number>()
    if (isProductSale && selectedProduct) need.set(selectedProduct.id, qty)
    for (const e of [...extras, ...(candidate ? [candidate] : [])]) {
      if (e.kind === 'product') need.set(e.refId, (need.get(e.refId) || 0) + e.quantity)
    }
    for (const [pid, wanted] of need) {
      const p = products.find((x) => x.id === pid)
      if (!p) return 'Fişteki ürünlerden biri listede bulunamadı — kalemi kaldırıp yeniden ekleyin.'
      if (wanted > p.currentStock) {
        return `${p.name} için stok yetersiz — istenen ${wanted}, mevcut ${p.currentStock} ${p.unit}.`
      }
    }
    return ''
  }

  // Form doğrulama → onay önizlemesine geç (henüz backend çağrısı yok).
  const goToConfirm = () => {
    const cid = presetCustomer?.id || customerId
    if (!cid) return setError('Müşteri seçin')
    if (!isServiceSale && !isProductSale && !selectedPackage) return setError('Paket seçin')
    if (isServiceSale && !selectedService) return setError('Hizmet seçin')
    if (isProductSale && !selectedProduct) return setError('Ürün seçin')
    if (unitPrice <= 0) return setError('Satış fiyatı pozitif olmalı')
    const stockMsg = stockError()
    if (stockMsg) return setError(stockMsg)
    if (pay < 0 || pay > total) return setError('Peşinat 0 ile toplam tutar arasında olmalı')
    if (isInstallment) {
      if (installmentCount < 1) return setError('Taksit sayısı en az 1 olmalı')
      if (!firstDueDate) return setError('İlk taksit vadesi seçin')
      if (pay >= total) return setError('Peşinat tutarın tamamını karşılıyor — peşin seçin')
    }
    setError('')
    setStep('confirm')
  }

  // ---- Ek kalem ekleme (onay adımı) ----
  const extraBasePrice = (kind: ExtraKind, refId: string): number =>
    kind === 'service'
      ? Number(services.find((s) => s.id === refId)?.price || 0)
      : kind === 'package'
        ? Number(packages.find((p) => p.id === refId)?.totalPrice || 0)
        : Number(products.find((p) => p.id === refId)?.salePrice || 0)

  const extraName = (kind: ExtraKind, refId: string): string =>
    (kind === 'service'
      ? services.find((s) => s.id === refId)?.name
      : kind === 'package'
        ? packages.find((p) => p.id === refId)?.name
        : products.find((p) => p.id === refId)?.name) || ''

  const addExtra = () => {
    if (!extraKind) return
    if (!extraRefId) return setExtraError(`${extraKindLabels[extraKind]} seçin`)
    const name = extraName(extraKind, extraRefId)
    if (!name) return setExtraError('Seçim listede bulunamadı — tekrar seçin')
    const unit = extraPrice === '' ? extraBasePrice(extraKind, extraRefId) : Number(extraPrice)
    if (!(unit > 0)) return setExtraError('Birim fiyat pozitif olmalı')
    const q = Math.max(1, Number(extraQty) || 1)
    const candidate: SaleExtra = {
      key: `x${++extraSeq.current}`,
      kind: extraKind,
      refId: extraRefId,
      name,
      unitPrice: Math.round(unit * 100) / 100,
      quantity: q,
      staffMemberId: extraStaffId,
    }
    const stockMsg = stockError(candidate)
    if (stockMsg) return setExtraError(stockMsg)
    setExtras((list) => [...list, candidate])
    clearExtraForm()
    setError('')
  }

  const removeExtra = (key: string) => {
    setExtras((list) => list.filter((e) => e.key !== key))
    setError('')
  }

  /**
   * SATIŞI KAYDET — tek tuş, tek akış: adisyon aç → ana satış kalemi → ek kalemler → peşinat →
   * (peşinat/ürün varsa) onayla. Adisyon kartı açılmaz; sonuç done ekranında yazılır.
   */
  const submitSale = async () => {
    const cid = presetCustomer?.id || customerId
    if (!cid || savedAdisyonId) return

    // SON DOĞRULAMA: bu adımda ek kalem eklendiği için tutar formdaki hâlinden büyük olabilir.
    const stockMsg = stockError()
    if (stockMsg) return setError(stockMsg)
    if (pay > total) return setError('Peşinat toplam tutarı aşıyor — ek kalemleri ya da peşinatı düzenleyin')
    if (isInstallment && pay >= total) return setError('Peşinat tutarın tamamını karşılıyor — peşin seçin')

    /**
     * ERTELEME BAYRAĞI.
     *
     * <p>Kural: ürünsüz fiş + (peşinatsız satış YA DA personelin onay isteği). Personelde bayrak
     * "onayla" yolunda da AÇIK kalır çünkü personelin onayı anında işlemez, yöneticinin Onaylar
     * sayfasında bekler; o beklerken müşteri randevusuna gelebilir. Bayrak kapalı olsaydı randevu,
     * seansı henüz açılmamış bir satışla tamamlanır — hizmet bedelsiz verilmiş, satış ortada kalmış
     * olurdu. Hangisi önce gerçekleşirse satışı o işler; ikincisi "yalnızca açık adisyon
     * onaylanabilir" ile durur, çift kayıt oluşmaz.</p>
     *
     * <p>Yönetici rollerinde onay SENKRON işler; başarısız olursa fiş açık kalır ama bayrak
     * KAPALIDIR — hata gösterilen bir satış, kimse farkında değilken ilk randevuda sessizce
     * cariye işlenmemelidir.</p>
     */
    const willDefer = canDefer && (!approveNow || isStaffUser)

    setBusy(true)
    setError('')
    let createdId = ''
    let phase: 'build' | 'approve' = 'build'
    const safeDone = async () => {
      try {
        if (onDone) await onDone()
      } catch {
        // Liste tazeleme hatası satışı etkilemez.
      }
    }
    try {
      // 1) Adisyonu aç + taksit planını yaz (peşin = 0). Onayda cariye taksitli işlenir.
      const adisyon = await adminApi.createAdisyon<ApiAdisyon>(
        {
          customerId: cid,
          customerAccountId: null,
          notes: notes.trim() || null,
          installmentCount: isInstallment ? installmentCount : 0,
          firstDueDate: isInstallment ? firstDueDate : null,
          // Geçmişe dönük satış tarihi (ürün satışı). Günün ortasına sabitlenir: saat dilimi
          // kayması yüzünden tarih bir gün öne/arkaya geçmesin.
          saleDateUtc: isProductSale && saleDate ? new Date(`${saleDate}T12:00:00`).toISOString() : null,
          // Her satış KENDİ adisyonunu açar (mevcut açık fişe/cariye eklenmez).
          forceNew: true,
          autoApproveOnFirstAppointment: willDefer,
        },
        tenantId,
        // `forceNew` her çağrıda YENİ fiş açar — sunucudaki "açık fiş varsa onu döndür" koruması
        // burada devrede değildir, dolayısıyla çift gönderim iki satış fişi üretirdi.
        idempotencyKey(saleSaltRef.current, 'create', cid, isInstallment ? installmentCount : 0, firstDueDate, saleDate),
      )
      if (!adisyon?.id) throw new Error('Adisyon açılamadı')
      createdId = adisyon.id
      // Ana kalemin kimliği (üç daldan hangisi seçiliyse) — idempotency anahtarında kullanılır.
      const mainRefId = isProductSale ? selectedProduct!.id : isServiceSale ? selectedService!.id : selectedPackage!.id

      // 2) Ana satış kalemi — onayda cariye borç (+ paket/hizmetse seans bakiyesi, üründe stok).
      await adminApi.addAdisyonItem(
        createdId,
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
        idempotencyKey(saleSaltRef.current, 'main', mainRefId, qty, unitPrice, staffMemberId),
      )

      // 2b) Ek kalemler — ana satışla aynı fişe, aynı kurallarla yazılır.
      for (const [i, e] of extras.entries()) {
        await adminApi.addAdisyonItem(
          createdId,
          {
            type: e.kind === 'product' ? 'Product' : e.kind === 'package' ? 'PackageSale' : 'Service',
            refId: e.refId,
            description: e.kind === 'package' ? `Paket satışı: ${e.name}` : e.name,
            quantity: e.quantity,
            unitPrice: e.unitPrice,
            staffMemberId: e.staffMemberId || staffMemberId || null,
            coveredByPackage: false,
          },
          tenantId,
          // SIRA NUMARASI ŞART: aynı hizmet iki ayrı ek kalem olarak eklenebilir (meşru) ve
          // yalnız içerikten türeyen anahtar ikisini aynı kabul edip birini yutardı. Tekrar
          // denemede `extras` değişmediği için indeks kararlıdır.
          idempotencyKey(saleSaltRef.current, 'extra', i, e.kind, e.refId, e.quantity, e.unitPrice),
        )
      }

      /*
       * 3) Peşinat alındıysa tahsilat kalemi — onayda cariye ödeme + kasaya gelir.
       *
       * TEKRAR DENEMEDE PEŞİNAT EKLENMEZ, DEĞİŞTİRİLİR.
       *
       * Anahtara yöntem de giriyor (aşağıdaki gerekçe): kullanıcı 200 ₺ NAKİT peşinatı
       * yazdıktan sonra onay adımı düşerse ve yöntemi KARTA çevirip tekrar denerse, anahtar
       * değiştiği için sunucu bunu yeni bir istek sayar ve `addAdisyonItem` fişe İKİNCİ bir
       * peşinat kalemi ekler: 200 ₺ yerine 400 ₺. Ekleme uçtur, güncelleme değil — bu yüzden
       * daha önce YAZDIĞIMIZ kalemi biz silmeliyiz. Aynısı tutar değişince de geçerlidir.
       */
      const writtenDeposit = depositRef.current
      if (writtenDeposit && (writtenDeposit.amount !== pay || writtenDeposit.method !== downPaymentMethod)) {
        // Silme başarısız olursa (ağ) çift kalem riski sürer; o yüzden hata YUTULMAZ.
        await adminApi.removeAdisyonItem(createdId, writtenDeposit.itemId, tenantId)
        depositRef.current = null
      }
      // Aynı tutar + aynı yöntem zaten yazıldıysa hiç dokunma: sunucudaki oynatma da aynı
      // sonucu verirdi ama gereksiz bir yazma isteği atmanın faydası yok.
      if (pay > 0 && depositRef.current === null) {
        const afterDeposit = await adminApi.addAdisyonItem<ApiAdisyon>(
          createdId,
          {
            type: 'Payment',
            refId: null,
            description: extras.length > 0
              ? 'Satış peşinatı'
              : isProductSale
                ? `Ürün peşinatı: ${selectedProduct!.name}`
                : isServiceSale
                  ? `Peşinat: ${selectedService!.name}`
                  : `Paket peşinatı: ${selectedPackage!.name}`,
            quantity: 1,
            unitPrice: pay,
            staffMemberId: null,
            coveredByPackage: false,
            // Onayda yöntem başına ayrı AccountPayment açılır (AdisyonService); gönderilmezse
            // sunucu "cash" varsayar ve kartla alınan peşinat kasada nakit görünürdü.
            method: downPaymentMethod,
          },
          tenantId,
          // ANAHTARA YÖNTEM DE GİRER: kullanıcı yöntemi değiştirip tekrar denerse gövde
          // değişir; anahtar sabit kalsaydı sunucu ESKİ yanıtı oynatıp yanlış yöntemi yazardı.
          // (Eski kalemin silinmesi yukarıda yapılır — yoksa ikinci kalem eklenirdi.)
          idempotencyKey(saleSaltRef.current, 'pay', pay, downPaymentMethod),
        )
        // NE YAZDIĞIMIZI HATIRLA: tekrar denemede bu kalem silinip yenisi yazılacak.
        // Sunucu fişin tamamını döndürür; peşinat kalemi en son eklenen `Payment` satırıdır.
        const writtenId = (afterDeposit?.items ?? [])
          .filter((it) => String(it.type) === 'Payment')
          .at(-1)?.id
        depositRef.current = writtenId ? { itemId: writtenId, amount: pay, method: downPaymentMethod } : null
      }

      if (approveNow) {
        phase = 'approve'
        // PERSONELDE DE ÇAĞRILIR: onay kapısı isteği yakalayıp yöneticinin Onaylar sayfasına
        // düşürür (200 + pendingApproval döner, hata fırlatmaz). Eskiden istek hiç atılmadığı için
        // satış "onaya gitti" sanılıyor ama Onaylar sayfasında görünmüyordu.
        await adminApi.approveAdisyon(createdId, tenantId)
        setPendingApproval(isStaffUser)
        setDeferred(false)
      } else {
        setPendingApproval(false)
        setDeferred(true)
      }
      // Adisyon kartı AÇILMAZ (kullanıcı talebi: süreç uzuyordu). Fiş açık kaldıysa (erteleme ya da
      // personelin onay bekleyen isteği) done ekranında isteğe bağlı "Adisyon kartını aç" düğmesi var.
      await safeDone()
      // SATIŞ BİTTİ → TUZ BURADA DÖNER, `reset()`'e GÜVENİLEMEZ. `reset()` yalnız
      // `onOpenChange` üzerinden çağrılır; başarı yolundaki `finishAndClose`/`openSavedCard`
      // ise `setOpen(false)`'u DOĞRUDAN çağırır ve onOpenChange tetiklenmez. Tuz dönmeseydi
      // aynı müşteriye birebir aynı satışı tekrar yapmak (meşru) ilk satışın yanıtı olarak
      // oynatılır, kullanıcı "başarılı" görür ama HİÇBİR ŞEY yazılmazdı.
      clearPersistentIdempotencySalt(SALE_SALT_SCOPE)
      saleSaltRef.current = newIdempotencySalt()
      depositRef.current = null
      setStep('done')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Satış kaydedilemedi'
      if (phase === 'approve') {
        // FİŞ EKSİKSİZ — SİLİNMEZ. Yalnız onay adımı düştü; kullanıcı adisyon kartından tekrar
        // onaylayabilir. Buradan silmek girilen bütün kalemleri sebepsiz yok ederdi.
        setSavedAdisyonId(createdId)
        setError(`Satış kaydedildi ancak cariye işlenemedi: ${msg} — adisyon kartından tekrar onaylayabilirsiniz.`)
        await safeDone()
      } else {
        // YARIM FİŞ BIRAKILMAZ: kalemleri eksik kalmış açık adisyon Ön Muhasebe'de gerçek bir satış
        // gibi durur, hizmet/paket fişiyse ilk randevuda otomatik cariye işlenirdi. İptal edilen fiş
        // hiçbir sorguya (açık adisyon / bekleyen satış) girmez.
        if (createdId) {
          const cancelled = await adminApi.cancelAdisyon(createdId, tenantId).then(() => true).catch(() => false)
          // TUZ YALNIZ İPTAL BAŞARILIYSA DÖNER. Fiş gerçekten iptal edildiyse ölüdür; aynı
          // anahtarla tekrar denemek fiş açma isteğini oynatıp ÖLÜ fişin id'sini döndürür ve
          // kalemler iptal edilmiş fişe yazılmaya çalışılır. İptal de patladıysa (ağ kesik) fiş
          // ortadadır: aynı anahtarla devam edip onu tamamlamak doğrudur.
          if (cancelled) {
            clearPersistentIdempotencySalt(SALE_SALT_SCOPE)
            saleSaltRef.current = newIdempotencySalt()
            // Fiş öldü; üstündeki peşinat kalemi de yok. Referans taşınırsa sonraki denemede
            // var olmayan bir kalemi silmeye çalışırdık.
            depositRef.current = null
          }
        }
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  const finishAndClose = () => {
    const cid = presetCustomer?.id || customerId
    setOpen(false)
    // stayOnPage: randevu modalı gibi akış içinden satışta yönlendirme yapılmaz.
    if (!stayOnPage && cid) router.push(`/panel/musteriler?customer=${cid}&sale=1`)
  }

  const openSavedCard = () => {
    const cid = presetCustomer?.id || customerId
    setOpen(false)
    setCardCustomer({ id: cid, name: presetCustomer?.name || customerName || '' })
  }

  const TriggerIcon = isProductSale ? Box : isServiceSale ? ShoppingBag : Package
  const title = isProductSale ? 'Ürün Satışı' : isServiceSale ? 'Hizmet Satışı' : 'Paket Satışı'
  const extraKinds: ExtraKind[] = canProducts ? ['service', 'package', 'product'] : ['service', 'package']
  const extraPickerItems = extraKind === 'service' ? servicePickerItems : extraKind === 'package' ? packagePickerItems : productPickerItems
  const extraUnitPreview = extraKind && extraRefId
    ? (extraPrice === '' ? extraBasePrice(extraKind, extraRefId) : Number(extraPrice)) * Math.max(1, Number(extraQty) || 1)
    : 0

  return (
    <>
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
            'inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[#8C4460]/40 bg-[#F6DFE6] px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-[#8C4460] transition-colors hover:bg-[#F6DFE6]'
          }
        >
          <TriggerIcon className="h-3.5 w-3.5" /> {triggerLabel || title}
        </button>
      </DialogTrigger>

      <DialogContent
        className="flex flex-col overflow-hidden rounded-[28px] border border-[#EAD8DF]/[0.90] bg-white/[0.96] !p-0 text-[#2A2027] shadow-[0_34px_120px_-58px_rgba(120,71,88,0.72)] backdrop-blur-2xl sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(94vw, 780px)', maxWidth: 'min(94vw, 780px)', maxHeight: '94dvh' }}
      >
        <div className="relative flex min-h-0 max-h-[94dvh] flex-col overflow-hidden bg-gradient-to-br from-white via-[#fff7fa] to-[#fff0f5]">
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
          <header className="relative shrink-0 border-b border-[#EAD8DF]/[0.70] px-6 py-4 pr-12 sm:px-7">
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-start gap-3.5"
            >
              <motion.span
                whileHover={{ rotate: -8, scale: 1.06 }}
                transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#BE7690]/[0.80] bg-white text-[#A5556E] shadow-[0_14px_34px_-24px_rgba(200,87,118,0.8)]"
              >
                {step === 'confirm' ? <ShieldCheck className="h-4 w-4" strokeWidth={1.6} /> : <TriggerIcon className="h-4 w-4" strokeWidth={1.6} />}
              </motion.span>
              <div className="min-w-0 flex-1">
                <div className="text-[9px] font-mono uppercase tracking-[0.26em] text-[#A5556E]/75">
                  {step === 'confirm' ? 'Adisyon API · onay' : step === 'done' ? 'Adisyon · tamamlandı' : 'Adisyon API · POST'}
                </div>
                <DialogTitle className="mt-0.5 font-display text-2xl font-normal tracking-tight text-[#2A2027]">
                  {step === 'confirm' ? 'Satışı onayla' : title}
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-[11px] text-[#5A4B53]">
                  {step === 'confirm'
                    ? 'Ek hizmet, paket veya ürün ekleyebilirsiniz. Kaydedince adisyon kartı açılmaz.'
                    : `Satış adisyona düşer; peşinat alındıysa kaydedince cariye işlenir${isProductSale ? ' ve stoktan düşer.' : isServiceSale ? '.' : ' + seans bakiyesi tanımlanır.'}`}
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
                className={`mx-auto grid h-14 w-14 place-items-center rounded-full ${deferred ? 'bg-sky-50 text-sky-600' : pendingApproval ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}
              >
                {deferred ? <CalendarDays className="h-8 w-8" /> : pendingApproval ? <ReceiptText className="h-8 w-8" /> : <CheckCircle2 className="h-8 w-8" />}
              </motion.span>
              <h4 className="mt-4 font-display text-xl tracking-tight text-[#2A2027]">
                {deferred
                  ? 'Satış kaydedildi · ilk randevuda işlenecek'
                  : pendingApproval
                    ? 'Satış oluşturuldu · onay bekliyor'
                    : 'Satış tamamlandı · cariye işlendi'}
              </h4>
              <p className="mx-auto mt-1.5 max-w-sm text-[12px] text-[#5A4B53]">
                {deferred ? (
                  <>
                    Peşinat alınmadığı için tutar cariye <strong className="font-semibold text-[#3E343A]">şimdi işlenmedi</strong>.
                    Müşteri ilk randevusunu tamamladığında otomatik olarak cariye işlenip
                    {isServiceSale ? ' hizmet seansı' : ' paket seansları'} tanımlanacak — randevu şimdiden verilebilir.
                  </>
                ) : pendingApproval ? (
                  <>
                    Onay isteği kurum yöneticisinin Onaylar sayfasına düştü. Onaylandığında tutar cariye işlenecek
                    {hasProductItem ? ', ürünler stoktan düşecek' : ''}
                    {hasSessionItem ? ' ve satılan hizmet/paket seansları tanımlanacak.' : '.'}
                    {canDefer ? ' Yönetici onaylamadan müşteri ilk randevusunu tamamlarsa satış o an otomatik işlenir.' : ''}
                  </>
                ) : (
                  <>
                    Tutar cariye borç olarak yazıldı
                    {pay > 0 ? ', peşinat kasaya gelir düştü' : ''}
                    {hasProductItem ? ', ürünler stoktan düşüldü' : ''}
                    {hasSessionItem ? '. Satılan hizmet/paket seansları tanımlandı — randevu vermeye hazır.' : '.'}
                  </>
                )}
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={finishAndClose}
                  className="rounded-[12px] bg-[#A5556E] px-6 py-2.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
                >
                  {stayOnPage ? 'Tamam' : 'Müşteri kartına git'}
                </button>
                {/* Fiş HÂLÂ AÇIKSA (erteleme ya da personelin bekleyen onayı) kart isteğe bağlı
                    açılır — akışı uzatmaz, isteyen tıklar. Onaylanmış satışta kart açmak yanıltıcı
                    olurdu: kartta yalnız AÇIK adisyon görünür, bu fiş orada olmaz. */}
                {(deferred || pendingApproval) && (
                  <button
                    type="button"
                    onClick={openSavedCard}
                    className="inline-flex items-center gap-1.5 rounded-[12px] border border-[#EAD8DF] bg-white px-4 py-2.5 text-[12px] font-medium text-[#74616A] transition-colors hover:border-[#BE7690] hover:text-[#A5556E]"
                  >
                    <ReceiptText className="h-4 w-4" /> Adisyon kartını aç
                  </button>
                )}
              </div>
            </div>
          ) : step === 'confirm' ? (
            /* ONAY ÖNİZLEME */
            <div className="relative min-h-0 flex-auto space-y-3 overflow-y-auto px-6 py-5 sm:px-7">
              {error && (
                <div className="rounded-[12px] border border-rose-300/40 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>
              )}

              {/* Onam formu bilgisi — satışı engellemez, personeli baştan haberdar eder. */}
              <ConsentSaleNotice
                packageId={isServiceSale || isProductSale ? null : packageId}
                serviceId={isServiceSale ? selectedService?.id : null}
                tenantId={tenantId}
              />

              <div className="rounded-[16px] border border-[#EAD8DF] bg-white/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-[#A5556E]/70">
                      {isProductSale ? 'Ürün' : isServiceSale ? 'Hizmet' : 'Paket'}
                    </div>
                    <div className="mt-0.5 truncate font-display text-lg tracking-tight text-[#2A2027]">{soldName}</div>
                    <div className="mt-0.5 text-[11px] text-[#5A4B53]">
                      {presetCustomer?.name || customerName || 'Müşteri'} · {qty > 1 ? `${qty} adet · ` : ''}birim {formatTL(unitPrice)}
                    </div>
                    {/* Geçmişe dönük satışta tarih onayda da görünsün — yanlış tarih fark edilsin. */}
                    {isProductSale && saleDate && (
                      <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-[#EAD8DF] bg-[#F7F6F6] px-2 py-0.5 text-[10.5px] text-[#74616A]">
                        <CalendarDays className="h-3 w-3 text-[#A5556E]" />
                        Satış tarihi: {new Date(`${saleDate}T12:00:00`).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' })}
                      </div>
                    )}
                  </div>
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-[#A5556E] text-white">
                    {isProductSale ? <Box className="h-5 w-5" /> : isServiceSale ? <Sparkles className="h-5 w-5" /> : <Package className="h-5 w-5" />}
                  </span>
                </div>

                {!isProductSale && !isServiceSale && selectedPackage && selectedPackage.items.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[#f1e5ea] pt-3">
                    {selectedPackage.items.map((it, i) => (
                      <span key={i} className="rounded-md border border-[#EAD8DF] bg-[#F7F6F6] px-2 py-1 text-[10.5px] text-[#8C4460]">
                        {it.serviceName} × {it.sessionCount} seans
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* SADAKAT PUANI — ek kalem eklerken "puanla neyi hediye edebilirim" sorusu. */}
              {loyaltyPoints !== null && loyaltyPoints > 0 && (
                <div className="rounded-[16px] border border-[#e0d3f2] bg-[#faf6ff] p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#6b4aa0]">
                      <Star className="h-3.5 w-3.5" /> Sadakat puanı
                    </span>
                    <span className="font-display text-[17px] font-bold tabular-nums text-[#6b4aa0]">
                      {loyaltyPoints.toLocaleString('tr-TR')} P
                    </span>
                  </div>

                  {giftableWithPoints.services.length === 0 && giftableWithPoints.packages.length === 0 ? (
                    <p className="mt-1.5 text-[11px] leading-snug text-[#5A4B53]">
                      Bu puanla hediye edilebilecek bir hizmet/paket yok. (Katalogda &quot;sadakat puanı&quot; tanımlı kayıtlar gerekir.)
                    </p>
                  ) : (
                    <>
                      <p className="mt-1.5 text-[11px] leading-snug text-[#5A4B53]">
                        Bu puanla hediye edilebilecekler — ek kalem olarak ekleyip adisyonda hediye işaretleyin:
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {giftableWithPoints.services.map((x) => (
                          <span
                            key={`gs-${x.id}`}
                            className="inline-flex items-center gap-1.5 rounded-full border border-[#d9c8ef] bg-white px-2.5 py-1 text-[10.5px] font-semibold text-[#4a3a44]"
                          >
                            <Sparkles className="h-3 w-3 text-[#6b4aa0]" /> {x.name}
                            <span className="text-[#6b4aa0]">{x.loyaltyPointCost} P</span>
                          </span>
                        ))}
                        {giftableWithPoints.packages.map((x) => (
                          <span
                            key={`gp-${x.id}`}
                            className="inline-flex items-center gap-1.5 rounded-full border border-[#d9c8ef] bg-white px-2.5 py-1 text-[10.5px] font-semibold text-[#4a3a44]"
                          >
                            <Boxes className="h-3 w-3 text-[#6b4aa0]" /> {x.name}
                            <span className="text-[#6b4aa0]">{x.loyaltyPointCost} P</span>
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ---------- EK KALEMLER (adisyon kartındaki "Kalem ekle" ile aynı mantık) ---------- */}
              <div className="rounded-[16px] border border-[#f0e0e6] bg-[#F7F6F6] p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#8C4460]">
                    <Plus className="h-3.5 w-3.5" /> Ek kalem
                    {extras.length > 0 && (
                      <span className="rounded-full bg-[#F6DFE6] px-2 py-0.5 text-[10px] font-semibold text-[#8C4460]">{extras.length}</span>
                    )}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {extraKinds.map((k) => {
                      const Icon = extraKindIcons[k]
                      const on = extraKind === k
                      return (
                        <button
                          key={k}
                          type="button"
                          disabled={busy || !!savedAdisyonId}
                          onClick={() => {
                            if (on) return clearExtraForm()
                            setExtraKind(k)
                            setExtraRefId('')
                            setExtraPrice('')
                            setExtraQty(1)
                            setExtraStaffId(staffMemberId)
                            setExtraError('')
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10.5px] font-semibold transition-colors disabled:opacity-40 ${
                            on ? extraKindTones[k] : 'border-[#EAD8DF] bg-white text-[#74616A] hover:bg-[#F7F6F6]'
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" /> {extraKindLabels[k]}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <AnimatePresence initial={false}>
                  {extraKind && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 space-y-2.5 rounded-[13px] border border-[#EAD8DF] bg-white p-3">
                        {extraError && (
                          <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11.5px] text-rose-700">{extraError}</div>
                        )}
                        <div>
                          <div className={labelCls}>{extraKindLabels[extraKind]} seç</div>
                          <CatalogPicker
                            items={extraPickerItems}
                            value={extraRefId}
                            onChange={(id) => { setExtraRefId(id); setExtraPrice(''); setExtraError('') }}
                            accent={extraKind === 'product' ? 'violet' : 'rose'}
                            emptyText={`${extraKindLabels[extraKind]} bulunamadı.`}
                            clearable
                            categoryOrder={extraKind === 'product' ? undefined : categoryOrder}
                          />
                        </div>
                        <div className="grid gap-2.5 sm:grid-cols-3">
                          <label className={labelCls}>
                            Birim fiyat
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={extraPrice === '' ? (extraRefId ? extraBasePrice(extraKind, extraRefId) || '' : '') : extraPrice}
                              onChange={(e) => setExtraPrice(e.target.value === '' ? '' : Number(e.target.value))}
                              className={inputCls}
                            />
                          </label>
                          <label className={labelCls}>
                            Adet
                            <input
                              type="number"
                              min={1}
                              step={1}
                              value={extraQty}
                              onChange={(e) => setExtraQty(Math.max(1, Number(e.target.value) || 1))}
                              className={inputCls}
                            />
                          </label>
                          <label className={labelCls}>
                            Satışı yapan (ops.)
                            <select value={extraStaffId} onChange={(e) => setExtraStaffId(e.target.value)} className={inputCls}>
                              <option value="">Seçilmedi</option>
                              {staff.map((s) => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={clearExtraForm}
                            className="inline-flex items-center gap-1.5 rounded-[11px] border border-[#EAD8DF] bg-white px-3 py-2 text-[11.5px] font-medium text-[#74616A] transition-colors hover:border-[#BE7690] hover:text-[#A5556E]"
                          >
                            <X className="h-3.5 w-3.5" /> Vazgeç
                          </button>
                          <button
                            type="button"
                            onClick={addExtra}
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-[11px] border border-[#8C4460]/45 bg-[#F6DFE6] px-3 py-2 text-[11.5px] font-semibold text-[#8C4460] transition-colors hover:bg-[#F6DFE6]"
                          >
                            <Plus className="h-3.5 w-3.5" /> Satışa ekle
                            {extraUnitPreview > 0 && (
                              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] tabular-nums text-[#3E343A]">{formatTL(extraUnitPreview)}</span>
                            )}
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {extras.length > 0 && (
                  <div className="mt-3 overflow-hidden rounded-[13px] border border-[#f0e0e6] bg-white">
                    {extras.map((e, idx) => {
                      const Icon = extraKindIcons[e.kind]
                      return (
                        <div key={e.key} className={`flex items-center gap-2.5 px-3 py-2.5 ${idx > 0 ? 'border-t border-[#f6ebef]' : ''}`}>
                          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[9px] border ${extraKindTones[e.kind]}`}>
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] font-medium text-[#2A2027]">{e.name}</span>
                            <span className="block truncate text-[10px] text-[#74616A]">
                              {extraKindLabels[e.kind]}
                              {e.quantity > 1 ? ` · ${e.quantity} × ${formatTL(e.unitPrice)}` : ''}
                              {e.staffMemberId ? ` · ${staff.find((s) => s.id === e.staffMemberId)?.name || ''}` : ''}
                            </span>
                          </span>
                          <span className="shrink-0 font-display text-[14px] tabular-nums text-[#2A2027]">
                            {formatTL(Math.round(e.unitPrice * e.quantity * 100) / 100)}
                          </span>
                          <button
                            type="button"
                            disabled={busy || !!savedAdisyonId}
                            onClick={() => removeExtra(e.key)}
                            className="shrink-0 rounded-md p-1 text-[#74616A] transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                            aria-label="Ek kalemi kaldır"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2">
                <div className="rounded-[14px] border border-[#EAD8DF] bg-white px-3.5 py-3">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[#74616A]">Adisyona yazılacak</div>
                  <div className="mt-1 font-display text-xl tabular-nums text-[#2A2027]">Borç {formatTL(total)}</div>
                  {extrasTotal > 0 && (
                    <div className="text-[11px] text-[#74616A]">
                      Satış {formatTL(mainTotal)} + ek kalem {formatTL(extrasTotal)}
                    </div>
                  )}
                  {/* Yöntem ONAY EKRANINDA da yazılır: kasaya hangi kanaldan girdiği
                      onaylamadan önce görünmeli (sonradan düzeltmesi tahsilat düzeltmesi). */}
                  {pay > 0 && (
                    <div className="text-[11px] text-emerald-700">
                      Tahsilat {formatTL(pay)} · {DOWN_PAYMENT_METHODS.find((m) => m.value === downPaymentMethod)?.label}
                    </div>
                  )}
                </div>
                <div className="rounded-[14px] border border-[#EAD8DF] bg-white px-3.5 py-3">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[#74616A]">Ödeme planı</div>
                  <div className="mt-1 font-display text-xl tracking-tight text-[#2A2027]">
                    {isInstallment ? `${installmentCount}× taksit` : 'Peşin'}
                  </div>
                  {isInstallment && perInstallment > 0 && (
                    <div className="text-[11px] text-[#8C4460]">{formatTL(perInstallment)} / ay · ilk {new Date(firstDueDate).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })}</div>
                  )}
                </div>
              </div>

              {/* TAHSİLAT HATIRLATMASI: peşinat girilmemiş satış cariye ŞİMDİ işlenmez. Alan artık
                  formda hep görünür olduğu için "alan açıldı" uyarısına gerek kalmadı; burada
                  yalnız geri dönüp tahsilat girme yolu gösterilir. */}
              {pay === 0 && canDefer && (
                <div className="flex items-start gap-2 rounded-[12px] border border-[#EAD8DF] bg-[#F7F6F6] px-3.5 py-2.5 text-[11.5px] leading-snug text-[#8C4460]">
                  <Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                  <span>
                    Tahsilat alacaksanız <strong className="font-semibold">Düzenle</strong>’ye dönüp peşinat girin —
                    peşinat girilen satış kaydedilir kaydedilmez cariye işlenir.
                  </span>
                </div>
              )}

              {/* ---------- KAYDEDİNCE NE OLACAK — sorulmaz, tahsilattan türetilir ---------- */}
              {approveNow ? (
                <div className="flex items-start gap-2 rounded-[12px] border border-emerald-200/60 bg-emerald-50/60 px-3.5 py-2.5 text-[11.5px] leading-snug text-emerald-800">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
                  <span>
                    {isStaffUser ? (
                      <>
                        <strong className="font-semibold">Kaydedince onay isteği yöneticinize gider.</strong> Onaylandığında
                        tutar cariye borç yazılır{pay > 0 ? ', peşinat kasaya girer' : ''}
                        {hasProductItem ? ', ürünler stoktan düşer' : ''}
                        {hasSessionItem ? ' ve seanslar tanımlanır.' : '.'}
                      </>
                    ) : (
                      <>
                        {pay > 0 ? 'Peşinat alındığı için ' : 'Fişte ürün olduğu için '}
                        <strong className="font-semibold">satış kaydedilir kaydedilmez cariye işlenir</strong>: tutar borç
                        {pay > 0 ? ', peşinat kasaya gelir' : ''}
                        {hasProductItem ? ', ürünler stoktan düşer' : ''}
                        {hasSessionItem ? ' ve seanslar tanımlanır.' : '.'} Adisyon kartı açılmaz.
                      </>
                    )}
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-[12px] border border-sky-200/70 bg-sky-50/70 px-3.5 py-2.5 text-[11.5px] leading-snug text-sky-800">
                  <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
                  <span>
                    Peşinat alınmadı — satış cariye <strong className="font-semibold">şimdi işlenmez</strong>. Müşteri ilk
                    randevusunu tamamladığında tutar otomatik cariye borç yazılır ve
                    {isServiceSale ? ' hizmet seansı' : ' paket seansları'} tanımlanır. Seansları kullanmak için randevu
                    şimdiden verilebilir; adisyon kartı açılmaz.
                  </span>
                </div>
              )}
            </div>
          ) : (
            /* FORM */
            <div className="relative min-h-0 flex-auto space-y-3.5 overflow-y-auto px-6 py-5 sm:px-7">
              {error && (
                <div className="rounded-[12px] border border-rose-300/40 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</div>
              )}

              {/* Müşteri */}
              {presetCustomer ? (
                <div className="flex items-center gap-2.5 rounded-[14px] border border-[#EAD8DF] bg-white px-3 py-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-[#F6DFE6] font-display text-[13px] text-[#A5556E]">
                    {presetCustomer.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-[#74616A]">Müşteri</div>
                    <div className="text-[13.5px] font-medium text-[#2A2027]">{presetCustomer.name}</div>
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
                    onSelectItem={(it) => { setCustomerId(it.id); setCustomerName(it.name) }}
                    className={inputCls}
                  />
                </label>
              )}

              <ConsultationWarningBanner customerId={presetCustomer?.id || customerId} tenantId={tenantId} />

              {/* HEDİYE ÇEKİ ŞERİDİ — otomatik seçim sessiz kalmaz. */}
              {giftCards.length > 0 && (
                <div className="rounded-[14px] border border-[#EFC98B] bg-[#FDF3E2] px-3.5 py-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#8A5A11]">
                    <Gift className="h-3.5 w-3.5" /> Bu müşterinin hediye çeki var
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {giftCards.map((g) => (
                      <li key={g.id} className="text-[11.5px] leading-snug text-[#6b4a12]">
                        <b className="font-semibold">{g.code}</b>
                        {g.scopeLabel ? ` · ${g.scopeLabel}` : ''}
                        {g.kind === 'Percentage'
                          ? ` · %${g.value} indirim`
                          : g.kind === 'StoredValue'
                            ? ` · ${formatTL(Math.round(g.balance))} bakiye`
                            : ` · ${formatTL(Math.round(g.value))} indirim`}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-[10.5px] leading-snug text-[#8A5A11]">
                    {autoGift
                      ? 'Çeke bağlı kalem aşağıda seçildi. '
                      : ''}
                    İndirim, satıştan sonra <b>adisyonda</b> kart kodu girilerek uygulanır.
                  </p>
                </div>
              )}

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
                          <div className="text-[13.5px] font-medium text-[#2A2027]">{selectedProduct.name}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-display text-[15px] tabular-nums text-violet-700">{formatTL(selectedProduct.salePrice)}</div>
                        <div className={`text-[10px] ${selectedProduct.isCritical ? 'text-amber-700' : 'text-[#74616A]'}`}>
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
                  <div className="flex items-center justify-between gap-2.5 rounded-[14px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-white text-[#A5556E]">
                        <Sparkles className="h-4 w-4" />
                      </span>
                      <div>
                        <div className="text-[10px] font-mono uppercase tracking-widest text-[#8C4460]/70">Hizmet</div>
                        <div className="text-[13.5px] font-medium text-[#2A2027]">{presetService.name}</div>
                      </div>
                    </div>
                    <div className="font-display text-[15px] tabular-nums text-[#8C4460]">{formatTL(Number(presetService.price || 0))}</div>
                  </div>
                ) : (
                  <div>
                    <div className={labelCls}>Hizmet</div>
                    <CatalogPicker items={servicePickerItems} value={serviceId} onChange={(id) => { setServiceId(id); setPrice('') }} accent="rose" emptyText="Hizmet bulunamadı." categoryOrder={categoryOrder} />
                  </div>
                )
              ) : (
                <>
                  <div>
                    <div className={labelCls}>Paket</div>
                    <CatalogPicker items={packagePickerItems} value={packageId} onChange={(id) => { setPackageId(id); setPrice('') }} accent="rose" emptyText="Paket bulunamadı." categoryOrder={categoryOrder} />
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
                {/* Görünürlük kuralı ve gerekçesi için bkz. showDownPayment. */}
                {showDownPayment && (
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
                )}
                {/* YÖNTEM YALNIZ PEŞİNAT VARSA sorulur: para alınmadan "nakit mi kart mı"
                    sormak boş bir karar; alan da her satışta yer kaplardı. */}
                {showDownPayment && pay > 0 && (
                  <label className={labelCls}>
                    Peşinat ödeme yöntemi
                    <select
                      value={downPaymentMethod}
                      onChange={(e) => setDownPaymentMethod(e.target.value)}
                      className={inputCls}
                    >
                      {DOWN_PAYMENT_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              {showDownPayment && pay > 0 && (
                <p className="mt-1 text-[10.5px] text-[#74616A]">
                  Peşinat <b>{DOWN_PAYMENT_METHODS.find((m) => m.value === downPaymentMethod)?.label}</b> olarak
                  kasaya işlenir; gün sonu kasa kapanışındaki yöntem kırılımı buna göre oluşur.
                </p>
              )}

              {/* Ödeme planı: peşin ya da taksit — taksit cariye onayda kurulur */}
              <div className="rounded-[14px] border border-[#EAD8DF] bg-[#F7F6F6] p-3">
                {/* SATIŞ TARİHİ — yalnız üründe. Hizmet/paket satışı ertelenebildiği için orada
                    kullanıcının verdiği tarih anlamını yitirir. */}
                {isProductSale && (
                  <div className="mb-4">
                    <div className="mb-2 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#A5556E]/75">
                      <CalendarDays className="h-3.5 w-3.5" /> Satış tarihi
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-center">
                      <input
                        type="date"
                        value={saleDate}
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setSaleDate(e.target.value)}
                        className={inputCls}
                      />
                      <span className="text-[11px] leading-snug text-[#74616A]">
                        Geçmişe dönük satış girebilirsin. Cari kaydı ve peşinat tahsilatı bu tarihe yazılır.
                      </span>
                    </div>
                  </div>
                )}

                <div className="mb-2 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#A5556E]/75">
                  <Wallet className="h-3.5 w-3.5" /> Ödeme planı
                </div>
                <div className="inline-flex rounded-[10px] border border-[#EAD8DF] bg-white p-1">
                  {([['pesin', 'Peşin'], ['taksit', 'Taksit']] as const).map(([k, l]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setPayMode(k)}
                      className={`rounded-[8px] px-5 py-1.5 text-[11px] font-medium transition-colors ${payMode === k ? 'bg-[#A5556E] text-white shadow-sm' : 'text-[#5A4B53] hover:bg-[#F7F6F6]'}`}
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
                      <div className="flex items-center gap-1.5 rounded-[10px] border border-[#BE7690]/50 bg-[#F6DFE6]/60 px-3 py-2 text-[11px] text-[#8C4460] sm:col-span-2">
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

              <div className="flex items-center justify-between rounded-[14px] border border-[#EAD8DF] bg-white px-3.5 py-2.5">
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[#5A4B53]">
                  <ReceiptText className="h-3.5 w-3.5 text-[#A5556E]" /> Adisyona yazılacak
                </span>
                <span className="font-display text-[15px] tabular-nums text-[#2A2027]">
                  Borç {formatTL(total)}
                  {pay > 0 && (
                    <span className="text-emerald-700"> · Tahsilat {formatTL(pay)}</span>
                  )}
                  {isInstallment && (
                    <span className="text-[#8C4460]"> · {installmentCount}× taksit</span>
                  )}
                </span>
              </div>
            </div>
          )}

          {/* FOOTER */}
          {step === 'form' && (
            <footer className="relative shrink-0 border-t border-[#EAD8DF]/[0.70] px-6 py-4 sm:px-7">
              <button
                type="button"
                onClick={goToConfirm}
                className="group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-[14px] bg-[#A5556E] px-4 py-2.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
              >
                <ShieldCheck className="h-4 w-4" />
                Satışı incele ve onayla
              </button>
            </footer>
          )}
          {step === 'confirm' && (
            <footer className="relative flex shrink-0 items-center gap-2.5 border-t border-[#EAD8DF]/[0.70] px-6 py-4 sm:px-7">
              {savedAdisyonId ? (
                // Onay düştü ama fiş yazıldı: tek çıkış yolu kartı açmaktır (tekrar kaydetmek
                // aynı satışı ikinci kez yazardı).
                <button
                  type="button"
                  onClick={openSavedCard}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-[14px] bg-[#A5556E] px-4 py-2.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
                >
                  <ReceiptText className="h-4 w-4" /> Adisyon kartını aç
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => { setError(''); clearExtraForm(); setStep('form') }}
                    className="inline-flex items-center gap-1.5 rounded-[14px] border border-[#EAD8DF] bg-white px-4 py-2.5 text-[12.5px] font-medium text-[#74616A] transition-colors hover:border-[#BE7690] hover:text-[#A5556E] disabled:opacity-50"
                  >
                    <ChevronLeft className="h-4 w-4" /> Düzenle
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={submitSale}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-[14px] bg-[#A5556E] px-4 py-2.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {busy
                      ? 'Kaydediliyor…'
                      : approveNow
                        ? (isStaffUser ? 'Satışı kaydet · onaya gönder' : 'Satışı kaydet · cariye işle')
                        : 'Satışı kaydet'}
                    <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] tabular-nums">{formatTL(total)}</span>
                  </button>
                </>
              )}
            </footer>
          )}
        </div>
      </DialogContent>
    </Dialog>

      {/* Satış sonrası açılan MÜŞTERİ adisyon kartı (Ön Muhasebe gibi açık adisyon) —
          günlük adisyon kartından farklı; burada ödeme/peşinat alınıp onaylanır. */}
      <AdisyonModal
        open={!!cardCustomer}
        onOpenChange={(o) => {
          if (!o) {
            setCardCustomer(null)
            if (onDone) void onDone()
          }
        }}
        customerId={cardCustomer?.id}
        customerName={cardCustomer?.name}
        tenantId={tenantId}
        onChanged={onDone}
      />
    </>
  )
}
