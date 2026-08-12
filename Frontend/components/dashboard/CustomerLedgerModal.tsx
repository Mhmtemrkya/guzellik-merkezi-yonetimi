'use client'

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, Banknote, CalendarClock, CalendarDays, ChevronRight, CreditCard, Layers,
  Package, Phone, Receipt, TrendingUp, Wallet, X,
} from 'lucide-react'
import ModalPortal from '@/components/dashboard/ModalPortal'
import PaymentScheduleGrid from '@/components/dashboard/PaymentScheduleGrid'
import { formatTL, paymentMethodLabel } from '@/lib/apiMappers'
import { activeInstallments, buildMonthlySchedule, type CustomerAccountGroup } from '@/lib/accountGrouping'
import type { CancelledSale, CustomerAccount } from '@/lib/types'

/**
 * MÜŞTERİ CARİ DEFTERİ — Ön Muhasebe tablosundan açılan TAM SAYFA modal.
 *
 * Liste satırı müşteridir; bu modal o müşterinin BÜTÜN satışlarını tek yerde toplar:
 *  · Ay ay taksit takvimi (Excel ızgarası; yeşil ödendi / kırmızı gecikmiş)
 *  · Satış satırları — her biri kendi cari kartı, tahsilat oraya yazılır
 *  · Birleşik ekstre (tüm satışların tahsilatları, tarih sırasıyla)
 *
 * TAHSİLAT HÂLÂ SATIŞ BAZINDA: gruplama yalnız GÖRÜNÜMdür. "Tahsilat al" bir satış satırından
 * açılır ki para doğru carinin taksitlerine dağıtılsın (sunucu tahsilatı hesaba yazar, vade
 * sırasıyla dağıtır). Müşteri düzeyinde tek bir "hepsini öde" düğmesi, parayı hangi satışa
 * yazacağını bilemezdi.
 */

type TabKey = 'schedule' | 'sales' | 'ledger'

const TABS: { key: TabKey; label: string; icon: typeof CalendarDays }[] = [
  { key: 'schedule', label: 'Taksit Takvimi', icon: CalendarDays },
  { key: 'sales', label: 'Satışlar', icon: Package },
  { key: 'ledger', label: 'Ekstre', icon: Receipt },
]

const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

function fmtDay(iso: string | null | undefined): string {
  const s = (iso || '').slice(0, 10)
  const [y, m, d] = s.split('-')
  if (!y || !m || !d) return '—'
  return `${d} ${MONTHS_SHORT[Number(m) - 1] ?? ''} ${y}`
}

function todayIsoLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function CustomerLedgerModal({
  group,
  cancelledSales = [],
  open,
  onClose,
  onCollect,
  onCollectAll,
  onOpenSale,
  onOpenSalesWorkspace,
}: {
  group: CustomerAccountGroup | null
  /**
   * Bu müşterinin İPTAL arşivi. İptal edilen satışın cari/tahsilat satırları canlı tablodan
   * SİLİNİR (arşive taşınır), bu yüzden `group.accounts` içinde bulunmazlar — parası
   * (tahsil edilen − iade) defterden tamamen kaybolurdu.
   */
  cancelledSales?: CancelledSale[]
  open: boolean
  onClose: () => void
  /** Tahsilat — SEÇİLEN satışın carisine yazılır (tek modal: aylık/genel ayrımı yok). */
  onCollect: (accountId: string) => void
  /** "Tümünden tahsilat al" — modal Tümü seçili açılır, para satışlara vade sırasıyla bölünür. */
  onCollectAll: () => void
  /** Satışın kendi detay modali (ekstre, taksit planı, seans). */
  onOpenSale: (accountId: string) => void
  /** Satış yönetimi (geçmiş satış ekle / iptal). */
  onOpenSalesWorkspace: () => void
}) {
  const [tab, setTab] = useState<TabKey>('schedule')

  useEffect(() => { if (open) setTab('schedule') }, [open, group?.customerId])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])

  const todayIso = todayIsoLocal()
  const cells = useMemo(() => (group ? buildMonthlySchedule(group, todayIso) : []), [group, todayIso])

  /**
   * Birleşik ekstre: tüm satışların tahsilatları tek listede (hangi satıştan geldiği yazılı).
   *
   * İPTAL EDİLEN SATIŞIN PARASI DA BURADA: iptalde tahsilat satırları canlı tablodan silinip
   * arşive taşınır, bu yüzden `accounts` üzerinden hiç görünmezdi — müşteri ödeme yapmış ama
   * ekstre boş çıkıyordu. Arşiv kaydı tek satırda özetlenir (tahsil edilen ve varsa iade).
   */
  const ledger = useMemo(() => {
    if (!group) return []
    const rows: { ts: number; date: string; sale: string; method: string; amount: number; kind: 'in' | 'refund' }[] = []
    for (const a of group.accounts) {
      for (const p of a.payments || []) {
        rows.push({
          ts: Date.parse(p.occurredAtUtc || '') || 0,
          date: (p.occurredAtUtc || '').slice(0, 10),
          sale: a.servicePackageName || a.name,
          method: paymentMethodLabel(p.method),
          amount: p.amount,
          kind: 'in',
        })
      }
    }
    for (const c of cancelledSales) {
      // GERÇEK TAHSİLAT SATIRLARI (arşivden): tarih ve yöntem korunur. Tek sentetik satıra
      // indirmek ödeme günlerini/yöntemlerini siliyor ve "2 tahsilat · toplam 0" gibi çelişkili
      // özetler üretiyordu (tutar arşiv toplamından, adet canlı listeden geliyordu).
      if (c.payments.length > 0) {
        for (const p of c.payments) {
          rows.push({
            ts: Date.parse(p.occurredAtUtc || '') || 0,
            date: (p.occurredAtUtc || '').slice(0, 10),
            sale: `${c.name} · İPTAL`,
            method: paymentMethodLabel(p.method),
            amount: p.amount,
            kind: 'in',
          })
        }
      } else if (c.collectedAmount > 0.005) {
        // Eski arşiv kaydı (tahsilat kopyası yok) — tek satırda özetlenir. YÖNTEM SÜTUNUNA
        // yöntem olmayan bir metin ("iptal edilen satış") yazılmaz: satışın durumu zaten
        // başlıkta yazıyor, kanal ise gerçekten BİLİNMİYOR.
        rows.push({
          ts: Date.parse(c.cancelledAtUtc || c.soldAtUtc || '') || 0,
          date: (c.soldAtUtc || c.cancelledAtUtc || '').slice(0, 10),
          sale: `${c.name} · İPTAL`,
          method: paymentMethodLabel(''),
          amount: c.collectedAmount,
          kind: 'in',
        })
      }
      // GERÇEK İADE SATIRLARI: paranın çıktığı KANAL (nakit/kart/havale) gösterilir. Burası
      // "müşteriye geri ödendi" diye sentetik bir metin yazıyordu; kart iadesi ile nakit iade
      // ekstrede ayırt edilemiyor, kasa kırılımı tutmuyordu. Tahsilat tarafındaki desenin eşi.
      if (c.refunds.length > 0) {
        for (const r of c.refunds) {
          rows.push({
            ts: Date.parse(r.refundedAtUtc || '') || 0,
            date: (r.refundedAtUtc || '').slice(0, 10),
            sale: `${c.name} · İADE`,
            method: paymentMethodLabel(r.method),
            amount: r.amount,
            kind: 'refund',
          })
        }
      } else if (c.refundedAmount > 0.005) {
        // Eski arşiv kaydı (iade satırı yok) — kanal BİLİNMİYOR; uydurma yapılmaz.
        rows.push({
          ts: Date.parse(c.cancelledAtUtc || '') || 0,
          date: (c.cancelledAtUtc || '').slice(0, 10),
          sale: `${c.name} · İADE`,
          method: paymentMethodLabel(''),
          amount: c.refundedAmount,
          kind: 'refund',
        })
      }
    }
    return rows.sort((x, y) => y.ts - x.ts)
  }, [group, cancelledSales])

  /**
   * EKSTRE TOPLAMLARI — tablonun ALTINDAKİ toplam satırı (kullanıcı isteği).
   * Satırların KENDİSİNDEN türetilir: özet ile satırlar farklı kaynaktan gelince
   * "2 tahsilat · toplam 0" gibi çelişkiler çıkıyordu.
   */
  const ledgerTotals = useMemo(() => {
    const collected = ledger.filter((r) => r.kind === 'in').reduce((s, r) => s + r.amount, 0)
    const refunded = ledger.filter((r) => r.kind === 'refund').reduce((s, r) => s + r.amount, 0)
    return { collected, refunded, net: collected - refunded }
  }, [ledger])

  /** İptalden KURUMDA KALAN para (tahsil − iade) — KPI'a eklenir, yoksa sıfır görünürdü. */
  const cancelledSummary = useMemo(() => ({
    count: cancelledSales.length,
    retained: cancelledSales.reduce((s, c) => s + Math.max(0, c.retainedAmount), 0),
    refunded: cancelledSales.reduce((s, c) => s + Math.max(0, c.refundedAmount), 0),
    // İptal edilen satışların TUTARI: "Toplam Satış" kartı da bunu saymalı, yoksa yalnız
    // "Tahsil Edilen"e arşiv eklendiği için iki kart birbirini yalanlıyordu.
    total: cancelledSales.reduce((s, c) => s + Math.max(0, c.totalAmount), 0),
  }), [cancelledSales])

  if (!group) return null

  /** Açık borcu olan satış adedi — "Toplam" satırı yalnız birden çoksa anlamlı. */
  const openSaleCount = group.accounts.filter((a) => a.remainingAmount > 0.005).length
  const initials = group.customerName.trim().split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toLocaleUpperCase('tr')
  const paidPct = group.totalAmount > 0 ? Math.min(100, Math.round((group.paidAmount / group.totalAmount) * 100)) : 0

  return (
    <ModalPortal>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[122] flex items-stretch justify-center bg-[#2a141f]/50 p-0 backdrop-blur-[3px] sm:p-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={`${group.customerName} cari defteri`}
              initial={{ opacity: 0, scale: 0.98, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.99, y: 6 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              /* TAM SAYFA: taksit takvimi yatay bir şerit; dar modalde ayların yarısı
                 görünmüyordu. Kenarlarda ince boşluk bırakılır ki "katman" hissi kalsın. */
              className="relative flex h-full w-full flex-col overflow-hidden bg-[#fbf4f7] shadow-[0_40px_120px_-50px_rgba(90,40,60,0.6)] sm:rounded-[22px]"
            >
              {/* ---------------- BAŞLIK ---------------- */}
              <header className="relative shrink-0 border-b border-[#EAD8DF] bg-gradient-to-br from-white via-[#fff7fa] to-[#ffeef4] px-4 pb-0 pt-3.5 sm:px-6">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Kapat"
                  className="absolute right-3.5 top-3.5 z-20 grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-[#EAD8DF] bg-white text-[#74616A] transition-colors hover:bg-[#F6DFE6] hover:text-[#A5556E]"
                >
                  <X className="h-4 w-4" />
                </button>

                <div className="flex flex-col gap-3 pr-12 xl:flex-row xl:items-center xl:justify-between xl:gap-5">
                  <div className="flex min-w-0 items-center gap-3.5">
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#3a1a2a] to-[#A5556E] font-display text-lg text-white">
                      {initials || '—'}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-display text-xl leading-tight tracking-tight text-[#2A2027] sm:text-2xl">{group.customerName}</h2>
                        {group.hasOverdue && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10.5px] font-bold text-rose-700">
                            <AlertTriangle className="h-3 w-3" /> Gecikmiş {formatTL(Math.round(group.overdueAmount))}
                          </span>
                        )}
                        {group.hasInstallmentPlan && (
                          <span className="rounded-full border border-[#d9b3e8] bg-[#f8f0fc] px-2 py-0.5 text-[10.5px] font-bold text-[#6d4187]">Taksitli</span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[#3E343A]">
                        {group.customerPhone && (
                          <a href={`tel:${group.customerPhone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-[#F6DFE6] hover:text-[#A5556E]">
                            <Phone className="h-3.5 w-3.5 text-[#A5556E]" /> {group.customerPhone}
                          </a>
                        )}
                        <span className="flex items-center gap-1.5 text-[#74616A]">
                          <Package className="h-3.5 w-3.5 text-[#A5556E]" /> {group.saleCount} satış
                        </span>
                        {group.nextDueDate && group.remainingAmount > 0.005 && (
                          <span className="flex items-center gap-1.5 text-[#74616A]">
                            <CalendarClock className="h-3.5 w-3.5 text-[#A5556E]" /> Sıradaki vade {fmtDay(group.nextDueDate)} · <b className="text-[#3E343A]">{formatTL(group.nextDueAmount)}</b>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* KPI şeridi */}
                  <div className="grid w-full shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 xl:w-auto">
                    <Kpi
                      label="Toplam Satış"
                      /* İPTAL EDİLENLER DE SAYILIR (bkz. cancelledSummary.total): "Tahsil Edilen"
                         arşivi sayarken bu kart saymazsa çelişki çıkar. */
                      value={formatTL(Math.round(group.totalAmount + cancelledSummary.total))}
                      icon={TrendingUp}
                      sub={cancelledSummary.count > 0 ? `${cancelledSummary.count} iptal dahil` : undefined}
                    />
                    <Kpi
                      label="Tahsil Edilen"
                      /* İPTAL EDİLEN SATIŞTAN KALAN PARA DA SAYILIR: iptalde satırlar arşive
                         taşındığı için canlı özet onu görmez, ama para fiilen kasada kaldı. */
                      value={formatTL(Math.round(group.paidAmount + cancelledSummary.retained))}
                      icon={Wallet}
                      tone="text-emerald-700"
                      sub={cancelledSummary.retained > 0.5
                        ? `${formatTL(Math.round(cancelledSummary.retained))} iptalden kaldı`
                        : `satışın %${paidPct}'i`}
                    />
                    <Kpi
                      label="Kalan Borç"
                      value={formatTL(Math.round(group.remainingAmount))}
                      icon={CreditCard}
                      tone={group.remainingAmount > 0.005 ? 'text-rose-700' : 'text-emerald-700'}
                      sub={group.remainingAmount > 0.005 ? undefined : 'borç yok'}
                    />
                    <Kpi label="Kalan Seans" value={String(group.sessionsRemaining)} icon={CalendarDays} sub={group.sessionsTotal > 0 ? `${group.sessionsTotal} seanslık` : 'seanssız'} />
                  </div>
                </div>

                <div role="tablist" aria-label="Cari defteri sekmeleri" className="relative mt-3 flex gap-1 overflow-x-auto">
                  {TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      role="tab"
                      aria-selected={tab === t.key}
                      onClick={() => setTab(t.key)}
                      className={`relative flex shrink-0 cursor-pointer items-center gap-1.5 rounded-t-[10px] px-3.5 py-2.5 text-[12.5px] font-semibold transition-colors ${
                        tab === t.key ? 'text-[#A5556E]' : 'text-[#74616A] hover:text-[#2A2027]'
                      }`}
                    >
                      <t.icon className="h-3.5 w-3.5" /> {t.label}
                      {t.key === 'sales' && (
                        <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums ${tab === t.key ? 'bg-[#A5556E] text-white' : 'bg-[#f3e9ed] text-[#74616A]'}`}>
                          {group.saleCount}
                        </span>
                      )}
                      {tab === t.key && <motion.span layoutId="clm-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[#A5556E]" />}
                    </button>
                  ))}
                </div>
              </header>

              {/* ---------------- GÖVDE ---------------- */}
              <div className="min-h-0 flex-1 overflow-y-auto p-3.5 sm:p-5">
                {tab === 'schedule' && (
                  <Section
                    title="Aylık Taksit Takvimi"
                    icon={CalendarDays}
                    /* KAPSAM UYARISI: peşinat ve peşin satış taksit satırı üretmez, bu yüzden
                       takvim toplamı üstteki "Tahsil Edilen" KPI'ından KÜÇÜK olabilir. */
                    hint="Yalnız TAKSİTLER — peşinat ve peşin satışlar bu takvimde yer almaz. Yeşil ödendi · sarı bekliyor · kırmızı gecikti. Ödenmeyen ay bir sonraki ayın taksitine devreder."
                  >
                    <PaymentScheduleGrid cells={cells} todayKey={todayIso.slice(0, 7)} />
                  </Section>
                )}

                {tab === 'sales' && (
                  <div className="space-y-2.5">
                    {/* TOPLAM — satış satırlarının üstünde, müşterinin bütün satışlarının özeti.
                        Buradan alınan tahsilat TEK satışa değil, tümüne vade sırasıyla bölünür
                        (modal "Tümü" seçili açılır). Tek satışı olan müşteride gösterilmez:
                        toplam satırı ile tek satış satırı birebir aynı rakamları yazardı. */}
                    {openSaleCount > 1 && (
                      <div className="rounded-[14px] border border-[#8C4460]/35 bg-gradient-to-br from-[#fff1f6] to-white p-3.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#8C4460]">
                              <Layers className="h-3.5 w-3.5" /> Toplam · {group.saleCount} satış
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[#3E343A]">
                              <span>Satış <b className="text-[#2A2027]">{formatTL(Math.round(group.totalAmount))}</b></span>
                              <span>Tahsil <b className="text-emerald-700">{formatTL(Math.round(group.paidAmount))}</b></span>
                              {group.hasOverdue && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-1.5 py-0.5 text-[10.5px] font-bold text-rose-700">
                                  <AlertTriangle className="h-3 w-3" /> {formatTL(Math.round(group.overdueAmount))} gecikmiş
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="font-display text-[19px] tabular-nums text-[#A5556E]">
                              {formatTL(Math.round(group.remainingAmount))}
                            </div>
                            <div className="text-[9.5px] font-mono uppercase tracking-wide text-[#74616A]">toplam kalan</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={onCollectAll}
                          className="mt-2.5 inline-flex min-h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-[11px] bg-gradient-to-r from-[#A5556E] to-[#8C4460] px-3 text-[12px] font-semibold text-white transition-transform hover:-translate-y-0.5"
                        >
                          <Banknote className="h-4 w-4" /> Tümünden tahsilat al
                        </button>
                      </div>
                    )}

                    {group.accounts.map((a) => (
                      <SaleRow
                        key={a.id}
                        account={a}
                        onCollect={() => onCollect(a.id)}
                        onOpen={() => onOpenSale(a.id)}
                      />
                    ))}
                    {/* İPTAL EDİLEN SATIŞLAR: canlı listede yoklar (arşive taşındılar) ama
                        paraları defterde görünmeli — "neden tahsilat var, satış yok" sorusu
                        burada yanıtlanır. */}
                    {cancelledSales.length > 0 && (
                      <div className="rounded-[14px] border border-rose-200 bg-rose-50/40 p-3">
                        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-rose-700">
                          <AlertTriangle className="h-3.5 w-3.5" /> İptal edilen satışlar ({cancelledSales.length})
                        </div>
                        <div className="space-y-1.5">
                          {cancelledSales.map((c) => (
                            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-white px-3 py-2 text-[12px]">
                              <span className="min-w-0">
                                <span className="block truncate font-semibold text-[#2A2027]">{c.name}</span>
                                <span className="block text-[11px] text-[#74616A]">
                                  {fmtDay(c.cancelledAtUtc)} · iptal edildi
                                  {c.cancellationReason ? ` · ${c.cancellationReason}` : ''}
                                </span>
                              </span>
                              <span className="shrink-0 text-right">
                                <span className="block font-semibold tabular-nums text-emerald-700">
                                  {formatTL(Math.round(c.retainedAmount))} kurumda kaldı
                                </span>
                                {c.refundedAmount > 0.005 && (
                                  <span className="block text-[11px] tabular-nums text-rose-700">
                                    {formatTL(Math.round(c.refundedAmount))} iade edildi
                                  </span>
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={onOpenSalesWorkspace}
                      className="flex w-full cursor-pointer items-center justify-between rounded-[14px] border border-dashed border-[#EAD8DF] bg-[#F7F6F6] px-4 py-3 text-[12.5px] font-semibold text-[#8C4460] transition-colors hover:border-[#BE7690] hover:bg-[#fff5f8]"
                    >
                      <span className="flex items-center gap-2"><Package className="h-4 w-4" /> Satış yönetimi — geçmiş satış ekle, satış iptal et</span>
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {tab === 'ledger' && (
                  <Section
                    title="Tahsilat Ekstresi"
                    icon={Receipt}
                    /* ÖZET SATIRIN KENDİSİNDEN TÜRETİLİR: adet canlı listeden, tutar arşivden
                       gelince "2 tahsilat · toplam 0" gibi çelişkiler çıkıyordu. */
                    hint={`${ledger.length} hareket · net ${formatTL(Math.round(ledgerTotals.net))}`}
                  >
                    {ledger.length === 0 ? (
                      <div className="rounded-[12px] border border-dashed border-[#EAD8DF] bg-[#F7F6F6] px-4 py-8 text-center text-[12px] text-[#74616A]">
                        Bu müşteriden henüz tahsilat alınmamış.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[560px] text-[12.5px]">
                          <thead>
                            <tr className="border-b border-[#f4e8ee] text-left text-[10px] font-bold uppercase tracking-[0.08em] text-[#8C4460]">
                              <th className="py-2 pr-3">Tarih</th>
                              <th className="py-2 pr-3">Satış</th>
                              <th className="py-2 pr-3">Yöntem</th>
                              <th className="py-2 text-right">Tutar</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ledger.map((r, i) => (
                              <tr key={i} className="border-b border-[#f8f0f4] last:border-b-0">
                                <td className="py-2 pr-3 tabular-nums text-[#3E343A]">{fmtDay(r.date)}</td>
                                <td className="max-w-[240px] truncate py-2 pr-3 text-[#2A2027]">{r.sale}</td>
                                <td className="py-2 pr-3 text-[#74616A]">{r.method}</td>
                                <td className={`py-2 text-right font-semibold tabular-nums ${r.kind === 'refund' ? 'text-rose-700' : 'text-emerald-700'}`}>
                                  {r.kind === 'refund' ? '−' : '+'}{formatTL(r.amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          {/* TOPLAM SATIRI: tahsilat − iade = net. Excel'deki toplam bandı gibi
                              tablonun altında sabit durur. */}
                          <tfoot>
                            <tr className="border-t-2 border-[#f0dce5] bg-[#fff7fa] text-[12px] font-bold text-[#2A2027]">
                              <td className="py-2 pr-3">TOPLAM</td>
                              <td className="py-2 pr-3 text-[11px] font-semibold text-[#74616A]">{ledger.length} hareket</td>
                              <td className="py-2 pr-3 text-[11px] font-semibold text-[#74616A]">
                                {ledgerTotals.refunded > 0.005
                                  ? `Tahsilat ${formatTL(Math.round(ledgerTotals.collected))} · İade ${formatTL(Math.round(ledgerTotals.refunded))}`
                                  : 'Tahsilat'}
                              </td>
                              <td className={`py-2 text-right font-display text-[15px] tabular-nums ${ledgerTotals.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                {formatTL(Math.round(ledgerTotals.net))}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </Section>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ModalPortal>
  )
}

function Kpi({ label, value, icon: Icon, tone, sub }: { label: string; value: string; icon: typeof Wallet; tone?: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-[14px] border border-[#EAD8DF] bg-white/80 px-3 py-2 xl:min-w-[128px]">
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#74616A]">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className={`mt-0.5 truncate font-display text-lg tracking-tight tabular-nums ${tone || 'text-[#2A2027]'}`}>{value}</div>
      {sub && <div className="truncate text-[10.5px] text-[#74616A]">{sub}</div>}
    </div>
  )
}

function Section({ title, icon: Icon, hint, children }: { title: string; icon: typeof Wallet; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[16px] border border-[#EAD8DF] bg-white p-4">
      <div className="mb-3">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#A5556E]">
          <Icon className="h-3.5 w-3.5" /> {title}
        </div>
        {hint && <div className="mt-0.5 text-[11px] text-[#74616A]">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

/** Tek satış satırı — kendi cari kartı; tahsilat buradan alınır (para doğru satışa yazılsın). */
function SaleRow({
  account,
  onCollect,
  onOpen,
}: {
  account: CustomerAccount
  onCollect: () => void
  onOpen: () => void
}) {
  const insts = activeInstallments(account)
  const isInstallment = insts.length > 1
  const isOpen = account.remainingAmount > 0.005
  const paidCount = insts.filter((i) => i.remaining <= 0.005).length
  const pct = account.totalAmount > 0 ? Math.min(100, Math.round((account.paidAmount / account.totalAmount) * 100)) : 0

  return (
    <div className={`rounded-[14px] border bg-white p-3.5 ${account.hasOverdue ? 'border-rose-200' : isOpen ? 'border-[#EAD8DF]' : 'border-emerald-200/70'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 cursor-pointer text-left">
          <div className="truncate text-[13.5px] font-semibold text-[#2A2027]">{account.servicePackageName || account.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#74616A]">
            <span>{fmtDay(account.soldAtUtc || account.createdAtUtc)}</span>
            <span className={`rounded-md px-1.5 py-0.5 text-[9.5px] font-bold ${isInstallment ? 'bg-[#f3e8ff] text-[#7c3aed]' : 'bg-[#e0f2fe] text-[#0369a1]'}`}>
              {isInstallment ? `TAKSİTLİ · ${insts.length} AY` : 'PEŞİN'}
            </span>
            {account.hasOverdue && <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[9.5px] font-bold text-rose-700">GECİKMİŞ</span>}
            {account.sessionsTotal > 0 && <span className="tabular-nums">{account.sessionsRemaining} seans kaldı</span>}
          </div>
        </button>
        <div className="shrink-0 text-right">
          <div className={`font-display text-[17px] tabular-nums ${isOpen ? 'text-[#A5556E]' : 'text-emerald-700'}`}>
            {formatTL(account.remainingAmount)}
          </div>
          <div className="text-[9.5px] font-mono uppercase tracking-wide text-[#74616A]">{isOpen ? 'kalan borç' : 'kapandı'}</div>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f7e9ee]">
          <span className="block h-full rounded-full bg-gradient-to-r from-[#e0617f] to-[#f3a3bf]" style={{ width: `${pct}%` }} />
        </span>
        <span className="shrink-0 text-[10px] font-semibold text-[#74616A]">
          {isInstallment ? `${paidCount}/${insts.length} taksit` : `%${pct} ödendi`}
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {/* TEK BUTON: modal taksitli satışta planı ve "bu ay ödenmesi gereken"i kendisi açar. */}
        {isOpen && (
          <button type="button" onClick={onCollect} className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-[10px] bg-gradient-to-r from-[#A5556E] to-[#8C4460] px-2.5 text-[11px] font-semibold text-white transition-transform hover:-translate-y-0.5">
            <Banknote className="h-3.5 w-3.5" /> Tahsilat al
          </button>
        )}
        <button type="button" onClick={onOpen} className="ml-auto inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-[10px] border border-[#EAD8DF] bg-white px-2.5 text-[11px] font-semibold text-[#3E343A] transition-colors hover:border-[#BE7690]">
          Detay <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
