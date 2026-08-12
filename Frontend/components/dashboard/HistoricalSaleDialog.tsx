'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Archive, Banknote, CalendarClock, CalendarCheck, Check, CheckCircle2, CreditCard, Loader2, Package, Scissors,
  Sparkles, User, Wallet, X,
} from 'lucide-react'
import { formatTL } from '@/lib/apiMappers'
import ModalPortal from '@/components/dashboard/ModalPortal'
import CatalogPicker, { type PickerItem } from '@/components/dashboard/CatalogPicker'
import CustomerPicker, { customerSearchProvider, type CustomerPickerItem } from '@/components/dashboard/CustomerPicker'

/**
 * GEÇMİŞ SATIŞ girişi — yazılıma yeni geçen kurumlar, önceki yıllarda sattıkları paket/hizmetleri
 * buradan sisteme işler.
 *
 * ÖDEME GEÇMİŞİ DE KAYDEDİLİR: satış peşin mi yapıldı, taksitliyse kaç taksitti ve HANGİ AYLAR
 * ödendi — hepsi girilir. Ödenmiş her ay, kendi vade tarihiyle tahsilat olarak yazılır; böylece
 * geçmiş satış geçmiş cariye/tahsilat dökümüne de doğru tarihlerle düşer.
 *
 * Paket/hizmet seçimi satış modalindeki gibi kategori + alt kategori + aramalı `CatalogPicker` ile
 * yapılır (kataloğu 200 kalemi bulan kurumlarda düz select'te arama yoktu).
 */

/** Seçilebilir katalog kalemi — kategori bilgisi verilirse seçicide süzgeç pill'leri çıkar. */
export interface HistoricalCatalogOption {
  id: string
  name: string
  price: number
  cat?: string
  sub?: string
  meta?: string
  content?: string[]
}

export interface HistoricalSaleValues {
  /** Katalog tarafından açıldığında müşteri burada seçilir; müşteri kartından açılışta boş kalır. */
  customerId?: string
  name: string
  soldAt: string
  soldByStaffMemberId: string | null
  servicePackageId: string | null
  serviceDefinitionId: string | null
  totalAmount: number
  paidAmount: number
  sessionsTotal: number
  sessionsUsed: number
  installmentCount: number
  firstDueDate: string | null
  notes: string | null
  /** Taksitlerin kaçı ödenmiş (vade sırasıyla). Peşin satışta 0 gider. */
  paidInstallmentCount: number
  /** cash | card | transfer */
  paymentMethod: string
  /** Kullanılmış seansları uygulayan personel ("seansı kim yaptı"). */
  appliedByStaffMemberId: string | null
  /** true ise kullanılan seanslar için tamamlanmış geçmiş randevu kaydı da açılır. */
  createSessionAppointments: boolean
  /** Geçmiş randevular arasındaki gün aralığı. */
  sessionIntervalDays: number
  /**
   * SEANS SEANS detay — her seansın tarihi ve uygulayan personeli. Sıra = seans sırası.
   * Boş bırakılırsa (undefined) eski davranış: eşit aralıklı tarih + tek personel.
   */
  sessions?: { performedAtUtc: string | null; staffMemberId: string | null }[]
  /**
   * Seçilen personel satışın şubesinde çalışmıyorsa açık onay. Sunucu varsayılan olarak
   * reddeder; personel şube aktarımı gerçek olduğu için kullanıcı "o tarihte bu şubedeydi"
   * diyerek geçebilir (bkz. `AllowCrossBranchStaff`).
   */
  allowCrossBranchStaff: boolean
}

/** Seans detay satırının form hâli (tarih + personel; ikisi de opsiyonel). */
interface SessionDetailRow {
  date: string
  staffId: string
  /**
   * Tarihi KULLANICI mı yazdı, yoksa "satış günü + sıra × aralık" kuralı mı üretti?
   *
   * Ayrım şart: satış tarihi ya da seans aralığı sonradan değiştiğinde kuralın ürettiği
   * tarihler yeniden hesaplanmalı (yoksa kayıtta eski tarihe göre üretilmiş bayat satırlar
   * kalır), ama kullanıcının elle girdiği tarih ASLA ezilmemeli.
   */
  dateEdited: boolean
}

const FIELD = 'w-full rounded-[11px] border border-[#EAD8DF] bg-white px-3 py-2 text-[12.5px] text-[#2A2027] outline-none transition focus:border-[#ef9ab5] focus:ring-2 focus:ring-[#f4b6cb]/40 placeholder:text-[#74616A]'
const LABEL = 'mb-1 block text-[11.5px] font-semibold text-[#3E343A]'
const HINT = 'text-[10.5px] text-[#74616A]'
const CARD = 'rounded-[16px] border border-[#EAD8DF] bg-white p-3.5'

const METHODS: { value: string; label: string }[] = [
  { value: 'cash', label: 'Nakit' },
  { value: 'card', label: 'Kart' },
  { value: 'transfer', label: 'Havale/EFT' },
]
const MONTHS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

/** `2026-08-15` + n ay → "Ağu 2026" (etiket) ve ISO gün (gönderim). */
function addMonthsIso(iso: string, n: number): { label: string; day: string } {
  const [y, m, d] = iso.split('-').map(Number)
  const base = new Date(y, (m - 1) + n, d || 1)
  return {
    label: `${MONTHS_TR[base.getMonth()]} ${base.getFullYear()}`,
    day: `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`,
  }
}

/** Backend `RebuildInstallments` ile aynı bölme: eşit taksit, artan kuruş son takside. */
function splitInstallments(total: number, count: number): number[] {
  if (count <= 0 || total <= 0) return []
  const per = Math.round((total / count) * 100) / 100
  const drift = Math.round((total - per * count) * 100) / 100
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? per + drift : per))
}

