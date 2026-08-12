'use client'

import { useEffect, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Package, Wallet, X, XCircle } from 'lucide-react'
import ModalPortal from '@/components/dashboard/ModalPortal'
import { formatTL } from '@/lib/apiMappers'
import type { CustomerAccount } from '@/lib/types'

/**
 * "Paket & Hizmet Satışları" modalı — müşteri kartının içinden açılır.
 *
 * NEDEN AYRI MODAL: satış listesi müşteri kartının sağ sütununa sığmıyordu; satır başına
 * tarih/satan personel/seans/ödeme bilgisi olan liste dar sütunda okunmuyordu. Artık kartta
 * yalnız özet durur, tam liste bu geniş modalda açılır (satış detayı ve geçmiş satış modalleri
 * bunun da üstünde açılmaya devam eder — bkz. ModalPortal katman ölçeği).
 */

export interface CustomerSalesSummary {
  /** İptaller dahil toplam satış kaydı. */
  count: number
  active: number
  completed: number
  cancelled: number
  /** Aşağıdaki tutarlar İPTAL EDİLEN satışları saymaz — iptal, ciroyu şişirmemeli. */
  total: number
  paid: number
  remaining: number
  sessionsTotal: number
  sessionsUsed: number
  /** En son satışın adı + tarihi (kartta "son satış" satırı için). */
  lastSaleName: string | null
  lastSaleAtUtc: string | null
}

/** Müşterinin satış kayıtlarını tek özete indirger (kart rozeti + modal başlığı aynı kaynağı kullanır). */
export function summarizeCustomerSales(accounts: CustomerAccount[]): CustomerSalesSummary {
  const s: CustomerSalesSummary = {
    count: accounts.length,
    active: 0,
    completed: 0,
    cancelled: 0,
    total: 0,
    paid: 0,
    remaining: 0,
    sessionsTotal: 0,
    sessionsUsed: 0,
    lastSaleName: null,
    lastSaleAtUtc: null,
  }
  for (const a of accounts) {
    if (a.saleStatus === 'Cancelled') {
      s.cancelled += 1
      continue
    }
    if (a.saleStatus === 'Active') s.active += 1
    else s.completed += 1
    s.total += a.totalAmount
    s.paid += a.paidAmount
    s.remaining += Math.max(0, a.remainingAmount)
    s.sessionsTotal += a.sessionsTotal
    s.sessionsUsed += a.sessionsUsed
    if (!s.lastSaleAtUtc || (a.soldAtUtc || '') > s.lastSaleAtUtc) {
      s.lastSaleAtUtc = a.soldAtUtc || null
      s.lastSaleName = a.name
    }
  }
  return s
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-[14px] border border-[#EAD8DF] bg-white/85 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#74616A]">{label}</div>
      <div className={`mt-0.5 font-display text-[17px] leading-tight tracking-tight tabular-nums ${tone || 'text-[#2A2027]'}`}>{value}</div>
    </div>
  )
}

export default function CustomerSalesModal({
  open,
  onClose,
  customerName,
  summary,
  children,
}: {
  open: boolean
  onClose: () => void
  customerName: string
  summary: CustomerSalesSummary
  /** Satış listesi paneli (`CustomerSalesPanel`, `variant="flush"`). */
  children: ReactNode
}) {
  // Esc bu modalı kapatır; müşteri kartı açık kalır (kart kendi Esc'ini bu açıkken duraklatır).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const paidPct = summary.total > 0 ? Math.min(100, Math.round((summary.paid / summary.total) * 100)) : 0

  return (
    <ModalPortal>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[125] flex items-start justify-center overflow-y-auto p-2 sm:items-center sm:p-4 lg:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <button type="button" aria-label="Kapat" onClick={onClose} className="absolute inset-0 cursor-default bg-[#2a141f]/50 backdrop-blur-[3px]" />

            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={`${customerName} paket ve hizmet satışları`}
              initial={{ opacity: 0, scale: 0.97, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 6 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="relative z-10 my-auto flex max-h-[95dvh] w-full max-w-[1180px] flex-col overflow-hidden rounded-[22px] border border-[#EAD8DF] bg-[#fbf4f7] shadow-[0_40px_120px_-50px_rgba(90,40,60,0.65)] sm:rounded-[26px]"
            >
              {/* HEADER */}
              <header className="relative shrink-0 overflow-hidden border-b border-[#EAD8DF] bg-gradient-to-br from-white via-[#fff7fa] to-[#ffeef4] px-4 py-3.5 sm:px-6 sm:py-4">
                <span aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-[#f0aac2]/25 blur-3xl" />
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Kapat"
                  className="absolute right-3.5 top-3.5 z-20 grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-[#EAD8DF] bg-white text-[#74616A] shadow-sm transition-colors hover:bg-[#F6DFE6] hover:text-[#A5556E]"
                >
                  <X className="h-4 w-4" />
                </button>

                <div className="relative flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:pr-12">
                  <div className="flex min-w-0 items-center gap-3 pr-10 lg:pr-0">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border border-[#BE7690] bg-[#A5556E] text-white">
                      <Package className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate font-display text-[19px] leading-tight tracking-tight text-[#2A2027] sm:text-[21px]">Paket &amp; Hizmet Satışları</h2>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[#74616A]">
                        <span className="truncate font-semibold text-[#3E343A]">{customerName}</span>
                        <span className="text-[#c9b3bd]">·</span>
                        <span className="tabular-nums">{summary.count} satış kaydı</span>
                      </div>
                    </div>
                  </div>

                  {/* Durum rozetleri */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                      <Package className="h-3 w-3" /> Devam eden <span className="tabular-nums">{summary.active}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">
                      <CheckCircle2 className="h-3 w-3" /> Biten <span className="tabular-nums">{summary.completed}</span>
                    </span>
                    {summary.cancelled > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-600">
                        <XCircle className="h-3 w-3" /> İptal <span className="tabular-nums">{summary.cancelled}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Özet şerit — iptaller hariç tutarlar */}
                <div className="relative mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <StatTile label="Toplam Tutar" value={formatTL(Math.round(summary.total))} />
                  <StatTile label="Tahsil Edilen" value={formatTL(Math.round(summary.paid))} tone="text-emerald-700" />
                  <StatTile label="Kalan Borç" value={formatTL(Math.round(summary.remaining))} tone={summary.remaining > 0.5 ? 'text-rose-700' : undefined} />
                  <StatTile
                    label="Seans"
                    value={summary.sessionsTotal > 0 ? `${summary.sessionsUsed}/${summary.sessionsTotal}` : '—'}
                  />
                </div>

                {/* Tahsilat ilerlemesi */}
                {summary.total > 0 && (
                  <div className="relative mt-2.5 flex items-center gap-2.5">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f6e3ea]">
                      <span
                        className={`block h-full rounded-full ${summary.remaining > 0.5 ? 'bg-[linear-gradient(90deg,#e78ba8,#c05277)]' : 'bg-[linear-gradient(90deg,#7fc7ad,#2c7d63)]'}`}
                        style={{ width: `${Math.max(3, paidPct)}%` }}
                      />
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[#3E343A]">
                      <Wallet className="h-3.5 w-3.5 text-[#A5556E]" /> %{paidPct} tahsil edildi
                    </span>
                  </div>
                )}
              </header>

              {/* BODY */}
              <div className="min-h-0 flex-1 overflow-y-auto bg-[#fbf4f7] p-3.5 sm:p-5">{children}</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ModalPortal>
  )
}
