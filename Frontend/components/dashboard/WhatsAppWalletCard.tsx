'use client'

import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock3,
  Coins,
  CreditCard,
  Loader2,
  MessageCircle,
  Phone,
  Plus,
  TrendingUp,
  X,
} from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import type { ApiCreditPackage, ApiCreditPurchase, ApiMessagingWallet, ApiWalletTransaction } from '@/lib/types'

const money = (n?: number) => `₺${(n ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** Kredi tam sayıysa ondalıksız gösterilir (1.000 kredi); kesirliyse iki hane. */
const credits = (n?: number) => {
  const v = n ?? 0
  return Number.isInteger(v)
    ? v.toLocaleString('tr-TR')
    : v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const txLabels: Record<string, string> = {
  TopUp: 'Kredi yükleme',
  Capture: 'Harcama',
  Adjustment: 'Düzeltme',
  Conversion: 'Kontör → kredi dönüşümü',
  Reserve: 'Rezervasyon',
  Refund: 'İade',
}

/**
 * MESAJ KREDİSİ — WhatsApp ve SMS'in ORTAK cüzdanı.
 *
 * 1 kredi = 1 WhatsApp hatırlatma. Plan kotası bitince (kurum izin verdiyse) mesajlar krediden
 * düşer; maliyetler platformdan gelir, kodda sabit değildir. Bileşen adı geriye uyumluluk için
 * korunur (ayarlar sayfası bu adla içe aktarır).
 */
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
  const [showHistory, setShowHistory] = useState(false)
  const { data: transactions } = useApiQuery<ApiWalletTransaction[]>(
    () => (showHistory ? adminApi.whatsappWalletTransactions<ApiWalletTransaction>(tenantId, 8) : Promise.resolve([])),
    [tenantId, showHistory],
    { initialData: [] },
  )

  const [buyingId, setBuyingId] = useState<string | null>(null)
  const [customCredits, setCustomCredits] = useState('')
  const [customOpen, setCustomOpen] = useState(false)
  const [justRequested, setJustRequested] = useState(false)
  const [payError, setPayError] = useState('')
  /** Kartla öde (varsayılan) ↔ havale talebi. Havale yolu KALDIRILMADI: kurumların bir kısmı
      hâlâ havale/fatura ile ödüyor ve platformun her yüklemeyi denetlemesi bilinçli bir tercih. */
  const [payByCard, setPayByCard] = useState(true)

  const w = wallet
  const customAmount = Math.floor(Number(customCredits) || 0)
  // Ödenecek tutar yalnız GÖSTERİMDİR: sunucu fiyatı kendi birim fiyatından yeniden hesaplar.
  const customPrice = customAmount * (w?.creditUnitPriceTry ?? 0)

  /** Kredi başı ₺ — en avantajlı paketi işaretlemek için. */
  const bestValueId = useMemo(() => {
    const pkgs = (w?.creditPackages ?? []).filter((p) => p.grantsCredits > 0 && p.priceTry > 0)
    if (pkgs.length < 2) return null
    return pkgs.reduce((best, p) => (p.priceTry / p.grantsCredits < best.priceTry / best.grantsCredits ? p : best)).id
  }, [w?.creditPackages])

  const buy = async (pkg?: ApiCreditPackage) => {
    if (!pkg && customAmount <= 0) return
    const body = pkg ? { creditPackageId: pkg.id } : { credits: customAmount }
    setBuyingId(pkg?.id ?? 'custom')
    setPayError('')
    try {
      if (payByCard) {
        // Ödeme sayfasına gidilir; kredi dönüşte (callback doğrulandığında) yüklenir.
        const started = await adminApi.startWhatsappTopUpCheckout<{ redirectUrl?: string; formContent?: string }>(body, tenantId)
        if (started?.redirectUrl) {
          window.location.href = started.redirectUrl
          return
        }
        setPayError('Ödeme sayfası açılamadı. Lütfen tekrar deneyin.')
        return
      }
      await adminApi.requestWhatsappTopUp(body, tenantId)
      setJustRequested(true); setCustomCredits(''); setCustomOpen(false)
      await Promise.all([reload(), reloadPurchases()])
      setTimeout(() => setJustRequested(false), 4000)
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'İşlem tamamlanamadı.')
    } finally { setBuyingId(null) }
  }

  const pendingList = (purchases ?? []).filter((p) => p.status === 'Pending')

  if (loading && !wallet) {
    return <div className="rounded-[20px] border border-[#EAD8DF] bg-white/85 p-5 text-center text-[11px] text-[#74616A] shadow-[0_18px_50px_-40px_rgba(142,63,91,0.5)]">Mesaj kredisi yükleniyor…</div>
  }

  const pct = (used: number, limit: number) => (limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0)

  return (
    <div className="rounded-[20px] border border-[#EAD8DF] bg-white/85 p-5 shadow-[0_18px_50px_-40px_rgba(142,63,91,0.5)]">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#A5556E]/12 text-[#8C4460]"><Coins className="h-4.5 w-4.5" /></span>
          <div>
            <div className="text-[13px] font-semibold text-[#2A2027]">Mesaj Kredisi</div>
            <div className="text-[10.5px] text-[#74616A]">WhatsApp + SMS ortak bakiye · aylık kullanım</div>
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
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-[#74616A]">Kullanılabilir kredi</div>
            <div className="text-[26px] font-bold leading-tight text-[#8e3f5b]">
              {credits(w?.availableCredits)} <span className="text-[14px] font-semibold">kredi</span>
            </div>
            {(w?.reservedCredits ?? 0) > 0 && (
              <div className="mt-0.5 text-[10px] text-[#74616A]">{credits(w?.reservedCredits)} kredi gönderim onayı bekliyor</div>
            )}
          </div>
          <div className="space-y-0.5 text-right text-[11px] font-semibold text-[#8C4460]">
            <div className="inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" /> ≈ {(w?.estimatedUtilityMessages ?? 0).toLocaleString('tr-TR')} WhatsApp hatırlatma</div>
            <div className="flex items-center justify-end gap-1"><Phone className="h-3.5 w-3.5" /> ya da ≈ {(w?.estimatedSmsMessages ?? 0).toLocaleString('tr-TR')} kısa SMS</div>
          </div>
        </div>

        {/* Kim kaç kredi harcar — kurum maliyeti burada görür (platform panelinden gelir). */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <CostChip label="WhatsApp hatırlatma" value={w?.utilityCreditCost} />
          <CostChip label="WhatsApp kampanya" value={w?.marketingCreditCost} />
          <CostChip label="SMS (70 karaktere kadar)" value={w?.smsCreditsPerPart} suffix=" / parça" />
        </div>

        {!w?.billingEnabled && (
          <div className="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-[10px] text-[#5A4B53]">
            Faturalama şu an kapalı — mesajlar krediden düşülmeden yalnız plan kotasıyla gönderiliyor.
          </div>
        )}
      </div>

      {/* Aylık kullanım — önce plan kotası harcanır, kredi ancak kota bitince */}
      <div className="mb-3 space-y-2.5">
        <UsageBar label="WhatsApp hatırlatma (pakete dahil)" used={w?.utilityUsed ?? 0} limit={w?.utilityLimit ?? 0} pct={pct(w?.utilityUsed ?? 0, w?.utilityLimit ?? 0)} color="#1da851" />
        {w && w.marketingLimit !== 0 && (
          <UsageBar label="WhatsApp kampanya (pakete dahil)" used={w.marketingUsed} limit={w.marketingLimit} pct={pct(w.marketingUsed, w.marketingLimit)} color="#A5556E" />
        )}
        {w && (w.smsLimit !== 0 || w.smsUsed > 0) && (
          <UsageBar label="SMS (pakete dahil)" used={w.smsUsed} limit={w.smsLimit} pct={pct(w.smsUsed, w.smsLimit)} color="#2f7dd1" />
        )}
        {w && (w.monthlySpentCredits > 0 || w.monthlySpendCapCredits != null) && (
          <div className="flex items-center justify-between rounded-lg border border-[#EAD8DF] bg-[#F7F6F6] px-2.5 py-1.5 text-[10.5px]">
            <span className="inline-flex items-center gap-1 text-[#5A4B53]"><TrendingUp className="h-3 w-3" /> Bu ay krediden harcanan</span>
            <span className="font-semibold text-[#2A2027]">
              {credits(w.monthlySpentCredits)} kredi
              {w.monthlySpendCapCredits != null && <span className="text-[#74616A]"> / {credits(w.monthlySpendCapCredits)} tavan</span>}
            </span>
          </div>
        )}
        {w && !w.allowWalletOverage && (
          <div className="rounded-lg border border-[#EAD8DF] bg-white px-2.5 py-1.5 text-[10px] leading-snug text-[#5A4B53]">
            Kota bitince krediden devam <b>kapalı</b>: aylık kota dolunca mesajlar durur, kredi harcanmaz. WhatsApp ayarlarından açabilirsiniz.
          </div>
        )}
      </div>

      {/* Bekleyen talepler */}
      {pendingList.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {pendingList.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
              <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> {p.packageName} · {credits(p.grantsCredits)} kredi</span>
              <span className="font-semibold">Onay bekliyor</span>
            </div>
          ))}
        </div>
      )}

      {justRequested && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-medium text-emerald-700">
          <Check className="h-3.5 w-3.5" /> Kredi talebiniz alındı. Onaylandığında bakiyenize eklenecek.
        </div>
      )}

      {payError && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {payError}
        </div>
      )}

      {/* Satın alınabilir paketler */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[#74616A]">Kredi yükle</div>
          <button type="button" onClick={() => setCustomOpen((v) => !v)} className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-[#8C4460] hover:underline">
            {customOpen ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />} Özel miktar
          </button>
        </div>

        {/* Ödeme yolu seçimi — kartla anında, havalede onay beklenir. */}
        <div className="flex items-center gap-1 rounded-xl border border-[#EAD8DF] bg-[#F7F6F6] p-1">
          {([true, false] as const).map((card) => (
            <button
              key={String(card)}
              type="button"
              onClick={() => { setPayByCard(card); setPayError('') }}
              className={`flex-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                payByCard === card ? 'bg-[#8e3f5b] text-white' : 'text-[#5A4B53] hover:text-[#8e3f5b]'
              }`}
            >
              {card ? (
                <span className="inline-flex items-center gap-1"><CreditCard className="h-3.5 w-3.5" /> Kartla öde</span>
              ) : (
                <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> Havale / talep</span>
              )}
            </button>
          ))}
        </div>

        {customOpen && (
          <div className="rounded-xl border border-[#EAD8DF] bg-[#F7F6F6] p-2">
            <div className="flex items-center gap-2">
              <input
                value={customCredits}
                onChange={(e) => setCustomCredits(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                placeholder="Kredi miktarı"
                className="min-w-0 flex-1 rounded-lg border border-[#EAD8DF] bg-white px-2.5 py-1.5 text-[12px] text-[#2A2027] outline-none focus:border-[#A5556E]"
              />
              <button type="button" disabled={buyingId === 'custom' || customAmount <= 0} onClick={() => buy()} className="inline-flex items-center gap-1 rounded-lg bg-[#8e3f5b] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
                {buyingId === 'custom' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : payByCard ? 'Öde' : 'Talep et'}
              </button>
            </div>
            {customAmount > 0 && (
              <div className="mt-1.5 text-[10.5px] text-[#5A4B53]">
                {credits(customAmount)} kredi = <b>{money(customPrice)}</b> <span className="text-[#74616A]">(kredi başı {money(w?.creditUnitPriceTry)})</span>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-3">
          {(w?.creditPackages ?? []).map((pkg) => (
            <button
              key={pkg.id}
              type="button"
              disabled={buyingId === pkg.id}
              onClick={() => buy(pkg)}
              className={`group relative flex flex-col rounded-xl border bg-white p-3 text-left transition hover:border-[#8C4460] hover:shadow-[0_10px_28px_-20px_rgba(142,63,91,0.6)] disabled:opacity-50 ${
                bestValueId === pkg.id ? 'border-[#8C4460]' : 'border-[#EAD8DF]'
              }`}
            >
              {bestValueId === pkg.id && (
                <span className="absolute -top-2 right-2 rounded-full bg-[#8e3f5b] px-2 py-0.5 text-[9px] font-semibold text-white">En avantajlı</span>
              )}
              <span className="text-[11.5px] font-semibold text-[#2A2027]">{pkg.name}</span>
              <span className="mt-0.5 text-[18px] font-bold leading-tight text-[#8e3f5b]">{credits(pkg.grantsCredits)} kredi</span>
              <span className="text-[11px] font-semibold text-[#2A2027]">{money(pkg.priceTry)}</span>
              {pkg.grantsCredits > 0 && (
                <span className="text-[10px] text-[#74616A]">kredi başı {money(pkg.priceTry / pkg.grantsCredits)}</span>
              )}
              {pkg.description && <span className="mt-1 text-[10px] leading-snug text-[#5A4B53]">{pkg.description}</span>}
              <span className="mt-2 inline-flex items-center gap-1 text-[10.5px] font-semibold text-[#8C4460] group-hover:underline">
                {buyingId === pkg.id ? <Loader2 className="h-3 w-3 animate-spin" /> : payByCard ? <CreditCard className="h-3 w-3" /> : <Plus className="h-3 w-3" />} {payByCard ? 'Kartla al' : 'Talep et'}
              </span>
            </button>
          ))}
        </div>
        <p className="text-[10px] leading-snug text-[#74616A]">
          {payByCard
            ? 'Güvenli ödeme sayfasına yönlendirilirsiniz. Krediniz ödeme onaylandığı anda yüklenir; kart bilgileriniz bizde saklanmaz.'
            : 'Kredi talepleriniz BeautyAsist onayından sonra bakiyenize eklenir. Ödeme ve fatura için sizinle iletişime geçilir.'}
        </p>
      </div>

      {/* Son hareketler — dönüşüm öncesi satırlar ₺ olarak gösterilir (geçmiş yeniden yazılmaz). */}
      <div className="mt-3 border-t border-[#f4e8ed] pt-2">
        <button type="button" onClick={() => setShowHistory((v) => !v)}
          className="flex w-full items-center justify-between text-[10px] font-mono uppercase tracking-widest text-[#74616A] hover:text-[#8C4460]">
          Son hareketler <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showHistory ? 'rotate-180' : ''}`} />
        </button>
        {showHistory && (
          <div className="mt-2 space-y-1">
            {(transactions ?? []).length === 0 && <div className="py-2 text-center text-[10.5px] text-[#74616A]">Henüz hareket yok.</div>}
            {(transactions ?? []).map((t) => {
              const amount = t.unit === 'Try' ? money(Math.abs(t.amount)) : `${credits(Math.abs(t.amount))} kredi`
              const positive = t.amount >= 0
              return (
                <div key={t.id} className="flex items-start justify-between gap-2 rounded-lg px-2 py-1.5 text-[10.5px] hover:bg-[#F7F6F6]">
                  <div className="min-w-0">
                    <div className="font-semibold text-[#2A2027]">
                      {txLabels[t.type] ?? t.type}
                      {t.channel && <span className="ml-1 font-normal text-[#74616A]">· {t.channel === 'Sms' ? 'SMS' : t.channel}</span>}
                      {t.unit === 'Try' && <span className="ml-1 rounded bg-[#f0e2e8] px-1 text-[9px] font-semibold text-[#8C4460]">eski ₺</span>}
                    </div>
                    {t.description && <div className="truncate text-[#74616A]">{t.description}</div>}
                  </div>
                  <span className={`shrink-0 font-semibold ${positive ? 'text-emerald-700' : 'text-[#8e3f5b]'}`}>{positive ? '+' : '−'}{amount}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function CostChip({ label, value, suffix = '' }: { label: string; value?: number; suffix?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#ecd6df] bg-white/80 px-2 py-0.5 text-[10px] text-[#5A4B53]">
      {label}: <b className="text-[#8e3f5b]">{credits(value)} kredi{suffix}</b>
    </span>
  )
}

function UsageBar({ label, used, limit, pct, color }: { label: string; used: number; limit: number; pct: number; color: string }) {
  const unlimited = limit < 0
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10.5px]">
        <span className="text-[#5A4B53]">{label}</span>
        <span className="font-semibold text-[#2A2027]">{used.toLocaleString('tr-TR')}{unlimited ? ' · sınırsız' : ` / ${limit.toLocaleString('tr-TR')}`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#f0e2e8]">
        <div className="h-full rounded-full transition-all" style={{ width: unlimited ? '8%' : `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}
