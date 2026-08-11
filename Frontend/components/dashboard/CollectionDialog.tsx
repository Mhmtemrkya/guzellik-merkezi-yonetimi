'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  Check,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  Search,
  User,
  Wallet,
  X,
} from 'lucide-react'
import type { AccountInstallmentItem, CustomerAccount } from '@/lib/types'
import { formatTL } from '@/lib/apiMappers'
import { buildInstallmentRows, dueThisMonth } from '@/lib/accountGrouping'
import { idempotencyKey, newIdempotencySalt } from '@/lib/idempotency'

// ---------------------------------------------------------------------------
// TEK "TAHSİLAT AL" MODALI
//
// Eskiden iki ayrı modal vardı: "genel tahsilat" (tüm kalan borç) ve "aylık taksit
// tahsilatı". Kullanıcı her tahsilatta hangisini açacağına karar vermek zorundaydı,
// oysa ikisi de aynı şeyi yapıyor — hesaba tahsilat yazıyor. Artık TEK modal var:
// taksitli hesapta taksit planı ve "bu ay ödenmesi gereken" önerisi kendiliğinden çıkar,
// peşin hesapta sade kalır.
//
// ALLOCATION MODELİ (değişmedi): sunucu tahsilatı taksite değil HESABA yazar ve VADE
// SIRASIYLA dağıtır. "Şu taksiti öde" diye bir seçim yoktur; tutar en eski ödenmemiş
// taksitten başlayarak kapatır. Modal bunu gizlemez, canlı önizlemede gösterir.
//
// DEVİR (düzensiz ödeme): ödenmeyen ayın borcu sonraki ayın taksitinin üstüne biner.
// Hesabı `lib/accountGrouping` yapar; buradaki "bu ay ödenmesi gereken" tutarı odur.
// ---------------------------------------------------------------------------

/**
 * Otomatik doldurulan tutarı KURUŞUNA kadar korur (yalnız kayan nokta artığını temizler).
 * Eskiden tam TL'ye yuvarlanıyordu: 999,50 ₺ borç modalda 1.000 ₺ görünüyor, kullanıcı
 * değiştirmeden onaylayınca 50 kuruş fazla tahsilat kredi bakiyesi olarak yazılıyordu.
 */
function roundKurus(value: number): number {
  return Math.max(0, Math.round((Number(value) || 0) * 100) / 100)
}

export interface CollectionSubmitPayload {
  accountId: string
  amount: number
  method: string
  reference: string | null
  occurredAtUtc: string
  /**
   * `Idempotency-Key` — çağrı yeri bunu `adminApi.registerAccountPayment`'a AYNEN geçirmeli.
   * Geçirilmezse çift gönderim (çift tıklama ya da kayıt sonrası tazeleme patlayınca atılan
   * ikinci tıklama) sunucuda İKİNCİ bir tahsilat satırı açar: 400 ₺ 800 ₺ olur.
   */
  idempotencyKey: string
}

interface CollectionDialogProps {
  accounts: CustomerAccount[]
  /** Dışarıdan ön-seçili cari (ön muhasebe cari sekmesi gibi). */
  initialAccountId?: string | null
  onSubmit: (payload: CollectionSubmitPayload) => Promise<void> | void
  /** Kendi trigger'ını ver (asChild). Yoksa varsayılan buton çizilir. */
  trigger?: ReactNode
  triggerLabel?: string
  title?: string
  description?: string
  /** Kontrollü açılış (opsiyonel). */
  open?: boolean
  onOpenChange?: (next: boolean) => void
  hideTrigger?: boolean
}

const METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: 'cash', label: 'Nakit' },
  { value: 'card', label: 'Kart' },
  { value: 'transfer', label: 'Havale / EFT' },
]

const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