export default function HistoricalSaleDialog({
  customerName,
  staffOptions,
  packageOptions,
  serviceOptions,
  busy = false,
  needsCustomer = false,
  tenantId,
  preset,
  onClose,
  onSubmit,
}: {
  customerName: string
  staffOptions: { id: string; name: string }[]
  packageOptions: HistoricalCatalogOption[]
  serviceOptions: HistoricalCatalogOption[]
  busy?: boolean
  /** Katalog (paket/hizmet) tarafından açıldığında müşteri bu modalda seçilir. */
  needsCustomer?: boolean
  /** Müşteri araması sunucuda yapılır — 12 bin+ kayıtta liste indirilmez. */
  tenantId?: string
  /** Katalog kartından açılışta satılan paket/hizmet peşin seçilir ve değiştirilmez. */
  preset?: { kind: 'package' | 'service'; id: string; name: string; price: number }
  onClose: () => void
  onSubmit: (values: HistoricalSaleValues) => Promise<void>
}) {
  // Katalogdan seçim: paket ya da tek hizmet. "Serbest" seçilirse ad elle yazılır
  // (kataloğa hiç girilmemiş eski paketler için).
  const [kind, setKind] = useState<'package' | 'service' | 'free'>(preset?.kind ?? 'package')
  const [packageId, setPackageId] = useState(preset?.kind === 'package' ? preset.id : '')
  const [serviceId, setServiceId] = useState(preset?.kind === 'service' ? preset.id : '')
  const [name, setName] = useState(preset?.name ?? '')
  const [customerId, setCustomerId] = useState('')
  const [customerLabel, setCustomerLabel] = useState('')
  const customerSearch = useMemo(() => customerSearchProvider(tenantId), [tenantId])
  const [soldAt, setSoldAt] = useState('')
  const [staffId, setStaffId] = useState('')
  const [total, setTotal] = useState(preset ? String(preset.price) : '')
  const [sessionsTotal, setSessionsTotal] = useState('')
  const [sessionsUsed, setSessionsUsed] = useState('')
  /** Seansları uygulayan personel + geçmiş randevu kaydı ayarları. */
  const [appliedStaffId, setAppliedStaffId] = useState('')
  const [makeAppointments, setMakeAppointments] = useState(true)
  const [sessionInterval, setSessionInterval] = useState('15')
  /**
   * SEANS SEANS düzenleme. Kapalıyken (varsayılan) tarihler "satış günü + n × aralık" ile
   * üretilir ve hepsini tek personel yapmış sayılır. Açılınca her seansın tarihi ve personeli
   * ayrı ayrı girilebilir — gerçek geçmişte seansları farklı kişiler farklı günlerde yapmış olur.
   */
  const [perSession, setPerSession] = useState(false)
  const [sessionRows, setSessionRows] = useState<SessionDetailRow[]>([])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  /**
   * ÇAPRAZ ŞUBE ONAYI. Sunucu, satışın şubesinde çalışmayan personele geçmiş seans yazmayı
   * varsayılan olarak reddeder. Kutu peşin gösterilmez — vakaların çoğunda personel doğru
   * şubededir ve gereksiz bir soru olurdu; sunucu reddedince belirir.
   */
  const [crossBranchAsked, setCrossBranchAsked] = useState(false)
  const [allowCrossBranch, setAllowCrossBranch] = useState(false)

  // --- ödeme geçmişi ---
  const [payKind, setPayKind] = useState<'cash' | 'installment'>('cash')
  const [method, setMethod] = useState('cash')
  /** Peşin satışta tahsil edilen tutar (boş = tamamı ödendi). */
  const [cashPaid, setCashPaid] = useState('')
  const [installments, setInstallments] = useState('3')
  const [firstDue, setFirstDue] = useState('')
  /** Vade sırasıyla kaç taksitin ödendiği. */
  const [paidCount, setPaidCount] = useState(0)

  /**
   * YEREL bugün — `toISOString()` UTC verir ve UTC+3'te gece yarısından sonra bir ÖNCEKİ güne
   * kayar: aynı evrak tarihi webde "gelecek" diye reddedilirken mobilde kabul ediliyordu
   * (mobil `customer_sales_panel.dart` zaten cihazın yerel gününü kullanıyor). İki istemci
   * aynı günü görmeli, yoksa tarih sınırı saate göre değişir.
   */
  const todayIso = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  /** Modal kabuğu — odak tuzağı ve odağın geri verilmesi buradan yürür. */
  const panelRef = useRef<HTMLDivElement | null>(null)

  /**
   * Esc yalnız en üstteki modalı kapatsın — bkz. SaleDetailModal'daki aynı gerekçe.
   *
   * ODAK TUZAĞI da burada: modal `role="dialog"` + `aria-modal` olduğu için klavye kullanıcısının
   * Tab ile arkadaki sayfaya kaçmaması gerekir (kaçarsa görmediği bir formda gezinir). Açılışta
   * odak modala alınır, kapanışta ÇAĞIRAN öğeye geri verilir.
   */
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((el) => el.offsetParent !== null)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      // Uçlarda döngü: sondan Tab başa, baştan Shift+Tab sona gider.
      if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
      else if (active && !panelRef.current.contains(active)) { e.preventDefault(); first.focus() }
    }

    window.addEventListener('keydown', onKey, true)
    // Açılışta odak modalın kendisine: içerideki ilk alana atlamak, ekran okuyucunun başlığı
    // hiç okumamasına yol açıyor.
    panelRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey, true)
      previouslyFocused?.focus?.()
    }
  }, [onClose])

  const packagePickerItems = useMemo<PickerItem[]>(
    () => packageOptions.map((p) => ({
      id: p.id, name: p.name, price: p.price, cat: p.cat || '', sub: p.sub || '',
      meta: p.meta || formatTL(p.price), content: p.content,
    })),
    [packageOptions],
  )
  const servicePickerItems = useMemo<PickerItem[]>(
    () => serviceOptions.map((s) => ({
      id: s.id, name: s.name, price: s.price, cat: s.cat || '', sub: s.sub || '', meta: s.meta || formatTL(s.price),
    })),
    [serviceOptions],
  )

  // Katalogdan seçim yapılınca ad ve tutar otomatik dolar (kullanıcı değiştirebilir).
  const applyPackage = (id: string): void => {
    setPackageId(id)
    const p = packageOptions.find((x) => x.id === id)
    if (p) { setName(p.name); if (!total) setTotal(String(p.price)) }
  }
  const applyService = (id: string): void => {
    setServiceId(id)
    const s = serviceOptions.find((x) => x.id === id)
    if (s) { setName(s.name); if (!total) setTotal(String(s.price)) }
  }

  const totalNum = Math.max(0, Number(total) || 0)
  const instCount = Math.min(36, Math.max(0, Number(installments) || 0))
  /** Vade verilmezse backend satış tarihinden bir ay sonrasını kullanır — önizleme de öyle gösterir. */
  const effectiveFirstDue = useMemo(() => {
    if (firstDue) return firstDue
    if (soldAt) return addMonthsIso(soldAt, 1).day
    return ''
  }, [firstDue, soldAt])

  const plan = useMemo(() => {
    if (payKind !== 'installment' || instCount <= 0 || totalNum <= 0 || !effectiveFirstDue) return []
    const amounts = splitInstallments(totalNum, instCount)
    return amounts.map((amount, i) => ({ no: i + 1, amount, ...addMonthsIso(effectiveFirstDue, i) }))
  }, [payKind, instCount, totalNum, effectiveFirstDue])

  // Taksit sayısı düşerse ödenen sayısı taşmasın.
  useEffect(() => { setPaidCount((c) => Math.min(c, instCount)) }, [instCount])

  const cashPaidNum = cashPaid.trim() === '' ? totalNum : Math.max(0, Number(cashPaid) || 0)
  const paidNum = payKind === 'cash'
    ? Math.min(cashPaidNum, totalNum)
    : plan.slice(0, paidCount).reduce((s, x) => s + x.amount, 0)
  const remaining = Math.max(0, totalNum - paidNum)
  const paidPct = totalNum > 0 ? Math.min(100, Math.round((paidNum / totalNum) * 100)) : 0

  const sessionsTotalNum = Math.max(0, Number(sessionsTotal) || 0)
  const sessionsUsedNum = Math.min(Math.max(0, Number(sessionsUsed) || 0), sessionsTotalNum)
  const sessionsDone = sessionsTotalNum > 0 && sessionsUsedNum >= sessionsTotalNum
  const intervalNum = Math.min(365, Math.max(1, Number(sessionInterval) || 15))

  /** Oluşacak geçmiş randevuların tarihleri (önizleme) — bugünü aşan tarih bugüne çekilir. */
  const appointmentDates = useMemo(() => {
    if (!makeAppointments || sessionsUsedNum <= 0 || !soldAt) return []
    const out: string[] = []
    const today = new Date()
    for (let i = 0; i < Math.min(sessionsUsedNum, 12); i++) {
      const d = new Date(`${soldAt}T12:00:00`)
      d.setDate(d.getDate() + intervalNum * i)
      out.push((d > today ? today : d).toLocaleDateString('tr-TR'))
    }
    return out
  }, [makeAppointments, sessionsUsedNum, soldAt, intervalNum])

  /** Aralık kuralının o seans için önereceği tarih (YYYY-MM-DD) — satır varsayılanı. */
  const defaultSessionDate = (index: number): string => {
    if (!soldAt) return ''
    const d = new Date(`${soldAt}T12:00:00`)
    d.setDate(d.getDate() + intervalNum * index)
    const today = new Date()
    const use = d > today ? today : d
    return `${use.getFullYear()}-${String(use.getMonth() + 1).padStart(2, '0')}-${String(use.getDate()).padStart(2, '0')}`
  }

  /**
   * Satır sayısını seans adedine eşitler ve TÜRETİLMİŞ tarihleri tazeler.
   *
   * İki kural birlikte çalışır:
   *  · KULLANICI GİRDİSİ KORUNUR — baştan kurmak, seans sayısını 3'ten 4'e çıkaran kullanıcının
   *    önceki üç satırda girdiği tarih/personeli siliyordu.
   *  · TÜRETİLMİŞ TARİH BAYAT KALMAZ — eskiden yalnız EKSİK satırlar ekleniyordu; satış tarihini
   *    ya da seans aralığını sonradan değiştiren kullanıcıda mevcut satırlar ESKİ tarihe göre
   *    üretilmiş hâlde kalıyor, kayıtta eski ve yeni tarihlerin karışımı oluşuyordu.
   *    `dateEdited` olmayan satır, kural değişince yeniden hesaplanır.
   */
  useEffect(() => {
    if (!perSession) return
    setSessionRows((prev) => {
      const next: SessionDetailRow[] = []
      let changed = prev.length !== sessionsUsedNum
      for (let i = 0; i < sessionsUsedNum; i++) {
        const old = prev[i]
        if (!old) { next.push({ date: defaultSessionDate(i), staffId: '', dateEdited: false }); changed = true; continue }
        // Elle yazılmış tarih dokunulmaz; kuralın ürettiği tarih güncel kurala göre tazelenir.
        const fresh = old.dateEdited ? old.date : defaultSessionDate(i)
        if (fresh !== old.date) changed = true
        next.push(fresh === old.date ? old : { ...old, date: fresh })
      }
      return changed ? next : prev
    })
    // defaultSessionDate soldAt/intervalNum'a bağlı; onlar değişince türetilmiş satırlar tazelenir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perSession, sessionsUsedNum, soldAt, intervalNum])

  const effectiveName = useMemo(() => {
    if (kind === 'package') return packageOptions.find((p) => p.id === packageId)?.name || name
    if (kind === 'service') return serviceOptions.find((s) => s.id === serviceId)?.name || name
    return name
  }, [kind, packageId, serviceId, name, packageOptions, serviceOptions])

  const submit = async (): Promise<void> => {
    if (needsCustomer && !customerId) { setError('Müşteri seçin.'); return }
    if (!effectiveName.trim()) { setError('Paket / hizmet adı zorunludur.'); return }
    if (!soldAt) { setError('Satış tarihi zorunludur.'); return }
    if (soldAt > todayIso) { setError('Satış tarihi bugünden ileri olamaz.'); return }
    if (totalNum <= 0) { setError('Tutar sıfırdan büyük olmalı.'); return }
    if (payKind === 'cash' && cashPaidNum > totalNum) { setError('Tahsil edilen tutar, toplam tutardan fazla olamaz.'); return }
    if (payKind === 'installment' && instCount <= 0) { setError('Taksitli satışta taksit sayısı en az 1 olmalı.'); return }
    const st = Math.max(0, Number(sessionsTotal) || 0)
    const su = Math.max(0, Number(sessionsUsed) || 0)
    if (su > st) { setError('Kullanılan seans, toplam seanstan fazla olamaz.'); return }
    if (st > 0 && kind !== 'package' && !serviceId) { setError('Seans takibi için hizmet seçin (seanslar bir hizmetten düşer).'); return }

    /*
     * EVRAK İÇİ KRONOLOJİ — sunucudaki kuralın istemci karşılığı.
     *
     * Eski tarih (2015, 2020) HATA DEĞİLDİR; bu ekranın işi zaten eski evrakları sisteme almak.
     * Hata olan, evrağın kendi içinde tutarsız olmasıdır:
     *
     *     evraktaki satış tarihi ≤ seans tarihi ≤ bugün
     *
     * Sunucu da aynı kuralı uygular; burada durdurmak kullanıcıya hangi SATIRIN bozuk olduğunu
     * gösterir (sunucu hatası tek satır metindir).
     */
    if (perSession && makeAppointments && su > 0) {
      for (let i = 0; i < Math.min(sessionRows.length, su); i++) {
        const d = sessionRows[i]?.date
        if (!d) continue
        if (d < soldAt) { setError(`${i + 1}. seansın tarihi (${d}) satış tarihinden (${soldAt}) önce olamaz.`); return }
        if (d > todayIso) { setError(`${i + 1}. seansın tarihi (${d}) gelecekte olamaz.`); return }
      }
    }

    setSaving(true)
    setError('')
    try {
      await onSubmit({
        customerId: customerId || undefined,
        name: effectiveName.trim(),
        // Girilen gün yerel; günün başlangıcı UTC'ye çevrilir.
        soldAt: new Date(`${soldAt}T12:00:00`).toISOString(),
        soldByStaffMemberId: staffId || null,
        servicePackageId: kind === 'package' && packageId ? packageId : null,
        serviceDefinitionId: kind !== 'package' && serviceId ? serviceId : null,
        totalAmount: totalNum,
        paidAmount: Math.round(paidNum * 100) / 100,
        sessionsTotal: st,
        sessionsUsed: su,
        appliedByStaffMemberId: appliedStaffId || null,
        createSessionAppointments: makeAppointments && su > 0,
        sessionIntervalDays: intervalNum,
        // SEANS DETAYLARI yalnız kullanıcı açtıysa gider; kapalıyken sunucu eski davranışa
        // (eşit aralık + tek personel) düşer. Boş bırakılan alan da null gider ve satır
        // bazında varsayılana düşer — kısmi doldurma desteklenir.
        sessions: perSession && makeAppointments && su > 0
          ? sessionRows.slice(0, su).map((r) => ({
              performedAtUtc: r.date ? new Date(`${r.date}T12:00:00`).toISOString() : null,
              staffMemberId: r.staffId || null,
            }))
          : undefined,
        installmentCount: payKind === 'installment' ? instCount : 0,
        firstDueDate: payKind === 'installment' ? (firstDue || null) : null,
        paidInstallmentCount: payKind === 'installment' ? paidCount : 0,
        paymentMethod: method,
        notes: notes.trim() || null,
        allowCrossBranchStaff: allowCrossBranch,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Kayıt başarısız.'
      // Sunucu çapraz şube personelini reddettiyse onay kutusunu göster: kullanıcı "o tarihte
      // bu şubede çalışıyordu" diyip aynı formu tekrar gönderebilsin.
      if (/şubesinde görünmüyor/i.test(msg)) setCrossBranchAsked(true)
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  const working = saving || busy
  const methodLabel = METHODS.find((m) => m.value === method)?.label || 'Nakit'

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-[135] flex items-start justify-center overflow-y-auto bg-[#2a141f]/55 p-2 backdrop-blur-[3px] sm:items-center sm:p-4" onClick={onClose}>
      {/* role/aria-modal + başlık bağı: yardımcı teknoloji bunu "arkadaki sayfayı kapatan
          iletişim kutusu" olarak duyursun ve başlığı okusun. Odak tuzağı yukarıdaki efektte. */}
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hist-sale-title"
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
        className="my-auto flex max-h-[94dvh] w-full max-w-[1180px] flex-col overflow-hidden rounded-[22px] border border-[#EAD8DF] bg-[#fbf4f7] shadow-[0_40px_120px_-50px_rgba(90,40,60,0.7)] outline-none sm:rounded-[26px]"
      >
        <header className="relative shrink-0 overflow-hidden border-b border-[#EAD8DF] bg-gradient-to-br from-white via-[#fbf7ff] to-[#f6efff] px-4 py-4 sm:px-6">
          <span aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-52 w-52 rounded-full bg-[#c7a8ef]/25 blur-3xl" />
          <div className="relative flex items-start gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[15px] border border-[#e0d3f2] bg-[#faf6ff] text-[#6b4aa0]">
              <Archive className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="hist-sale-title" className="font-display text-[19px] font-bold leading-tight tracking-tight text-[#241923] sm:text-[21px]">Geçmiş satış ekle</h2>
              <div className="mt-1 text-[11.5px] text-[#74616A]">
                <b className="font-semibold text-[#3E343A]">{customerName}</b> · eski satışı, ödeme geçmişiyle birlikte sisteme işleyin
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Kapat" className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full border border-[#EAD8DF] bg-white text-[#74616A] shadow-sm transition-colors hover:bg-[#faf6ff] hover:text-[#6b4aa0]">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* GÖVDE — geniş ekranda solda form, sağda canlı kayıt özeti */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-[#fbf4f7] px-3.5 py-4 sm:px-5 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-5">
          <div className="space-y-3.5">
            {/* Katalogdan açıldığında müşteri burada seçilir (sunucu-taraflı arama). */}
            {needsCustomer && (
              <div className={CARD}>
                <span className={LABEL}><User className="mr-1 inline h-3.5 w-3.5 text-[#A5556E]" />Müşteri *</span>
                <CustomerPicker
                  items={[]}
                  value={customerId}
                  onChange={setCustomerId}
                  onSelectItem={(c: CustomerPickerItem) => setCustomerLabel(c.name)}
                  onSearch={customerSearch}
                  placeholder="İsim veya telefonla ara…"
                />
                {customerLabel && <p className={`mt-1 ${HINT}`}>Seçili: <b className="font-semibold text-[#3E343A]">{customerLabel}</b></p>}
              </div>
            )}

            {/* Ne satıldı? — satış modalindeki aramalı katalog seçici */}
            <div className={CARD}>
              <span className={LABEL}>Ne satıldı? *</span>
              {preset ? (
                <div className="flex items-center gap-2 rounded-[11px] border border-[#BE7690] bg-[#F6DFE6] px-3 py-2">
                  {preset.kind === 'package' ? <Package className="h-4 w-4 shrink-0 text-[#A5556E]" /> : <Scissors className="h-4 w-4 shrink-0 text-[#A5556E]" />}
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-[#2A2027]">{preset.name}</span>
                  <span className="shrink-0 text-[11.5px] font-semibold text-[#a34a62]">{formatTL(preset.price)}</span>
                </div>
              ) : (
                <>
                  <div className="mb-1 inline-flex rounded-full border border-[#EAD8DF] bg-[#fff8fa] p-0.5">
                    {([['package', 'Paket', Package], ['service', 'Hizmet', Scissors], ['free', 'Elle yaz', Archive]] as const).map(([k, label, Icon]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setKind(k)}
                        className={`inline-flex cursor-pointer items-center gap-1 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors ${kind === k ? 'bg-[#A5556E] text-white' : 'text-[#74616A] hover:text-[#a34a62]'}`}
                      >
                        <Icon className="h-3.5 w-3.5" /> {label}
                      </button>
                    ))}
                  </div>

                  {kind === 'package' && (
                    <CatalogPicker items={packagePickerItems} value={packageId} onChange={applyPackage} emptyText="Paket bulunamadı." clearable />
                  )}
                  {kind === 'service' && (
                    <CatalogPicker items={servicePickerItems} value={serviceId} onChange={applyService} emptyText="Hizmet bulunamadı." clearable />
                  )}
                  {kind === 'free' && (
                    <>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="örn. 2023 Lazer Epilasyon Paketi"
                        className={FIELD}
                      />
                      <p className={`mt-1 ${HINT}`}>Katalogda olmayan eski paketler için adı elle yazın.</p>
                    </>
                  )}
                </>
              )}
            </div>

            {/* Satış bilgileri */}
            <div className={CARD}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className={LABEL}><CalendarClock className="mr-1 inline h-3.5 w-3.5 text-[#A5556E]" />Satış tarihi *</span>
                  <input type="date" value={soldAt} max={todayIso} onChange={(e) => setSoldAt(e.target.value)} className={FIELD} />
                </label>
                <label className="block">
                  <span className={LABEL}><User className="mr-1 inline h-3.5 w-3.5 text-[#A5556E]" />Satan personel</span>
                  <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={FIELD}>
                    <option value="">Belirtilmedi</option>
                    {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label className="block sm:col-span-2">
                  <span className={LABEL}>Toplam tutar (₺) *</span>
                  <input type="number" min={0} step={50} value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0" className={`${FIELD} tabular-nums`} />
                </label>
              </div>
            </div>

            {/* ÖDEME — peşin mi, taksitli mi; taksitliyse hangi aylar ödendi */}
            <div className={CARD}>
              <span className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#A5556E]">
                <Wallet className="h-3.5 w-3.5" /> Nasıl ödendi?
              </span>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-full border border-[#EAD8DF] bg-[#fff8fa] p-0.5">
                  {([['cash', 'Peşin', Banknote], ['installment', 'Taksitli', CreditCard]] as const).map(([k, label, Icon]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setPayKind(k)}
                      className={`inline-flex cursor-pointer items-center gap-1 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors ${payKind === k ? 'bg-[#A5556E] text-white' : 'text-[#74616A] hover:text-[#a34a62]'}`}
                    >
                      <Icon className="h-3.5 w-3.5" /> {label}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-1.5">
                  <span className="text-[11.5px] font-semibold text-[#3E343A]">Yöntem</span>
                  <select value={method} onChange={(e) => setMethod(e.target.value)} className="rounded-[10px] border border-[#EAD8DF] bg-white px-2.5 py-1.5 text-[12px] text-[#2A2027] outline-none focus:border-[#ef9ab5]">
                    {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </label>
              </div>

              {payKind === 'cash' ? (
                <div className="mt-3">
                  <label className="block">
                    <span className={LABEL}>Tahsil edilen tutar (₺)</span>
                    <input
                      type="number"
                      min={0}
                      step={50}
                      value={cashPaid}
                      onChange={(e) => setCashPaid(e.target.value)}
                      placeholder={totalNum > 0 ? `${totalNum} (tamamı)` : '0'}
                      className={`${FIELD} tabular-nums`}
                    />
                  </label>
                  <p className={`mt-1 ${HINT}`}>
                    Boş bırakırsanız <b className="font-semibold text-[#3E343A]">tamamı ödendi</b> sayılır. Tahsilat, satış tarihine yazılır.
                  </p>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className={LABEL}>Taksit sayısı *</span>
                      <input type="number" min={1} max={36} value={installments} onChange={(e) => setInstallments(e.target.value)} className={`${FIELD} tabular-nums`} />
                    </label>
                    <label className="block">
                      <span className={LABEL}>İlk taksit ayı</span>
                      <input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} className={FIELD} />
                      <span className={`mt-1 block ${HINT}`}>Boşsa satıştan bir ay sonra başlar.</span>
                    </label>
                  </div>

                  {plan.length === 0 ? (
                    <div className={`rounded-[12px] border border-dashed border-[#EAD8DF] bg-[#F7F6F6] px-3 py-4 text-center text-[11.5px] ${HINT}`}>
                      Plan için satış tarihi, tutar ve taksit sayısını girin.
                    </div>
                  ) : (
                    <div className="rounded-[13px] border border-[#efd6df] bg-[#F7F6F6] p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11.5px] font-semibold text-[#3E343A]">
                          Hangi aylar ödendi? <span className="font-bold text-[#A5556E]">{paidCount}/{plan.length}</span>
                        </span>
                        <span className="flex gap-1.5">
                          <button type="button" onClick={() => setPaidCount(plan.length)} className="cursor-pointer rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 transition-colors hover:bg-emerald-100">Tümü ödendi</button>
                          <button type="button" onClick={() => setPaidCount(0)} className="cursor-pointer rounded-full border border-[#EAD8DF] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#74616A] transition-colors hover:bg-[#F7F6F6]">Hiçbiri</button>
                        </span>
                      </div>

                      {/* Aya tıklamak "o aya kadar ödendi" demektir — taksitler vade sırasıyla kapanır. */}
                      <div className={`grid gap-1.5 sm:grid-cols-2 ${plan.length > 8 ? 'max-h-[188px] overflow-y-auto pr-1' : ''}`}>
                        {plan.map((p) => {
                          const isPaid = p.no <= paidCount
                          return (
                            <button
                              key={p.no}
                              type="button"
                              onClick={() => setPaidCount(paidCount === p.no ? p.no - 1 : p.no)}
                              className={`flex cursor-pointer items-center gap-2 rounded-[11px] border px-2.5 py-1.5 text-left transition-colors ${
                                isPaid ? 'border-emerald-200 bg-emerald-50' : 'border-[#EAD8DF] bg-white hover:border-[#BE7690]'
                              }`}
                            >
                              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${isPaid ? 'bg-emerald-500 text-white' : 'bg-[#f4e7ec] text-[#74616A]'}`}>
                                {isPaid ? <Check className="h-3 w-3" strokeWidth={3} /> : p.no}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[11.5px] font-semibold text-[#2A2027]">{p.label}</span>
                                <span className={`block text-[10.5px] tabular-nums ${isPaid ? 'text-emerald-700' : 'text-[#74616A]'}`}>
                                  {formatTL(Math.round(p.amount))} {isPaid ? '· ödendi' : ''}
                                </span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                      <p className={`mt-2 ${HINT}`}>Bir aya tıklayınca o ay ve öncesi ödenmiş sayılır; ödemeler kendi vade tarihiyle cariye işlenir.</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Seanslar */}
            <div className={CARD}>
              <span className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#A5556E]">
                <Sparkles className="h-3.5 w-3.5" /> Seanslar
              </span>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className={LABEL}>Toplam seans</span>
                  <input type="number" min={0} value={sessionsTotal} onChange={(e) => setSessionsTotal(e.target.value)} placeholder="0" className={`${FIELD} tabular-nums`} />
                </label>
                <label className="block">
                  <span className={LABEL}>Bugüne kadar kullanılan seans</span>
                  <input type="number" min={0} value={sessionsUsed} onChange={(e) => setSessionsUsed(e.target.value)} placeholder="0" className={`${FIELD} tabular-nums`} />
                </label>
              </div>

              {sessionsTotalNum > 0 && (
                <div className="mt-2.5 space-y-2.5">
                  {/* Seanslar bitti mi? Tek dokunuşla "hepsi yapıldı". */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-[#efd6df] bg-[#F7F6F6] px-3 py-2">
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[#3E343A]">
                      <CheckCircle2 className={`h-4 w-4 ${sessionsDone ? 'text-emerald-600' : 'text-[#c9b3bd]'}`} />
                      {sessionsDone
                        ? 'Tüm seanslar tamamlandı'
                        : `${sessionsUsedNum}/${sessionsTotalNum} seans yapıldı · ${sessionsTotalNum - sessionsUsedNum} kaldı`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSessionsUsed(sessionsDone ? '0' : String(sessionsTotalNum))}
                      className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                        sessionsDone
                          ? 'border-[#EAD8DF] bg-white text-[#74616A] hover:bg-[#F7F6F6]'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      }`}
                    >
                      {sessionsDone ? 'Sıfırla' : 'Tümü tamamlandı'}
                    </button>
                  </div>

                  {sessionsUsedNum > 0 && (
                    <>
                      <label className="block">
                        <span className={LABEL}><User className="mr-1 inline h-3.5 w-3.5 text-[#A5556E]" />Seansları uygulayan personel</span>
                        <select value={appliedStaffId} onChange={(e) => setAppliedStaffId(e.target.value)} className={FIELD}>
                          <option value="">Belirtilmedi{staffId ? ' — satan personel yazılır' : ''}</option>
                          {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </label>

                      {/* Geçmiş seanslar randevular sayfasında da görünsün. */}
                      <div className="rounded-[12px] border border-[#efd6df] bg-[#F7F6F6] p-3">
                        <label className="flex cursor-pointer items-start gap-2">
                          <input
                            type="checkbox"
                            checked={makeAppointments}
                            onChange={(e) => setMakeAppointments(e.target.checked)}
                            className="mt-0.5 h-4 w-4 accent-[#A5556E]"
                          />
                          <span>
                            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#2A2027]">
                              <CalendarCheck className="h-4 w-4 text-[#A5556E]" />
                              Yapılan seanslar randevu geçmişine işlensin
                            </span>
                            <span className={`mt-0.5 block ${HINT}`}>
                              {sessionsUsedNum} adet <b className="font-semibold text-[#3E343A]">tamamlanmış</b> geçmiş randevu
                              açılır; randevular sayfasında ve müşteri kartında görünür. Ciro iki kez sayılmasın diye
                              randevu tutarı 0 yazılır.
                            </span>
                          </span>
                        </label>

                        {makeAppointments && (
                          <>
                            {/* SEANS SEANS mi, eşit aralık mı? Varsayılan eşit aralık —
                                çoğu geçmiş kayıtta kullanıcı tek tek tarih girmek istemiyor. */}
                            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                              {[
                                { key: false, label: 'Eşit aralıkla üret' },
                                { key: true, label: 'Seansları tek tek gir' },
                              ].map((opt) => (
                                <button
                                  key={String(opt.key)}
                                  type="button"
                                  onClick={() => setPerSession(opt.key)}
                                  className={`rounded-[9px] border px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors ${
                                    perSession === opt.key
                                      ? 'border-[#8C4460] bg-[#A5556E] text-white'
                                      : 'border-[#EAD8DF] bg-white text-[#3E343A] hover:border-[#BE7690]'
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>

                            {!perSession && (
                              <div className="mt-2.5 flex flex-wrap items-end gap-3">
                                <label className="block w-32">
                                  <span className={LABEL}>Seans aralığı (gün)</span>
                                  <input type="number" min={1} max={365} value={sessionInterval} onChange={(e) => setSessionInterval(e.target.value)} className={`${FIELD} tabular-nums`} />
                                </label>
                                {appointmentDates.length > 0 && (
                                  <span className={`flex-1 ${HINT}`}>
                                    Tarihler: {appointmentDates.join(' · ')}
                                    {sessionsUsedNum > appointmentDates.length ? ` … (+${sessionsUsedNum - appointmentDates.length})` : ''}
                                  </span>
                                )}
                              </div>
                            )}

                            {perSession && (
                              <div className="mt-2.5">
                                <div className={`mb-2 ${HINT}`}>
                                  Her seansın <b className="font-semibold text-[#3E343A]">ne zaman</b> ve
                                  <b className="font-semibold text-[#3E343A]"> kim tarafından</b> yapıldığını girin.
                                  Boş bıraktığınız alan üstteki varsayılana düşer.
                                </div>

                                {/* HEPSİNE UYGULA — seansların çoğunu tek kişi yapmışsa satır satır
                                    seçtirmek gereksiz iş. Seçim sonrası tek tek düzeltilebilir. */}
                                {staffOptions.length > 0 && sessionsUsedNum > 1 && (
                                  <div className="mb-2 flex flex-wrap items-center gap-2 rounded-[10px] border border-[#EAD8DF] bg-white px-2.5 py-2">
                                    {/* Görünür metin select'e PROGRAMATİK olarak bağlanır: yalnız
                                        yan yana durması ekran okuyucuda etiket saymıyordu. */}
                                    <label htmlFor="hist-bulk-staff" className="text-[11px] font-semibold text-[#5A4B53]">Hepsini yapan:</label>
                                    <select
                                      id="hist-bulk-staff"
                                      value=""
                                      onChange={(e) => {
                                        const id = e.target.value
                                        if (!id) return
                                        setSessionRows((list) => list.map((r) => ({ ...r, staffId: id })))
                                      }}
                                      className={`${FIELD} min-w-0 flex-1`}
                                    >
                                      <option value="">Personel seçin — hepsine uygulanır</option>
                                      {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                  </div>
                                )}

                                {/* Satır: sıra · tarih · personel. Dar kolonda alt alta, geniş
                                    ekranda yan yana — personel kutusu kırpılmasın diye ızgara. */}
                                <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
                                  {sessionRows.slice(0, sessionsUsedNum).map((row, i) => {
                                    const staffName = staffOptions.find((s) => s.id === row.staffId)?.name
                                    return (
                                      <div key={i} className="rounded-[12px] border border-[#EAD8DF] bg-white p-2.5">
                                        <div className="mb-1.5 flex items-center gap-2">
                                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#A5556E] text-[10.5px] font-bold text-white">
                                            {i + 1}
                                          </span>
                                          <span className="text-[11.5px] font-semibold text-[#2A2027]">{i + 1}. seans</span>
                                          {/* Seçilen personel ROZETLE de yazılır: dar select'te ad
                                              kırpılınca kimin seçildiği okunmuyordu. */}
                                          <span className={`ml-auto truncate rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                                            staffName ? 'bg-[#F6DFE6] text-[#8C4460]' : 'bg-[#F7F6F6] text-[#74616A]'
                                          }`}>
                                            {staffName || 'Varsayılan personel'}
                                          </span>
                                        </div>
                                        <div className="grid gap-2 sm:grid-cols-[minmax(0,150px)_minmax(0,1fr)]">
                                          {/* KRONOLOJİ SINIRI: seans, evraktaki satış gününden önce
                                              ve bugünden sonra olamaz (eski tarihin kendisi normaldir).
                                              `dateEdited` — elle yazılan tarih, satış tarihi/aralık
                                              sonradan değişse de yeniden hesaplanmaz. */}
                                          <input
                                            type="date"
                                            min={soldAt || undefined}
                                            max={todayIso}
                                            value={row.date}
                                            onChange={(e) => setSessionRows((list) => list.map((r, ix) => (ix === i ? { ...r, date: e.target.value, dateEdited: true } : r)))}
                                            className={`${FIELD} tabular-nums`}
                                          />
                                          <select
                                            value={row.staffId}
                                            onChange={(e) => setSessionRows((list) => list.map((r, ix) => (ix === i ? { ...r, staffId: e.target.value } : r)))}
                                            className={`${FIELD} min-w-0`}
                                          >
                                            <option value="">Varsayılan personel</option>
                                            {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                          </select>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
              {kind === 'package' && packageId && Number(sessionsTotal) > 0 && (
                <p className={`mt-2 ${HINT}`}>Paket seçildiğinde seanslar paketin kalemlerinden açılır; buradaki &quot;kullanılan&quot; sayısı düşülür.</p>
              )}

              {/* Seans takibi bir hizmete bağlıdır: elle yazılan eski paketlerde seans girilecekse
                  seansın hangi hizmetten düşeceği seçilmeli (yoksa kalan seans takip edilemez). */}
              {kind === 'free' && Number(sessionsTotal) > 0 && (
                <div className="mt-3">
                  <span className={LABEL}><Scissors className="mr-1 inline h-3.5 w-3.5 text-[#A5556E]" />Seanslar hangi hizmetten düşülsün? *</span>
                  <CatalogPicker items={servicePickerItems} value={serviceId} onChange={setServiceId} emptyText="Hizmet bulunamadı." clearable />
                  <span className={`mt-1 block ${HINT}`}>Randevu tamamlandıkça seans buradan düşer.</span>
                </div>
              )}
            </div>

            <label className={`block ${CARD}`}>
              <span className={LABEL}>Not</span>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="opsiyonel" className={FIELD} />
            </label>

            {error && <div className="rounded-[13px] border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[11.5px] font-semibold text-rose-700">{error}</div>}

            {/* ÇAPRAZ ŞUBE ONAYI — yalnız sunucu reddettikten sonra çıkar. Şube aktarımı olan
                personelin geçmişi başka türlü hiç girilemezdi; onay bilinçli ve iz bırakır. */}
            {crossBranchAsked && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-[13px] border border-amber-300 bg-amber-50 px-3.5 py-2.5">
                <input
                  type="checkbox"
                  checked={allowCrossBranch}
                  onChange={(e) => setAllowCrossBranch(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#A5556E]"
                />
                <span className="text-[11.5px] leading-snug text-[#5A4B53]">
                  <b className="font-semibold text-[#3E343A]">Bu personel o tarihte bu şubede çalışıyordu.</b>{' '}
                  Şube aktarımı yapılmış personel için işaretleyin; geçmiş seans yine de kaydedilir.
                </span>
              </label>
            )}
          </div>

          {/* CANLI ÖZET — yazdıkça güncellenir, kaydetmeden önce kontrol imkânı verir */}
          <aside className="mt-4 rounded-[16px] border border-[#EAD8DF] bg-white p-4 lg:sticky lg:top-0 lg:mt-0">
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#6b4aa0]">
              <Archive className="h-3.5 w-3.5" /> Kayıt özeti
            </span>

            <div className="mt-3 truncate font-display text-[15px] font-bold text-[#241923]">{effectiveName.trim() || 'Paket / hizmet seçilmedi'}</div>
            <div className={`mt-0.5 ${HINT}`}>{soldAt ? soldAt.split('-').reverse().join('.') : 'Satış tarihi girilmedi'}</div>

            <div className="mt-3 space-y-1.5 border-t border-[#f4e7ec] pt-3 text-[12px]">
              <SummaryRow label="Toplam" value={formatTL(Math.round(totalNum))} />
              <SummaryRow label="Tahsil edilen" value={formatTL(Math.round(paidNum))} tone="text-[#2c7d63]" />
              <SummaryRow label="Kalan" value={formatTL(Math.round(remaining))} tone={remaining > 0 ? 'text-[#cf4d68]' : 'text-[#2c7d63]'} />
            </div>

            {totalNum > 0 && (
              <div className="mt-2.5 flex items-center gap-2">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f2e6eb]">
                  <span
                    className={`block h-full rounded-full ${remaining > 0 ? 'bg-[linear-gradient(90deg,#e78ba8,#c05277)]' : 'bg-[linear-gradient(90deg,#7fc7ad,#2c7d63)]'}`}
                    style={{ width: `${Math.max(3, paidPct)}%` }}
                  />
                </span>
                <span className="shrink-0 text-[11px] font-bold tabular-nums text-[#3E343A]">%{paidPct}</span>
              </div>
            )}

            <div className="mt-3 space-y-1.5 border-t border-[#f4e7ec] pt-3 text-[12px]">
              <SummaryRow
                label="Ödeme"
                value={payKind === 'cash' ? `Peşin · ${methodLabel}` : `${instCount} taksit · ${methodLabel}`}
              />
              {payKind === 'installment' && plan.length > 0 && (
                <>
                  <SummaryRow label="Ödenen ay" value={`${paidCount}/${plan.length}`} tone={paidCount === plan.length ? 'text-[#2c7d63]' : undefined} />
                  <SummaryRow label="Aylık" value={formatTL(Math.round(plan[0].amount))} />
                  {paidCount > 0 && (
                    <div className={`pt-0.5 ${HINT}`}>
                      {plan[0].label} – {plan[paidCount - 1].label} arası ödenmiş
                    </div>
                  )}
                </>
              )}
              {sessionsTotalNum > 0 && (
                <SummaryRow
                  label="Seans"
                  value={`${sessionsUsedNum}/${sessionsTotalNum}${sessionsDone ? ' · tamam' : ''}`}
                  tone={sessionsDone ? 'text-[#2c7d63]' : undefined}
                />
              )}
              {sessionsUsedNum > 0 && (
                <SummaryRow
                  label="Uygulayan"
                  value={staffOptions.find((x) => x.id === appliedStaffId)?.name
                    || staffOptions.find((x) => x.id === staffId)?.name
                    || '—'}
                />
              )}
              {sessionsUsedNum > 0 && makeAppointments && (
                <SummaryRow label="Geçmiş randevu" value={`${sessionsUsedNum} kayıt`} />
              )}
            </div>

            <div className="mt-3 rounded-[11px] border border-[#e0d3f2] bg-[#faf6ff] px-2.5 py-2 text-[10.5px] font-semibold text-[#6b4aa0]">
              Kayıt &quot;Geçmiş kayıt&quot; rozetiyle listelenir; tahsilatlar geçmiş tarihleriyle cariye düşer.
            </div>
          </aside>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[#EAD8DF] bg-white px-4 py-3 sm:px-6">
          <button type="button" onClick={onClose} disabled={working} className="cursor-pointer rounded-[11px] border border-[#EAD8DF] bg-white px-4 py-2 text-[12.5px] font-semibold text-[#74616A] transition-colors hover:bg-[#F7F6F6] disabled:opacity-60">Vazgeç</button>
          <button
            type="button"
            onClick={submit}
            disabled={working}
            className="inline-flex cursor-pointer items-center gap-2 rounded-[11px] bg-gradient-to-r from-[#A5556E] to-[#8C4460] px-5 py-2 text-[12.5px] font-semibold text-white shadow-[0_14px_26px_-16px_rgba(214,95,131,0.95)] transition-opacity hover:opacity-95 disabled:opacity-60"
          >
            {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Kaydet
          </button>
        </footer>
      </motion.div>
    </div>
    </ModalPortal>
  )
}

function SummaryRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[#74616A]">{label}</span>
      <span className={`font-bold tabular-nums ${tone || 'text-[#2A2027]'}`}>{value}</span>
    </div>
  )
}
