'use client'

import { useState } from 'react'
import { Wallet, Loader2, Check, Clock3, AlertTriangle, Sparkles, TrendingUp, Plus, X } from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import type { ApiMessagingWallet, ApiCreditPackage, ApiCreditPurchase } from '@/lib/types'

const money = (n?: number) => `₺${(n ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function WhatsAppWalletCard({ tenantId }: { tenantId?: string }) {
  const { data: wallet, loading, reload } = useApiQuery<ApiMessagingWallet | null>(
    () => adminApi.whatsappWallet<ApiMessagingWallet>(tenantId),
    [tenantId],
    { initialData: null },
  )
  const { data: purchases, reload: reloadPurchases } = useApiQuery<ApiCreditPurchase[]>(
    () => adminApi.whatsappPurchases<ApiCreditPurchase>(tenantId, 10),
    [tenantId],
    { initialData: [] },
  )

  const [buyingId, setBuyingId] = useState<string | null>(null)
  const [customAmount, setCustomAmount] = useState('')
  const [customOpen, setCustomOpen] = useState(false)
  const [justRequested, setJustRequested] = useState(false)

  const buy = async (pkg?: ApiCreditPackage) => {
    const body = pkg ? { creditPackageId: pkg.id } : { amountTry: Number(customAmount) }
    if (!pkg && (!Number.isFinite(body.amountTry) || (body.amountTry ?? 0) <= 0)) return
    setBuyingId(pkg?.id ?? 'custom')
    try {
      await adminApi.requestWhatsappTopUp(body, tenantId)
      setJustRequested(true); setCustomAmount(''); setCustomOpen(false)
      await Promise.all([reload(), reloadPurchases()])
      setTimeout(() => setJustRequested(false), 4000)
    } finally { setBuyingId(null) }
  }

  const pendingList = (purchases ?? []).filter((p) => p.status === 'Pending')

  if (loading && !wallet) {
    return <div className="rounded-[20px] border border-[#ead8df]/70 bg-white/85 p-5 text-center text-[11px] text-[#352432]/40 shadow-[0_18px_50px_-40px_rgba(142,63,91,0.5)]">Kontör bilgisi yükleniyor…</div>
  }

  const w = wallet
  const utilityPct = w && w.utilityLimit > 0 ? Math.min(100, Math.round((w.utilityUsed / w.utilityLimit) * 100)) : 0
  const marketingPct = w && w.marketingLimit > 0 ? Math.min(100, Math.round((w.marketingUsed / w.marketingLimit) * 100)) : 0

  return (
    <div className="rounded-[20px] border border-[#ead8df]/70 bg-white/85 p-5 shadow-[0_18px_50px_-40px_rgba(142,63,91,0.5)]">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#c85776]/12 text-[#b14d6c]"><Wallet className="h-4.5 w-4.5" /></span>
          <div>
            <div className="text-[13px] font-semibold text-[#352432]">WhatsApp Kontör</div>
            <div className="text-[10.5px] text-[#352432]/45">Ek mesaj bakiyesi + aylık kullanım</div>
          </div>
        </div>
        {w?.isLowBalance && (
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            <AlertTriangle className="h-3 w-3" /> Düşük bakiye
          </span>
        )}
      </div>

      {/* Bakiye */}
      <div className="mb-3 rounded-2xl border border-[#f0dbe3] bg-gradient-to-br from-[#fff5f8] to-[#fdeef3] p-4">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">Kullanılabilir bakiye</div>
            <div className="text-[26px] font-bold leading-tight text-[#8e3f5b]">{money(w?.availableTry)}</div>
          </div>
          <div className="text-right">
            <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#b14d6c]">
              <Sparkles className="h-3.5 w-3.5" /> ≈ {(w?.estimatedUtilityMessages ?? 0).toLocaleString('tr-TR')} mesaj
            </div>
            {(w?.reservedTry ?? 0) > 0 && (
              <div className="mt-0.5 text-[10px] text-[#352432]/45">{money(w?.reservedTry)} rezerve</div>
            )}
          </div>
        </div>
        {!w?.billingEnabled && (
          <div className="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-[10px] text-[#352432]/55">
            Faturalama şu an kapalı — mesajlar kontör düşülmeden gönderiliyor.
          </div>
        )}
      </div>

      {/* Aylık kullanım */}
      <div className="mb-3 space-y-2.5">
        <UsageBar label="Hatırlatma (Utility)" used={w?.utilityUsed ?? 0} limit={w?.utilityLimit ?? 0} pct={utilityPct} color="#1da851" />
        {w && w.marketingLimit > 0 && (
          <UsageBar label="Pazarlama (Marketing)" used={w.marketingUsed} limit={w.marketingLimit} pct={marketingPct} color="#c85776" />
        )}
        {w && (w.monthlyWalletSpentTry > 0 || w.monthlySpendCapTry != null) && (
          <div className="flex items-center justify-between rounded-lg border border-[#ead8df] bg-[#fffafb] px-2.5 py-1.5 text-[10.5px]">
            <span className="inline-flex items-center gap-1 text-[#352432]/55"><TrendingUp className="h-3 w-3" /> Bu ay kontör harcaması</span>
            <span className="font-semibold text-[#352432]">
              {money(w.monthlyWalletSpentTry)}{w.monthlySpendCapTry != null && <span className="text-[#352432]/40"> / {money(w.monthlySpendCapTry)} tavan</span>}
            </span>
          </div>
        )}
      </div>

      {/* Bekleyen talepler */}
      {pendingList.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {pendingList.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
              <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> {p.packageName} · {money(p.grantsTry)}</span>
              <span className="font-semibold">Onay bekliyor</span>
            </div>
          ))}
        </div>
      )}

      {justRequested && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-medium text-emerald-700">
          <Check className="h-3.5 w-3.5" /> Kontör talebiniz alındı. Onaylandığında bakiyenize eklenecek.
        </div>
      )}

      {/* Satın alınabilir paketler */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">Ek kontör al</div>
          <button type="button" onClick={() => setCustomOpen((v) => !v)} className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-[#b14d6c] hover:underline">
            {customOpen ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />} Özel tutar
          </button>
        </div>

        {customOpen && (
          <div className="flex items-center gap-2 rounded-xl border border-[#ead8df] bg-[#fffafb] p-2">
            <input
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              placeholder="₺ tutar"
              className="min-w-0 flex-1 rounded-lg border border-[#ead8df] bg-white px-2.5 py-1.5 text-[12px] text-[#352432] outline-none focus:border-[#c85776]"
            />
            <button type="button" disabled={buyingId === 'custom' || !customAmount} onClick={() => buy()} className="inline-flex items-center gap-1 rounded-lg bg-[#8e3f5b] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
              {buyingId === 'custom' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Talep et'}
            </button>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-3">
          {(w?.creditPackages ?? []).map((pkg) => (
            <button
              key={pkg.id}
              type="button"
              disabled={buyingId === pkg.id}
              onClick={() => buy(pkg)}
              className="group flex flex-col rounded-xl border border-[#ead8df] bg-white p-3 text-left transition hover:border-[#c85776] hover:shadow-[0_10px_28px_-20px_rgba(142,63,91,0.6)] disabled:opacity-50"
            >
              <span className="text-[11.5px] font-semibold text-[#352432]">{pkg.name}</span>
              <span className="mt-0.5 text-[18px] font-bold leading-tight text-[#8e3f5b]">{money(pkg.priceTry)}</span>
              {pkg.grantsTry > pkg.priceTry && (
                <span className="text-[10px] font-medium text-emerald-600">+{money(pkg.grantsTry - pkg.priceTry)} bonus</span>
              )}
              <span className="mt-1 text-[10px] text-[#352432]/50">≈ {pkg.estimatedUtilityMessages.toLocaleString('tr-TR')} mesaj</span>
              <span className="mt-2 inline-flex items-center gap-1 text-[10.5px] font-semibold text-[#b14d6c] group-hover:underline">
                {buyingId === pkg.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Talep et
              </span>
            </button>
          ))}
        </div>
        <p className="text-[10px] leading-snug text-[#352432]/45">
          Kontör talepleriniz BeautyAsist onayından sonra bakiyenize eklenir. Ödeme ve fatura için sizinle iletişime geçilir.
        </p>
      </div>
    </div>
  )
}

function UsageBar({ label, used, limit, pct, color }: { label: string; used: number; limit: number; pct: number; color: string }) {
  const unlimited = limit < 0
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10.5px]">
        <span className="text-[#352432]/55">{label}</span>
        <span className="font-semibold text-[#352432]">{used.toLocaleString('tr-TR')}{unlimited ? '' : ` / ${limit.toLocaleString('tr-TR')}`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#f0e2e8]">
        <div className="h-full rounded-full transition-all" style={{ width: unlimited ? '8%' : `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}