function todayIso(): string {
  // YEREL tarih (UTC değil): toISOString() UTC verir; gece yarısından sonra (UTC+3)
  // bir önceki güne kayar → tahsilat düne işlenir, günlük ciro/kasa/kapanışta görünmez.
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDay(iso: string): string {
  const s = (iso || '').slice(0, 10)
  const [y, m, d] = s.split('-')
  if (!y || !m || !d) return '—'
  return `${d} ${MONTHS_SHORT[Number(m) - 1] ?? ''} ${y}`
}

/** İptal edilmemiş taksitler — plan var mı sorusunun tek cevabı. */
function planOf(account: CustomerAccount | null): AccountInstallmentItem[] {
  return account ? account.installments.filter((i) => i.status !== 'Cancelled') : []
}

/**
 * Modal açılınca yazılacak tutar.
 *  · Taksitli hesap → BU AY ÖDENMESİ GEREKEN (gecikmiş devir + bu ayın taksiti)
 *  · Bu ay vadesi yoksa → SIRADAKİ TAKSİT
 *  · Peşin hesap    → kalan borcun tamamı
 *
 * Taksitlide "kalan borcun tamamı"na düşmek tehlikeliydi: bu ay vadesi olmayan bir planda
 * modal 25.000 ₺ ile açılıp tek tıkla tüm planı tahsil edebiliyordu. Tamamı hâlâ tek çipte.
 */
function suggestedAmount(account: CustomerAccount): number {
  const plan = planOf(account)
  if (plan.length > 1) {
    const due = dueThisMonth(account.installments, todayIso())
    if (due > 0.005) return roundKurus(due)
    const next = plan
      .filter((i) => i.remaining > 0.005)
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))[0]
    if (next) return roundKurus(next.remaining)
  }
  return roundKurus(account.remainingAmount)
}

export default function CollectionDialog({
  accounts,
  initialAccountId,
  onSubmit,
  trigger,
  triggerLabel = 'Tahsilat al',
  title = 'Tahsilat Al',
  description,
  open: controlledOpen,
  onOpenChange,
  hideTrigger,
}: CollectionDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (next: boolean): void => {
    if (onOpenChange) onOpenChange(next)
    if (controlledOpen === undefined) setUncontrolledOpen(next)
  }

  const [accountId, setAccountId] = useState<string>('')
  /**
   * ÖDEME SATIRLARI — tek satır = düz tahsilat, birden çok satır = KIRILIM.
   * 3.000 ₺ borcun 2.000'i nakit + 1.000'i kartla alınabilmeli. Her satır AYRI bir tahsilat
   * kaydına dönüşür; tek satırda toplayıp "karma" demek kasa kapanışındaki yöntem kırılımını
   * ve günlük nakit sayımını bozardı.
   */
  const [rows, setRows] = useState<{ amount: number | ''; method: string }[]>([{ amount: '', method: 'cash' }])
  const [date, setDate] = useState<string>(todayIso())
  const [reference, setReference] = useState<string>('')
  const [query, setQuery] = useState<string>('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pickerRef = useRef<HTMLDivElement | null>(null)
  /**
   * Tahsilat anahtarlarının oturum tuzu. YALNIZ açılış/kapanışta döner — aşağıdaki sıfırlama
   * efektine konulamaz, o efekt `accounts` kimliği her değiştiğinde de çalışır ve tuz dönseydi
   * çift-gönderim koruması sessizce devre dışı kalırdı.
   */
  const saltRef = useRef<string>('')
  useEffect(() => {
    if (open) saltRef.current = newIdempotencySalt()
  }, [open])

  const selected = useMemo(() => accounts.find((a) => a.id === accountId) || null, [accounts, accountId])

  // Modal her açılışta ilk cariye + önerilen tutara sıfırlanır.
  useEffect(() => {
    if (!open) return
    const initial = accounts.find((a) => a.id === initialAccountId) || accounts[0] || null
    setAccountId(initial?.id || '')
    setRows([{ amount: initial ? suggestedAmount(initial) : '', method: 'cash' }])
    setDate(todayIso())
    setReference('')
    setQuery('')
    setPickerOpen(false)
    setError('')
    setSaving(false)
  }, [open, initialAccountId, accounts])

  // Dışarı tıklayınca cari seçici kapansın.
  useEffect(() => {
    if (!pickerOpen) return
    const onDown = (e: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pickerOpen])

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    const list = q
      ? accounts.filter((a) => `${a.customerName} ${a.name} ${a.servicePackageName} ${a.customerPhone}`.toLocaleLowerCase('tr').includes(q))
      : accounts
    return list.slice(0, 60)
  }, [accounts, query])

  /**
   * SATIŞ SEÇİMİ MODU — liste tek bir müşterinin satışlarına daraltılmışsa (ön muhasebede
   * çok satışlı müşteride "Tahsilat al"), seçicide müşteri adı değil SATIŞ adı öne çıkar:
   * aynı ad üç kez alt alta yazınca hangi satışa para yazıldığı okunmuyordu.
   */
  const saleMode = useMemo(
    () => accounts.length > 1 && Boolean(accounts[0]?.customerId) && accounts.every((a) => a.customerId === accounts[0].customerId),
    [accounts],
  )
  const saleLabel = (a: CustomerAccount): string => a.servicePackageName || a.name || 'Satış'

  const pickAccount = (a: CustomerAccount): void => {
    setAccountId(a.id)
    // Seçilen carinin önerilen tutarı tek satıra yazılır (kırılım varsa sıfırlanır).
    setRows([{ amount: suggestedAmount(a), method: 'cash' }])
    setPickerOpen(false)
    setQuery('')
  }

  // ---- Taksit planı + devir görünümü (yalnız taksitli hesapta) ----------------
  const plan = useMemo(() => planOf(selected), [selected])
  const hasPlan = plan.length > 1
  const dueRows = useMemo(
    () => (selected ? buildInstallmentRows(selected.installments, todayIso()) : []),
    [selected],
  )
  /** Ödenmemiş taksitler, vade sırasıyla — tahsilatın dağıtılacağı sıra. */
  const pending = useMemo(
    () => dueRows.filter((r) => r.item.remaining > 0.005),
    [dueRows],
  )
  const overdueSum = useMemo(
    () => pending.filter((r) => r.isOverdue).reduce((s, r) => s + r.item.remaining, 0),
    [pending],
  )
  const dueNow = useMemo(
    () => (selected ? dueThisMonth(selected.installments, todayIso()) : 0),
    [selected],
  )
  const nextPending = pending[0]

  const totalAmount = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0)
  /** Kalan borcun henüz satırlara dağıtılmamış kısmı — yeni satırın varsayılanı olur. */
  // Kuruş korunur: yuvarlarsak 999,50 ₺ borçta 0,50 ₺'lik hayali "dağıtılmamış" kalır.
  const unallocated = selected ? Math.max(0, roundKurus(selected.remainingAmount - totalAmount)) : 0

  /** Girilen tutarın hangi taksitleri kapatacağı — vade sırasıyla canlı dağıtım. */
  const preview = useMemo(() => {
    let pool = totalAmount
    const applied = new Map<string, number>()
    let closes = 0
    let partialOf: { no: number; amount: number } | null = null
    for (const r of pending) {
      const take = Math.min(pool, r.item.remaining)
      pool = Math.max(0, pool - take)
      if (take > 0.005) {
        applied.set(r.item.id, take)
        if (take >= r.item.remaining - 0.005) closes += 1
        else if (!partialOf) partialOf = { no: r.item.no, amount: take }
      }
      if (pool <= 0.005) break
    }
    return { applied, closes, partialOf, leftover: pool }
  }, [pending, totalAmount])

  /** Hızlı tutar çipleri — hepsi taksitli hesapta anlamlı. */
  const quickAmounts = useMemo(() => {
    const out: { key: string; label: string; value: number; hint?: string }[] = []
    if (!selected) return out
    if (hasPlan) {
      if (dueNow > 0.005) out.push({ key: 'due', label: 'Bu ay ödenmesi gereken', value: roundKurus(dueNow) })
      if (overdueSum > 0.005 && Math.abs(overdueSum - dueNow) > 0.005) {
        out.push({ key: 'overdue', label: 'Yalnız gecikmiş', value: roundKurus(overdueSum) })
      }
      if (nextPending && Math.abs(nextPending.item.remaining - dueNow) > 0.005) {
        out.push({
          key: 'next', label: 'Sıradaki taksit', value: roundKurus(nextPending.item.remaining),
          hint: formatDay(nextPending.item.dueDate),
        })
      }
    }
    if (selected.remainingAmount > 0.005) {
      out.push({ key: 'all', label: 'Kalan borcun tamamı', value: roundKurus(selected.remainingAmount) })
    }
    return out
  }, [selected, hasPlan, dueNow, overdueSum, nextPending])

  const setRow = (index: number, patch: Partial<{ amount: number | ''; method: string }>): void =>
    setRows((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)))

  const addRow = (): void => {
    // Yeni satır, kalan dağıtılmamış tutarla açılır; kullanılmamış yöntemlerden biri seçilir.
    const used = new Set(rows.map((r) => r.method))
    const nextMethod = METHOD_OPTIONS.find((m) => !used.has(m.value))?.value ?? 'cash'
    setRows((list) => [...list, { amount: unallocated > 0 ? unallocated : '', method: nextMethod }])
  }

  const removeRow = (index: number): void => setRows((list) => list.filter((_, i) => i !== index))

  /** Hızlı çip: tutarı TEK satıra yazar (kırılım varsa sadeleşir). */
  const applyQuickAmount = (value: number): void =>
    setRows((list) => [{ amount: value, method: list[0]?.method ?? 'cash' }])

  const handleSubmit = async (): Promise<void> => {
    setError('')
    if (!accountId) {
      setError('Cari hesap seçimi zorunlu.')
      return
    }
    const payable = rows.filter((r) => Number(r.amount || 0) > 0)
    if (payable.length === 0) {
      setError('Tutar 0’dan büyük olmalı.')
      return
    }
    // Aynı yöntem iki kez girilirse tek satırda toplanır — kasa kırılımı sade kalsın.
    const merged = new Map<string, number>()
    for (const r of payable) merged.set(r.method, (merged.get(r.method) ?? 0) + Number(r.amount || 0))

    setSaving(true)
    // Tarihten TÜRETİLİR (öğlen sabitlenir) — yani aynı formun tekrar gönderimi aynı damgayı
    // üretir. `new Date()` kullanılsaydı her deneme farklı gövde olur, anahtar tutsa bile
    // middleware parmak izini tutturamaz ve oynatma yerine 409 dönerdi.
    const occurredAtUtc = new Date(`${date || todayIso()}T12:00:00`).toISOString()
    const trimmedReference = reference.trim() || null
    let done = 0
    try {
      // Her yöntem AYRI tahsilat kaydı olur; sıralı gider ki kısmi hata net anlaşılsın.
      for (const [m, amt] of merged) {
        await onSubmit({
          accountId,
          amount: amt,
          method: m,
          reference: trimmedReference,
          occurredAtUtc,
          // ANAHTAR YÖNTEMDEN TÜRER, İNDEKSTEN DEĞİL. Kısmi hatada aşağıda satırlar kalanlarla
          // yeniden kurulur; indeks tabanlı anahtar kayar ve BAŞARILI ilk tahsilatın anahtarı
          // farklı bir gövdeye denk gelip 409 (KeyReuse) üretirdi. Yöntem parti içinde
          // benzersizdir (merged yöntem bazında toplanır) ve tekrar denemede aynı kalır.
          idempotencyKey: idempotencyKey(saltRef.current, accountId, m, amt, occurredAtUtc, trimmedReference),
        })
        done++
      }
      setOpen(false)
    } catch (e) {
      const base = e instanceof Error ? e.message : 'Tahsilat kaydedilemedi.'
      // Kısmi başarı gizlenmez: kaydedilenler geri alınmaz, kullanıcı ne kaldığını bilmeli.
      setError(
        done > 0
          ? `${base} · ${done}/${merged.size} ödeme kaydedildi; kalanı tekrar deneyin.`
          : base,
      )
      if (done > 0) setRows(Array.from(merged).slice(done).map(([m, amt]) => ({ amount: amt, method: m })))
    } finally {
      setSaving(false)
    }
  }

  const headerNote = description
    ?? (selected
      ? `${selected.customerName || selected.name}${selected.servicePackageName ? ` · ${selected.servicePackageName}` : ''} · ${formatTL(selected.remainingAmount)} kalan borç`
      : 'Cari hesabı olan bir müşteriden ödeme al.')

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger &&
        (trigger ? (
          <DialogTrigger asChild>{trigger}</DialogTrigger>
        ) : (
          <DialogTrigger asChild>
            <button
              type="button"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[12px] bg-gradient-to-r from-[#c85776] to-[#a63e5f] px-3.5 py-2 text-[12px] font-semibold text-white shadow-[0_14px_26px_-16px_rgba(168,62,95,0.9)] transition-transform hover:-translate-y-0.5"
            >
              <Banknote className="h-4 w-4" /> {triggerLabel}
            </button>
          </DialogTrigger>
        ))}
      {/* Kabuk: başlık/alt bar SABİT, gövde kaydırılır. Sabit yükseklik YOK — plan olmayan
          hesapta modal içeriği kadar kalır, uzun planda 92dvh'de durur (footer kırpılmaz). */}
      <DialogContent
        className="flex flex-col overflow-hidden rounded-[26px] border border-[#efe1e7] bg-white !p-0 text-[#352432] shadow-[0_44px_120px_-58px_rgba(120,71,88,0.72)] sm:!max-w-none"
        style={{ width: hasPlan ? 'min(96vw, 900px)' : 'min(96vw, 520px)', maxHeight: '92dvh' }}
      >
        {/* ---- Başlık ---- */}
        <div className="shrink-0 border-b border-[#f2e2e9] bg-gradient-to-r from-[#fff5f8] via-white to-[#fff2f6] px-5 py-4">
          <div className="flex items-start gap-3 pr-10">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border border-[#f0d9e2] bg-white text-[#c05277]">
              <Banknote className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-[16px] font-bold text-[#2b1e29]">{title}</DialogTitle>
              <DialogDescription className="mt-0.5 text-[11.5px] leading-snug text-[#705a66]">
                {headerNote}
              </DialogDescription>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5 lg:flex-row">
          {/* ---- SOL: taksit planı (yalnız taksitli hesapta) ---- */}
          {hasPlan && (
            <div className="flex min-h-0 flex-col lg:w-[44%]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#a3576f]">Taksit planı</span>
                {overdueSum > 0.005 && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                    <AlertTriangle className="h-3 w-3" /> {formatTL(Math.round(overdueSum))} gecikmiş
                  </span>
                )}
              </div>

              <div className="mt-2 space-y-1.5 lg:max-h-[440px] lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
                {dueRows.map((r) => {
                  const i = r.item
                  const applied = preview.applied.get(i.id) ?? 0
                  const isPaid = i.remaining <= 0.005
                  const tone = isPaid ? 'border-emerald-200 bg-emerald-50/60'
                    : applied > 0.005 ? 'border-[#c85776]/45 bg-[#fff1f6] ring-1 ring-[#c85776]/20'
                    : r.isOverdue ? 'border-rose-200 bg-rose-50/50'
                    : 'border-[#f0e0e6] bg-white'
                  const [badge, badgeTone] = isPaid ? ['ÖDENDİ', 'bg-emerald-100 text-emerald-800']
                    : r.isOverdue ? ['GECİKTİ', 'bg-rose-100 text-rose-800']
                    : i.paidAmount > 0.005 ? ['KISMİ', 'bg-amber-100 text-amber-900']
                    : ['BEKLİYOR', 'bg-amber-100 text-amber-900']
                  return (
                    <div key={i.id} className={`rounded-[12px] border px-3 py-2 transition-colors ${tone}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-[10px] font-bold text-[#a3576f] ring-1 ring-[#f0d9e2]">
                            {i.no}
                          </span>
                          <span className="truncate text-[12px] font-medium text-[#4a3a44]">{formatDay(i.dueDate)}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-[13px] font-bold tabular-nums text-[#352432]">{formatTL(i.amount)}</span>
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${badgeTone}`}>{badge}</span>
                        </span>
                      </div>
                      {/* DEVİR: önceki ayların ödenmemiş borcu bu ayın üstüne biner. */}
                      {r.carryIn > 0.005 && (
                        <div className="mt-1 text-[10.5px] font-semibold text-rose-700">
                          +{formatTL(Math.round(r.carryIn))} devir → bu ay {formatTL(Math.round(r.expected))}
                        </div>
                      )}
                      {i.paidAmount > 0.005 && !isPaid && (
                        <div className="mt-1 flex items-center justify-between text-[10.5px]">
                          <span className="font-medium text-emerald-700">✓ Ödendi {formatTL(i.paidAmount)}</span>
                          <span className="font-semibold text-rose-700">Kalan {formatTL(i.remaining)}</span>
                        </div>
                      )}
                      {applied > 0.005 && (
                        <div className="mt-1.5 flex items-center gap-1.5 rounded-[8px] bg-white/70 px-2 py-1 text-[10.5px] font-semibold text-[#a3576f]">
                          <Banknote className="h-3 w-3" />
                          Bu ödemeden {formatTL(applied)} düşecek
                          {applied >= i.remaining - 0.005 ? ' · kapanır' : ' · kısmi kalır'}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ---- SAĞ: ödeme formu ---- */}
          <div className="flex min-h-0 flex-col gap-3 lg:flex-1 lg:overflow-y-auto lg:pl-1">
            {/* Cari hesap seçici (aranabilir) */}
            <div className="relative" ref={pickerRef}>
              <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#7e5f6e]">
                <User className="h-3.5 w-3.5 text-[#c05277]" />
                {saleMode ? 'Hangi satıştan tahsilat?' : 'Cari hesap'}
              </label>
              <button
                type="button"
                onClick={() => setPickerOpen((o) => !o)}
                className="flex w-full items-center justify-between gap-2 rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-left text-[13px] text-[#352432] transition-colors hover:border-[#efbfd0]"
              >
                {selected ? (
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">
                      {saleMode ? saleLabel(selected) : selected.customerName || selected.name}
                    </span>
                    <span className="text-[#705a66]"> · {formatTL(selected.remainingAmount)} kalan</span>
                  </span>
                ) : (
                  <span className="text-[#705a66]">{saleMode ? 'Satış seç…' : 'Cari hesap seç…'}</span>
                )}
                <Search className="h-4 w-4 shrink-0 text-[#a3576f]" />
              </button>
              {/* Tahsilat TEK satışın carisine yazılır; bölüştürme yok. Çok satışlı müşteride
                  bunu yazmazsak "hepsinden düşer" sanılıyor. */}
              {saleMode && (
                <p className="mt-1 text-[10.5px] text-[#705a66]">
                  Bu müşterinin <b>{accounts.length}</b> açık satışı var. Tahsilat yalnız <b>seçili satışın</b> taksitlerine dağıtılır.
                </p>
              )}
              {pickerOpen && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-[14px] border border-[#ead8df] bg-white shadow-[0_24px_60px_-30px_rgba(120,71,88,0.55)]">
                  <div className="flex items-center gap-2 border-b border-[#f2e6ec] px-3 py-2">
                    <Search className="h-3.5 w-3.5 text-[#a3576f]" />
                    <input
                      autoFocus
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={saleMode ? 'Satış / paket ara…' : 'Müşteri adı / telefon ara…'}
                      className="w-full bg-transparent text-[12.5px] text-[#352432] outline-none placeholder:text-[#705a66]"
                    />
                  </div>
                  <div className="max-h-56 overflow-y-auto py-1">
                    {filtered.length === 0 && (
                      <div className="px-3 py-4 text-center text-[11.5px] text-[#705a66]">
                        {saleMode ? 'Satış bulunamadı.' : 'Cari hesap bulunamadı.'}
                      </div>
                    )}
                    {filtered.map((a) => {
                      const overdue = a.hasOverdue && a.remainingAmount > 0.005
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => pickAccount(a)}
                          className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-[#fff2f6] ${a.id === accountId ? 'bg-[#fff1f6]' : ''}`}
                        >
                          <span className="min-w-0">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate font-semibold text-[#352432]">
                                {saleMode ? saleLabel(a) : a.customerName || a.name}
                              </span>
                              {/* Gecikmiş satış listede görünür olmalı: kullanıcı çoğunlukla onu arıyor. */}
                              {overdue && (
                                <span className="shrink-0 rounded-md bg-rose-100 px-1.5 text-[9.5px] font-bold text-rose-700">GECİKMİŞ</span>
                              )}
                            </span>
                            <span className="block truncate text-[10.5px] text-[#705a66]">
                              {saleMode
                                ? (a.nextDueDate ? `Sıradaki vade ${formatDay(a.nextDueDate)}` : 'Vadesiz / peşin')
                                : a.name}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block font-bold tabular-nums text-rose-700">{formatTL(a.remainingAmount)}</span>
                            <span className="block text-[10px] uppercase tracking-wide text-[#705a66]">kalan</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Hızlı tutarlar — taksitli hesapta "bu ay ödenmesi gereken" öne çıkar */}
            {quickAmounts.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold text-[#7e5f6e]">Hazır tutarlar</div>
                <div className="flex flex-wrap gap-1.5">
                  {quickAmounts.map((q) => {
                    const active = Math.abs(totalAmount - q.value) < 0.005 && rows.length === 1
                    return (
                      <button
                        key={q.key}
                        type="button"
                        onClick={() => applyQuickAmount(q.value)}
                        className={`rounded-[10px] border px-2.5 py-1.5 text-left text-[11.5px] font-semibold transition-colors ${
                          active ? 'border-[#c85776] bg-[#c85776] text-white' : 'border-[#ead8df] bg-white text-[#4a3a44] hover:border-[#efbfd0]'
                        }`}
                      >
                        {q.label}
                        <span className={`ml-1.5 tabular-nums ${active ? 'text-white' : 'text-[#a3576f]'}`}>{formatTL(q.value)}</span>
                        {q.hint && <span className={`block text-[10px] font-normal ${active ? 'text-white/85' : 'text-[#705a66]'}`}>{q.hint}</span>}
                      </button>
                    )
                  })}
                </div>
                {hasPlan && overdueSum > 0.005 && (
                  <div className="mt-1.5 text-[10.5px] text-[#705a66]">
                    Ödenmeyen aylar sonraki ayın taksitine eklenir — <b>bu ay ödenmesi gereken {formatTL(Math.round(dueNow))}</b>.
                  </div>
                )}
              </div>
            )}

            {/* Tutar + yöntem — birden çok satır = ödeme kırılımı (ör. 2.000 nakit + 1.000 kart) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[#7e5f6e]">
                  <Wallet className="h-3.5 w-3.5 text-[#c05277]" /> Tutar ve yöntem
                </label>
                {rows.length > 1 && (
                  <span className="text-[11px] font-semibold tabular-nums text-[#7e5f6e]">
                    Toplam {formatTL(totalAmount)}
                  </span>
                )}
              </div>

              {rows.map((row, i) => (
                <div key={i} className="grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-1.5 rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 focus-within:border-[#efbfd0]">
                    <span className="text-[13px] font-semibold text-[#705a66]">₺</span>
                    <input
                      type="number"
                      min={0}
                      value={row.amount}
                      onChange={(e) => setRow(i, { amount: e.target.value === '' ? '' : Number(e.target.value) })}
                      className="w-full bg-transparent text-[13px] font-semibold tabular-nums text-[#352432] outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={row.method}
                      onChange={(e) => setRow(i, { method: e.target.value })}
                      className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none transition-colors focus:border-[#efbfd0]"
                    >
                      {METHOD_OPTIONS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        aria-label="Ödeme satırını kaldır"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[#ead8df] bg-white text-[#705a66] transition-colors hover:border-rose-200 hover:text-rose-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {rows.length < METHOD_OPTIONS.length && (
                <button
                  type="button"
                  onClick={addRow}
                  className="inline-flex items-center gap-1.5 rounded-[10px] border border-dashed border-[#efbfd0] bg-[#fffafc] px-2.5 py-1.5 text-[11px] font-semibold text-[#b14d6c] transition-colors hover:bg-[#fff1f6]"
                >
                  <Plus className="h-3.5 w-3.5" /> Ödeme yöntemi ekle
                  {unallocated > 0 && <span className="font-normal text-[#705a66]">· {formatTL(unallocated)} kaldı</span>}
                </button>
              )}
            </div>

            {/* Tarih + referans */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#7e5f6e]">
                  <CalendarDays className="h-3.5 w-3.5 text-[#c05277]" /> Tarih
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none transition-colors focus:border-[#efbfd0]"
                />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#7e5f6e]">
                  <FileText className="h-3.5 w-3.5 text-[#c05277]" /> Dekont / referans
                </label>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Opsiyonel"
                  className="w-full rounded-[12px] border border-[#ead8df] bg-white px-3 py-2.5 text-[13px] text-[#352432] outline-none transition-colors focus:border-[#efbfd0] placeholder:text-[#705a66]"
                />
              </div>
            </div>

            {/* Canlı dağıtım özeti — tahsilat vade sırasıyla dağıtılır, kullanıcı ne olacağını görsün */}
            {hasPlan && (
              <div className="rounded-[14px] border border-[#ead8df] bg-[#fffafc] p-3">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#a3576f]">Bu ödeme ne yapacak?</div>
                <ul className="mt-1.5 space-y-1 text-[11.5px] text-[#4a3a44]">
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    {preview.closes > 0 ? <><b>{preview.closes} taksit</b> tamamen kapanır</> : 'Hiçbir taksit tamamen kapanmaz'}
                  </li>
                  {preview.partialOf && (
                    <li className="flex items-center gap-1.5">
                      <Banknote className="h-3.5 w-3.5 shrink-0 text-sky-600" />
                      #{preview.partialOf.no} taksite <b>{formatTL(preview.partialOf.amount)}</b> kısmi düşer
                    </li>
                  )}
                  {preview.leftover > 0.005 && (
                    <li className="flex items-center gap-1.5">
                      <Wallet className="h-3.5 w-3.5 shrink-0 text-[#c05277]" />
                      <b>{formatTL(preview.leftover)}</b> fazla ödeme (kredi) olarak kalır
                    </li>
                  )}
                  <li className="text-[10.5px] text-[#705a66]">
                    Tahsilat en eski vadeli taksitten başlayarak dağıtılır.
                  </li>
                </ul>
              </div>
            )}

            {error && (
              <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] font-medium text-rose-600">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* ---- Alt bar ---- */}
        <div className="shrink-0 border-t border-[#f2e2e9] bg-white px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] text-[#705a66]">
              Kalan toplam borç <b className="text-[#352432]">{formatTL(selected?.remainingAmount ?? 0)}</b>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex min-h-10 items-center rounded-[12px] border border-[#ead8df] bg-white px-4 py-2 text-[12px] font-semibold text-[#7e5f6e] transition-colors hover:border-[#efbfd0]"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={saving}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[12px] bg-gradient-to-r from-[#c85776] to-[#a63e5f] px-4 py-2 text-[12px] font-semibold text-white shadow-[0_14px_26px_-16px_rgba(168,62,95,0.9)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {formatTL(totalAmount)} tahsil et
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
